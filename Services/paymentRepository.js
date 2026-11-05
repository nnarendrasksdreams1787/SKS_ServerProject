// Service/paymentRepository.js files for use

const pool = require("../DB/db");

const TENANT_ID = 1;

const SUPPORTED_GATEWAYS = ["phonepe", "mswipe"];

const ALLOWED_ENVIRONMENTS = ["test", "live"];

const crypto = require("node:crypto");

function validateEnvironment(environment) {
  if (!ALLOWED_ENVIRONMENTS.includes(environment)) {
    throw new Error("Invalid payment environment");
  }
}

function validateProvider(providerCode) {
  if (!SUPPORTED_GATEWAYS.includes(providerCode)) {
    throw new Error("Unsupported payment gateway");
  }
}

// Read currently selected gateway
async function getSelectedGateway(environment = "test") {
  validateEnvironment(environment);

  const [rows] = await pool.execute(
    `
    SELECT
      provider_code,
      environment,
      updated_at
    FROM payment_gateway_selection
    WHERE tenant_id = ?
      AND environment = ?
    LIMIT 1
    `,
    [TENANT_ID, environment],
  );

  return rows[0] || null;
}

// Read provider availability
async function getGatewayAvailability(providerCode, environment) {
  validateProvider(providerCode);
  validateEnvironment(environment);

  const [rows] = await pool.execute(
    `
    SELECT
      p.provider_id,
      p.provider_code,
      p.status,
      c.is_enabled
    FROM payment_gateway_providers p
    LEFT JOIN payment_gateway_configs c
      ON c.provider_id = p.provider_id
      AND c.tenant_id = p.tenant_id
      AND c.environment = ?
    WHERE p.tenant_id = ?
      AND p.provider_code = ?
    LIMIT 1
    `,
    [environment, TENANT_ID, providerCode],
  );

  return rows[0] || null;
}

// Save admin-selected gateway
async function saveSelectedGateway(providerCode, environment = "test") {
  validateProvider(providerCode);
  validateEnvironment(environment);

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Lock the provider record so status changes cannot
    // race with this selection transaction.
    const [providers] = await connection.execute(
      `
      SELECT
        provider_id,
        provider_code,
        status
      FROM payment_gateway_providers
      WHERE tenant_id = ?
        AND provider_code = ?
      FOR UPDATE
      `,
      [TENANT_ID, providerCode],
    );

    if (!providers.length) {
      throw new Error("Payment provider not found");
    }

    if (providers[0].status !== "active") {
      throw new Error("Payment provider is not active");
    }

    const [configs] = await connection.execute(
      `
      SELECT gateway_config_id, is_enabled
      FROM payment_gateway_configs
      WHERE tenant_id = ?
        AND provider_id = ?
        AND environment = ?
      FOR UPDATE
      `,
      [TENANT_ID, providers[0].provider_id, environment],
    );

    if (!configs.length) {
      throw new Error("Payment gateway configuration not found");
    }

    if (Number(configs[0].is_enabled) !== 1) {
      throw new Error("Payment gateway configuration is disabled");
    }

    await connection.execute(
      `
      INSERT INTO payment_gateway_selection
        (tenant_id, environment, provider_code)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        provider_code = VALUES(provider_code),
        updated_at = CURRENT_TIMESTAMP
      `,
      [TENANT_ID, environment, providerCode],
    );

    await connection.commit();

    return {
      providerCode,
      environment,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// Create a pending payment order.
// Assume tables: payment_orders, payment_transations.
// No geteways API call or book access activation happens here.

async function createPendingPaymentOrder({
  userId,
  tenantId,
  productId,
  idempotencyKey,
  environment = "test",
}) {
  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !Number.isSafeInteger(tenantId) ||
    tenantId !== TENANT_ID ||
    !Number.isSafeInteger(productId) ||
    productId <= 0
  ) {
    throw new Error("Invalid checkout information");
  }

  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.length < 16 ||
    idempotencyKey.length > 100 ||
    !/^[a-zA-Z0-9_-]+$/.test(idempotencyKey)
  ) {
    throw new Error("Invalid idempotency key");
  }

  validateEnvironment(environment);

  const toPaise = (value) => {
    const text = String(value);
    if (!/^\d+(\.\d{1,2})?$/.test(text)) {
      throw new Error("Invalid monetary value");
    }
    const [whole, fraction = ""] = text.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  };

  const toRupees = (paise) =>
    `${paise / 100n}.${String(paise % 100n).padStart(2, "0")}`;

  const readExisting = async (db) => {
    const [rows] = await db.execute(
      `SELECT
         o.order_id, o.order_number, o.currency,
         o.total_amount, o.status, o.payment_environment,
         oi.product_id,
         p.gateway, p.initiation_status
       FROM orders o
       JOIN order_items oi
         ON oi.tenant_id = o.tenant_id
        AND oi.order_id = o.order_id
       JOIN payments p
         ON p.tenant_id = o.tenant_id
        AND p.order_id = o.order_id
       WHERE o.tenant_id = ?
         AND o.user_id = ?
         AND o.idempotency_key = ?
       LIMIT 2`,
      [tenantId, userId, idempotencyKey],
    );

    if (rows.length !== 1) {
      throw new Error("Existing checkout requires review");
    }

    const row = rows[0];

    if (
      Number(row.product_id) !== productId ||
      row.payment_environment !== environment
    ) {
      const error = new Error(
        "Idempotency key already used for another checkout",
      );
      error.statusCode = 409;
      throw error;
    }

    const amountPaise = toPaise(row.total_amount);

    if (amountPaise > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Existing order amount exceeds safe range");
    }

    return {
      reused: true,
      order: {
        paymentOrderId: row.order_id,
        orderReference: row.order_number,
        productId: Number(row.product_id),
        amountPaise: Number(amountPaise),
        currency: row.currency,
        providerCode: row.gateway,
        environment: row.payment_environment,
        paymentStatus: row.status === "paid" ? "success" : row.status,
        settlementStatus: "pending",
        accessStatus: "locked",
      },
    };
  };

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Check for an existing checkout request.
    const [existing] = await connection.execute(
      `SELECT order_id
       FROM orders
       WHERE tenant_id = ?
         AND user_id = ?
         AND idempotency_key = ?
       LIMIT 1`,
      [tenantId, userId, idempotencyKey],
    );

    if (existing.length) {
      const result = await readExisting(connection);
      await connection.commit();
      return result;
    }

    // if (existing.length) {
    //   const order = existing[0];

    //   if (
    //     Number(order.product_id) !== productId ||
    //     order.environment !== environment
    //   ) {
    //     const error = new Error(
    //       "Idempotency key already used for another checkout",
    //     );

    //     error.statusCode = 409;

    //     throw error;
    //   }

    //   await connection.commit();

    //   return {
    //     reused: true,
    //     order: {
    //       paymentOrderId: order.payment_order_id,
    //       orderReference: order.order_reference,
    //       productId: order.product_id,
    //       amountPaise: order.amount_paise,
    //       currency: order.currency,
    //       providerCode: order.provider_code,
    //       environment: order.environment,
    //       paymentStatus: order.payment_status,
    //       settlementStatus: order.settlement_status,
    //       accessStatus: order.access_status,
    //     },
    //   };
    // }

    // Registration sponsor is the referral authority.
    const [users] = await connection.execute(
      `SELECT sponsor_id
       FROM users
       WHERE tenant_id = ?
         AND user_id = ?
         AND status = 'active'
       LIMIT 1`,
      [tenantId, userId],
    );

    if (users.length !== 1) {
      throw new Error("Active customer not found");
    }

    const sponsorId = users[0].sponsor_id || null;

    // 2. Read actual product price from database.
    const [products] = await connection.execute(
      `
      SELECT product_id, title, price, tax_percent, is_active
      FROM products
      WHERE tenant_id = ?
        AND product_id = ?
      LIMIT 1
      `,
      [tenantId, productId],
    );

    // if (!products.length || !products[0].is_active) {
    //   throw new Error("Product is unavailable");
    // }

    if (products.length !== 1 || Number(products[0].is_active) !== 1) {
      throw new Error("Product is unavailable");
    }

    const product = products[0];

    const subtotalPaise = toPaise(product.price);
    const taxBasisPoints = toPaise(product.tax_percent);

    // Assumes price is stored as a decimal INR value.
    // const price = String(product.price);

    // if (!/^\d+(\.\d{1,2})?$/.test(price)) {
    //   throw new Error("Invalid product price");
    // }

    // const [rupees, fraction = ""] = price.split(".");

    // const amountPaise = BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, "0"));

    // if (amountPaise < 100n || amountPaise > BigInt(Number.MAX_SAFE_INTEGER)) {
    //   throw new Error("Product price must be at least INR 1");
    // }

    // Calculate the exact checkout amount in paise.
    // Never trust the frontend for product price or tax.

    // function decimalToScaledInteger(value, scale) {
    //   const text = String(value);

    //   if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    //     throw new Error("Invalid product price or tax percentage");
    //   }

    //   const [whole, fraction = ""] = text.split(".");

    //   return BigInt(whole) * scale + BigInt(fraction.padEnd(2, "0"));
    // }

    // const subtotalPaise = decimalToScaledInteger(product.price, 100n);

    // const taxPercentBasisPoints = decimalToScaledInteger(
    //   product.tax_percent,
    //   100n,
    // );

    
    if (taxBasisPoints > 10000n) {
      throw new Error("Invalid product tax percentage");
    }

    // Round tax to the nearest paise.
    // const taxPaise = (subtotalPaise * taxPercentBasisPoints + 5000n) / 10000n;
    const taxPaise = (subtotalPaise * taxBasisPoints + 5000n) / 10000n;

    const amountPaise = subtotalPaise + taxPaise;

    if (amountPaise < 100n || amountPaise > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Invalid checkout amount");
    }

    // 3. Read admin-selected gateway.
    const [selections] = await connection.execute(
      `
      SELECT provider_code
      FROM payment_gateway_selection
      WHERE tenant_id = ?
        AND environment = ?
      LIMIT 1
      `,
      [tenantId, environment],
    );

    if (!selections.length) {
      throw new Error("No payment gateway selected");
    }

    const providerCode = selections[0].provider_code;

    validateProvider(providerCode);

    // 4. Check provider status.
    // 4. Check provider and environment configuration.
    const [providers] = await connection.execute(
      `
      SELECT
        p.provider_id,
        p.status,
        c.is_enabled
      FROM payment_gateway_providers AS p
      JOIN payment_gateway_configs AS c
        ON c.tenant_id = p.tenant_id
      AND c.provider_id = p.provider_id
      AND c.environment = ?
      WHERE p.tenant_id = ?
        AND p.provider_code = ?
      LIMIT 1
      `,
      [environment, tenantId, providerCode],
    );

    // if (!providers.length || providers[0].status !== "active") {
    //   throw new Error("Selected payment provider is inactive");
    // }

    if (
      providers.length !== 1 ||
      providers[0].status !== "active" ||
      Number(providers[0].is_enabled) !== 1
    ) {
      throw new Error("Selected payment gateway is unavailable");
    }

    // if (Number(providers[0].is_enabled) !== 1) {
    //   throw new Error("Selected payment gateway configuration is disabled");
    // }

    // 5. Create order reference.
    const orderReference = "SKS_" + crypto.randomUUID().replace(/-/g, "");

    // 6. Save pending order.
    const [orderResult] = await connection.execute(
      // `
      // INSERT INTO payment_orders (
      //   tenant_id,
      //   order_reference,
      //   idempotency_key,
      //   user_id,
      //   product_id,
      //   amount_paise,
      //   currency,
      //   provider_code,
      //   environment,
      //   payment_status,
      //   settlement_status,
      //   access_status
      // )
      // VALUES (?, ?, ?, ?, ?, ?, 'INR', ?, ?,
      //         'pending', 'pending', 'locked')
      // `,

      `INSERT INTO orders (
         tenant_id, order_number, user_id, referrer_id,
         subtotal, discount_amount, tax_amount,
         total_amount, currency, status,
         idempotency_key, payment_environment
       ) VALUES (?, ?, ?, ?, ?, '0.00', ?, ?, 'INR',
                 'pending', ?, ?)`,
      [
        // tenantId,
        // orderReference,
        // idempotencyKey,
        // userId,
        // productId,
        // Number(amountPaise),
        // providerCode,
        // environment,

        tenantId,
        orderReference,
        userId,
        sponsorId,
        toRupees(subtotalPaise),
        toRupees(taxPaise),
        toRupees(amountPaise),
        idempotencyKey,
        environment,
      ],
    );

    const orderId = orderResult.insertId;

    // 7. Create transaction record.
    // await connection.execute(
    //   `
    //   INSERT INTO payment_transactions (
    //     payment_order_id,
    //     provider_code,
    //     amount_paise,
    //     transaction_status
    //   )
    //   VALUES (?, ?, ?, 'created')
    //   `,
    //   [orderResult.insertId, providerCode, Number(amountPaise)],
    // );

    await connection.execute(
      `INSERT INTO order_items (
         tenant_id, order_id, product_id,
         product_title_snapshot, quantity,
         unit_price, discount_amount,
         tax_amount, line_total
       ) VALUES (?, ?, ?, ?, 1, ?, '0.00', ?, ?)`,
      [
        tenantId,
        orderId,
        productId,
        product.title,
        toRupees(subtotalPaise),
        toRupees(taxPaise),
        toRupees(amountPaise),
      ],
    );

    await connection.execute(
      `INSERT INTO payments (
         tenant_id, order_id, gateway,
         gateway_order_id, amount, currency,
         status, initiation_status
       ) VALUES (?, ?, ?, ?, ?, 'INR',
                 'initiated', 'created')`,
      [tenantId, orderId, providerCode, orderReference, toRupees(amountPaise)],
    );

    await connection.commit();

    // return {
    //   reused: false,
    //   order: {
    //     paymentOrderId: orderResult.insertId,
    //     orderReference,
    //     productId,
    //     amountPaise: Number(amountPaise),
    //     currency: "INR",
    //     providerCode,
    //     environment,
    //     paymentStatus: "pending",
    //     settlementStatus: "pending",
    //     accessStatus: "locked",
    //   },

    return {
      reused: false,
      order: {
        paymentOrderId: orderId,
        orderReference,
        productId,
        amountPaise: Number(amountPaise),
        currency: "INR",
        providerCode,
        environment,
        paymentStatus: "pending",
        settlementStatus: "pending",
        accessStatus: "locked",
      },
    };
  } catch (error) {
    await connection.rollback();
    // Two simultaneous requests may use the same idempotency key.
    // The database unique constraint allows only one order.
    // if (error.code === "ER_DUP_ENTRY") {
    //   const [existingOrders] = await pool.query(
    //     `
    //     SELECT
    //       payment_order_id,
    //       order_reference,
    //       product_id,
    //       amount_paise,
    //       currency,
    //       provider_code,
    //       environment,
    //       payment_status,
    //       settlement_status,
    //       access_status
    //     FROM payment_orders
    //     WHERE tenant_id = ?
    //       AND user_id = ?
    //       AND idempotency_key = ?
    //     LIMIT 1
    //     `,
    //     [tenantId, userId, idempotencyKey],
    //   );

    //   if (existingOrders.length > 0) {
    //     const existing = existingOrders[0];

    //     if (
    //       Number(existing.product_id) !== Number(productId) ||
    //       existing.environment !== environment
    //     ) {
    //       const conflict = new Error(
    //         "Idempotency key already used for a different checkout",
    //       );
    //       conflict.statusCode = 409;
    //       throw conflict;
    //     }

    //     return {
    //       reused: true,
    //       order: {
    //         paymentOrderId: existing.payment_order_id,
    //         orderReference: existing.order_reference,
    //         productId: existing.product_id,
    //         amountPaise: existing.amount_paise,
    //         currency: existing.currency,
    //         providerCode: existing.provider_code,
    //         environment: existing.environment,
    //         paymentStatus: existing.payment_status,
    //         settlementStatus: existing.settlement_status,
    //         accessStatus: existing.access_status,
    //       },
    //     };
    //   }
    // }

    if (error.code === "ER_DUP_ENTRY") {
      return readExisting(pool);
    }

    throw error;
  } finally {
    connection.release();
  }
}

// async function claimPaymentInitiation({ userId, tenantId, orderReference }) {
//   const connection = await pool.getConnection();

//   try {
//     await connection.beginTransaction();

//     const [orders] = await connection.execute(
//       `SELECT payment_order_id, order_reference, user_id,
//               amount_paise, provider_code, environment,
//               payment_status, access_status
//        FROM payment_orders
//        WHERE order_reference = ?
//          AND user_id = ?
//          AND tenant_id = ?
//        LIMIT 1
//        FOR UPDATE`,
//       [orderReference, userId, tenantId],
//     );

//     if (!orders.length) {
//       const error = new Error("Payment order not found");
//       error.statusCode = 404;
//       throw error;
//     }

//     const order = orders[0];

//     if (
//       order.provider_code !== "phonepe" ||
//       order.environment !== "test" ||
//       order.payment_status !== "pending" ||
//       order.access_status !== "locked"
//     ) {
//       const error = new Error("Order cannot initiate PhonePe payment");
//       error.statusCode = 409;
//       throw error;
//     }

//     const [result] = await connection.execute(
//       `UPDATE payment_transactions
//        SET transaction_status = 'initiating'
//        WHERE payment_order_id = ?
//          AND provider_code = 'phonepe'
//          AND transaction_status = 'created'`,
//       [order.payment_order_id],
//     );

//     if (result.affectedRows !== 1) {
//       const error = new Error("Payment initiation already attempted");
//       error.statusCode = 409;
//       throw error;
//     }

//     await connection.commit();

//     return {
//       paymentOrderId: order.payment_order_id,
//       orderReference: order.order_reference,
//       amountPaise: Number(order.amount_paise),
//     };
//   } catch (error) {
//     await connection.rollback();
//     throw error;
//   } finally {
//     connection.release();
//   }
// }

async function claimPaymentInitiation({ userId, tenantId, orderReference }) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [orders] = await connection.execute(
      `
      SELECT
        o.order_id,
        o.order_number,
        o.total_amount,
        o.status AS order_status,
        o.payment_environment,
        p.payment_id,
        p.gateway,
        p.status AS payment_status,
        p.initiation_status
      FROM orders AS o
      INNER JOIN payments AS p
        ON p.tenant_id = o.tenant_id
       AND p.order_id = o.order_id
      WHERE o.tenant_id = ?
        AND o.user_id = ?
        AND o.order_number = ?
      FOR UPDATE
      `,
      [tenantId, userId, orderReference],
    );

    if (orders.length !== 1) {
      const error = new Error(
        orders.length === 0
          ? "Payment order not found"
          : "Multiple payments require review",
      );

      error.statusCode = orders.length === 0 ? 404 : 409;
      throw error;
    }

    const order = orders[0];

    if (
      order.gateway !== "phonepe" ||
      order.payment_environment !== "test" ||
      order.order_status !== "pending" ||
      order.payment_status !== "initiated" ||
      order.initiation_status !== "created"
    ) {
      const error = new Error("Order cannot initiate PhonePe payment");
      error.statusCode = 409;
      throw error;
    }

    const [result] = await connection.execute(
      `
      UPDATE payments
      SET initiation_status = 'initiating'
      WHERE tenant_id = ?
        AND payment_id = ?
        AND gateway = 'phonepe'
        AND status = 'initiated'
        AND initiation_status = 'created'
      `,
      [tenantId, order.payment_id],
    );

    if (result.affectedRows !== 1) {
      const error = new Error("Payment initiation already attempted");
      error.statusCode = 409;
      throw error;
    }

    const amountText = String(order.total_amount);

    if (!/^\d+(\.\d{1,2})?$/.test(amountText)) {
      throw new Error("Invalid stored payment amount");
    }

    const [rupees, fraction = ""] = amountText.split(".");

    const amountPaiseBigInt =
      BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, "0"));

    if (
      amountPaiseBigInt <= 0n ||
      amountPaiseBigInt > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new Error("Payment amount out of range");
    }

    await connection.commit();

    return {
      paymentOrderId: order.order_id,
      orderReference: order.order_number,
      amountPaise: Number(amountPaiseBigInt),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// async function updatePaymentInitiationStatus({ paymentOrderId, status }) {
//   if (!["initiated", "initiation_unknown"].includes(status)) {
//     const error = new Error("Invalid initiation status");
//     error.statusCode = 400;
//     throw error;
//   }

//   if (!Number.isSafeInteger(Number(paymentOrderId))) {
//     const error = new Error("Invalid payment order ID");
//     error.statusCode = 400;
//     throw error;
//   }

//   const [result] = await pool.execute(
//     `
//     UPDATE payment_transactions
//     SET transaction_status = ?
//     WHERE payment_order_id = ?
//       AND transaction_status = 'initiating'
//     `,
//     [status, paymentOrderId],
//   );

//   if (result.affectedRows !== 1) {
//     const error = new Error(
//       "Payment initiation status was not updated; reconciliation required",
//     );

//     error.statusCode = 409;
//     error.requiresReview = true;

//     throw error;
//   }

//   return {
//     paymentOrderId,
//     transactionStatus: status,
//     updated: true,
//   };
// }

async function updatePaymentInitiationStatus({ paymentOrderId, status }) {
  if (!["initiated", "initiation_unknown"].includes(status)) {
    const error = new Error("Invalid initiation status");
    error.statusCode = 400;
    throw error;
  }

  if (
    !Number.isSafeInteger(Number(paymentOrderId)) ||
    Number(paymentOrderId) <= 0
  ) {
    const error = new Error("Invalid payment order ID");
    error.statusCode = 400;
    throw error;
  }

  const [result] = await pool.execute(
    `
    UPDATE payments
    SET initiation_status = ?
    WHERE tenant_id = ?
      AND order_id = ?
      AND gateway = 'phonepe'
      AND status = 'initiated'
      AND initiation_status = 'initiating'
    `,
    [status, TENANT_ID, paymentOrderId],
  );

  if (result.affectedRows !== 1) {
    const error = new Error(
      "Payment initiation status was not updated; reconciliation required",
    );

    error.statusCode = 409;
    error.requiresReview = true;
    throw error;
  }

  return {
    paymentOrderId,
    transactionStatus: status,
    updated: true,
  };
}

// Read an order belonging to the authenticated customer.

// async function getCustomerPaymentOrder({ userId, tenantId, orderReference }) {
//   const [rows] = await pool.execute(
//     `
//     SELECT
//       payment_order_id,
//       order_reference,
//       amount_paise,
//       currency,
//       provider_code,
//       environment,
//       payment_status,
//       settlement_status,
//       access_status
//     FROM payment_orders
//     WHERE tenant_id = ?
//       AND user_id = ?
//       AND order_reference = ?
//     LIMIT 1
//     `,
//     [tenantId, userId, orderReference],
//   );

//   if (!rows.length) {
//     const error = new Error("Payment order not found");
//     error.statusCode = 404;
//     throw error;
//   }

//   return rows[0];
// }

async function getCustomerPaymentOrder({ userId, tenantId, orderReference }) {
  const [rows] = await pool.execute(
    `
    SELECT
      o.order_id AS payment_order_id,
      o.order_number AS order_reference,
      o.total_amount,
      o.currency,
      o.payment_environment AS environment,
      o.status AS order_status,

      p.gateway AS provider_code,
      p.status AS transaction_status,
      p.initiation_status,

      CASE
        WHEN o.status = 'paid'
         AND p.status = 'success'
        THEN 'success'
        WHEN o.status = 'failed'
          OR p.status = 'failed'
        THEN 'failed'
        ELSE 'pending'
      END AS payment_status,

      'pending' AS settlement_status,

      CASE
        WHEN EXISTS (
          SELECT 1
          FROM ebook_access ea
          INNER JOIN order_items oi
            ON oi.tenant_id = ea.tenant_id
           AND oi.order_item_id = ea.order_item_id
          WHERE ea.tenant_id = o.tenant_id
            AND ea.user_id = o.user_id
            AND oi.order_id = o.order_id
            AND ea.revoked_at IS NULL
        )
        THEN 'granted'
        ELSE 'locked'
      END AS access_status

    FROM orders o
    INNER JOIN payments p
      ON p.tenant_id = o.tenant_id
     AND p.order_id = o.order_id

    WHERE o.tenant_id = ?
      AND o.user_id = ?
      AND o.order_number = ?
      AND o.payment_environment IS NOT NULL

    LIMIT 2
    `,
    [tenantId, userId, orderReference],
  );

  if (rows.length !== 1) {
    const error = new Error(
      rows.length === 0
        ? "Payment order not found"
        : "Multiple payment records require review",
    );

    error.statusCode = rows.length === 0 ? 404 : 409;
    throw error;
  }

  const order = rows[0];

  const amountText = String(order.total_amount);

  if (!/^\d+(\.\d{1,2})?$/.test(amountText)) {
    throw new Error("Invalid stored order amount");
  }

  const [rupees, fraction = ""] = amountText.split(".");

  const amountPaise = BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, "0"));

  if (amountPaise > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Stored order amount exceeds safe range");
  }

  return {
    payment_order_id: order.payment_order_id,
    order_reference: order.order_reference,
    amount_paise: Number(amountPaise),
    currency: order.currency,
    provider_code: order.provider_code,
    environment: order.environment,
    payment_status: order.payment_status,
    settlement_status: order.settlement_status,
    access_status: order.access_status,
    initiation_status: order.initiation_status,
  };
}

// Persist a gateway-verified payment result.
// Never updates settlement_status or access_status.
// async function reconcileVerifiedPayment({
//   userId,
//   tenantId,
//   orderReference,
//   gatewayState,
//   verifiedAmountPaise,
// }) {
//   const connection = await pool.getConnection();

//   try {
//     await connection.beginTransaction();

//     const [rows] = await connection.execute(
//       `
//       SELECT
//         payment_order_id,
//         amount_paise,
//         provider_code,
//         environment,
//         payment_status,
//         settlement_status,
//         access_status
//       FROM payment_orders
//       WHERE tenant_id = ?
//         AND user_id = ?
//         AND order_reference = ?
//       LIMIT 1
//       FOR UPDATE
//       `,
//       [tenantId, userId, orderReference]
//     );

//     if (!rows.length) {
//       const error = new Error("Payment order not found");
//       error.statusCode = 404;
//       throw error;
//     }

//     const order = rows[0];

//     if (order.provider_code !== "phonepe") {
//       const error = new Error("Invalid payment provider");
//       error.statusCode = 409;
//       throw error;
//     }

//     if (
//       order.payment_status === "success" ||
//       order.payment_status === "failed"
//     ) {
//       await connection.commit();

//       return {
//         orderReference,
//         paymentStatus: order.payment_status,
//         settlementStatus: order.settlement_status,
//         accessStatus: order.access_status,
//         alreadyFinalized: true,
//       };
//     }

//     const state = String(gatewayState).toUpperCase();

//     // Only explicit, verified terminal states can change
//     // the payment status.
//     if (!["COMPLETED", "FAILED"].includes(state)) {
//       await connection.commit();

//       return {
//         orderReference,
//         paymentStatus: order.payment_status,
//         settlementStatus: order.settlement_status,
//         accessStatus: order.access_status,
//         reconciliationPending: true,
//       };
//     }

//     // A completed payment must have a matching amount.
//     // Missing or mismatched amounts require investigation.
//     if (
//       state === "COMPLETED" &&
//       (
//         !Number.isSafeInteger(verifiedAmountPaise) ||
//         verifiedAmountPaise !== Number(order.amount_paise)
//       )
//     ) {
//       await connection.commit();

//       return {
//         orderReference,
//         paymentStatus: order.payment_status,
//         settlementStatus: order.settlement_status,
//         accessStatus: order.access_status,
//         requiresReview: true,
//         message: "Gateway amount missing or mismatched",
//       };
//     }

//     const newStatus =
//       state === "COMPLETED" ? "success" : "failed";

//     await connection.execute(
//       `
//       UPDATE payment_orders
//       SET payment_status = ?
//       WHERE payment_order_id = ?
//         AND payment_status = 'pending'
//       `,
//       [newStatus, order.payment_order_id]
//     );

//     await connection.execute(
//       `
//       UPDATE payment_transactions
//       SET transaction_status = ?
//       WHERE payment_order_id = ?
//         AND provider_code = 'phonepe'
//         AND transaction_status IN (
//           'created',
//           'initiating',
//           'initiated',
//           'initiation_unknown'
//         )
//       `,
//       [newStatus, order.payment_order_id]
//     );

//     await connection.commit();

//     return {
//       orderReference,
//       paymentStatus: newStatus,
//       settlementStatus: order.settlement_status,
//       accessStatus: order.access_status,
//       alreadyFinalized: false,
//     };
//   } catch (error) {
//     await connection.rollback();
//     throw error;
//   } finally {
//     connection.release();
//   }
// }

// async function reconcileVerifiedPayment({
//   userId,
//   tenantId,
//   orderReference,
//   gatewayState,
//   verifiedAmountPaise,
// }) {
//   const state = String(gatewayState || "").toUpperCase();

//   if (!["COMPLETED", "FAILED", "PENDING"].includes(state)) {
//     const error = new Error("Unrecognized gateway payment state");
//     error.statusCode = 422;
//     throw error;
//   }

//   const connection = await pool.getConnection();
//   let transactionStarted = false;

//   try {
//     await connection.beginTransaction();
//     transactionStarted = true;

//     const [rows] = await connection.execute(
//       `
//       SELECT
//         payment_order_id,
//         amount_paise,
//         provider_code,
//         environment,
//         payment_status,
//         settlement_status,
//         access_status
//       FROM payment_orders
//       WHERE tenant_id = ?
//         AND user_id = ?
//         AND order_reference = ?
//       LIMIT 1
//       FOR UPDATE
//       `,
//       [tenantId, userId, orderReference],
//     );

//     if (rows.length !== 1) {
//       const error = new Error("Payment order not found");
//       error.statusCode = 404;
//       throw error;
//     }

//     const order = rows[0];

//     if (order.provider_code !== "phonepe" || order.environment !== "test") {
//       const error = new Error("Invalid payment provider or environment");
//       error.statusCode = 409;
//       throw error;
//     }

//     const expectedAmount = Number(order.amount_paise);

//     // Never accept missing, invalid or mismatched amounts
//     // for a completed payment.
//     if (
//       state === "COMPLETED" &&
//       (!Number.isSafeInteger(verifiedAmountPaise) ||
//         verifiedAmountPaise <= 0 ||
//         !Number.isSafeInteger(expectedAmount) ||
//         verifiedAmountPaise !== expectedAmount)
//     ) {
//       await connection.commit();
//       transactionStarted = false;

//       return {
//         orderReference,
//         paymentStatus: order.payment_status,
//         settlementStatus: order.settlement_status,
//         accessStatus: order.access_status,
//         requiresReview: true,
//         message: "Gateway payment amount verification failed",
//       };
//     }

//     const targetStatus =
//       state === "COMPLETED"
//         ? "success"
//         : state === "FAILED"
//           ? "failed"
//           : "pending";

//     // A terminal status must never be silently overwritten.
//     if (
//       order.payment_status === "success" ||
//       order.payment_status === "failed"
//     ) {
//       const conflict =
//         targetStatus !== "pending" && targetStatus !== order.payment_status;

//       await connection.commit();
//       transactionStarted = false;

//       return {
//         orderReference,
//         paymentStatus: order.payment_status,
//         settlementStatus: order.settlement_status,
//         accessStatus: order.access_status,
//         alreadyFinalized: true,
//         requiresReview: conflict,
//         message: conflict
//           ? "Gateway status conflicts with recorded payment status"
//           : "Payment already finalized",
//       };
//     }

//     if (order.payment_status !== "pending") {
//       const error = new Error("Unexpected payment status");
//       error.statusCode = 409;
//       throw error;
//     }

//     if (targetStatus === "pending") {
//       await connection.commit();
//       transactionStarted = false;

//       return {
//         orderReference,
//         paymentStatus: "pending",
//         settlementStatus: order.settlement_status,
//         accessStatus: order.access_status,
//         reconciliationPending: true,
//       };
//     }

//     const [paymentUpdate] = await connection.execute(
//       `
//       UPDATE payment_orders
//       SET payment_status = ?
//       WHERE payment_order_id = ?
//         AND payment_status = 'pending'
//       `,
//       [targetStatus, order.payment_order_id],
//     );

//     if (paymentUpdate.affectedRows !== 1) {
//       throw new Error("Payment order status update failed");
//     }

//     const [transactionUpdate] = await connection.execute(
//       `
//       UPDATE payment_transactions
//       SET transaction_status = ?
//       WHERE payment_order_id = ?
//         AND provider_code = 'phonepe'
//         AND transaction_status IN (
//           'created',
//           'initiating',
//           'initiated',
//           'initiation_unknown'
//         )
//       `,
//       [targetStatus, order.payment_order_id],
//     );

//     if (transactionUpdate.affectedRows !== 1) {
//       throw new Error("Payment transaction status update failed");
//     }

//     await connection.commit();
//     transactionStarted = false;

//     return {
//       orderReference,
//       paymentStatus: targetStatus,
//       settlementStatus: order.settlement_status,
//       accessStatus: order.access_status,
//       alreadyFinalized: false,
//       requiresReview: false,
//     };
//   } catch (error) {
//     if (transactionStarted) {
//       await connection.rollback();
//     }

//     throw error;
//   } finally {
//     connection.release();
//   }
// }

async function reconcileVerifiedPayment({
  userId,
  tenantId,
  orderReference,
  gatewayState,
  verifiedAmountPaise,
  verifiedTransactionId,
}) {
  const state = String(gatewayState || "").toUpperCase();

  if (!["COMPLETED", "FAILED", "PENDING"].includes(state)) {
    const error = new Error("Unrecognized gateway payment state");
    error.statusCode = 422;
    throw error;
  }

  if (tenantId !== TENANT_ID) {
    throw new Error("Invalid tenant");
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Lock the order before its payment.
    const [orders] = await connection.execute(
      `
      SELECT order_id, order_number, total_amount,
             status, payment_environment
      FROM orders
      WHERE tenant_id = ?
        AND user_id = ?
        AND order_number = ?
        AND payment_environment IS NOT NULL
      FOR UPDATE
      `,
      [tenantId, userId, orderReference],
    );

    if (orders.length !== 1) {
      const error = new Error("Payment order not found");
      error.statusCode = 404;
      throw error;
    }

    const order = orders[0];

    const [payments] = await connection.execute(
      `
      SELECT payment_id, gateway, gateway_order_id,
            gateway_txn_id, amount, status, initiation_status
      FROM payments
      WHERE tenant_id = ?
        AND order_id = ?
      FOR UPDATE
      `,
      [tenantId, order.order_id],
    );

    if (payments.length !== 1) {
      throw new Error("Payment records require review");
    }

    const payment = payments[0];

    if (
      payment.gateway !== "phonepe" ||
      payment.gateway_order_id !== orderReference ||
      !["test", "live"].includes(order.payment_environment)
    ) {
      throw new Error("Payment gateway or order mismatch");
    }

    const toPaise = (value) => {
      const text = String(value);

      if (!/^\d+(\.\d{1,2})?$/.test(text)) {
        throw new Error("Invalid stored amount");
      }

      const [whole, fraction = ""] = text.split(".");

      return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
    };

    const expectedAmount = toPaise(order.total_amount);

    if (
      expectedAmount <= 0n ||
      expectedAmount > BigInt(Number.MAX_SAFE_INTEGER) ||
      toPaise(payment.amount) !== expectedAmount
    ) {
      throw new Error("Stored order/payment amount mismatch");
    }

    const currentStatus =
      order.status === "paid" && payment.status === "success"
        ? "success"
        : order.status === "failed" && payment.status === "failed"
          ? "failed"
          : "pending";

    // Existing terminal states cannot be overwritten.
    if (
      order.status === "paid" ||
      order.status === "failed" ||
      payment.status === "success" ||
      payment.status === "failed"
    ) {
      const targetStatus =
        state === "COMPLETED"
          ? "success"
          : state === "FAILED"
            ? "failed"
            : "pending";

      // const conflict =
      //   currentStatus === "pending" ||
      //   (targetStatus !== "pending" && targetStatus !== currentStatus);

      // await connection.commit();

      // return {
      //   orderReference,
      //   paymentStatus: currentStatus,
      //   settlementStatus: "pending",
      //   accessStatus: "locked",
      //   alreadyFinalized: true,
      //   requiresReview: conflict,
      // };

      const transactionConflict =
        state === "COMPLETED" &&
        (typeof verifiedTransactionId !== "string" ||
          !verifiedTransactionId.trim() ||
          payment.gateway_txn_id !== verifiedTransactionId);

      const conflict =
        currentStatus === "pending" ||
        (targetStatus !== "pending" && targetStatus !== currentStatus) ||
        transactionConflict;

      const [accessRows] = await connection.execute(
        `
        SELECT COUNT(*) AS total
        FROM ebook_access ea
        INNER JOIN order_items oi
          ON oi.tenant_id = ea.tenant_id
        AND oi.order_item_id = ea.order_item_id
        AND oi.product_id = ea.product_id
        WHERE ea.tenant_id = ?
          AND ea.user_id = ?
          AND oi.order_id = ?
          AND ea.revoked_at IS NULL
        `,
        [tenantId, userId, order.order_id],
      );

      const hasAccess =
        currentStatus === "success" && Number(accessRows[0].total) > 0;

      await connection.commit();

      return {
        orderReference,
        paymentStatus: currentStatus,
        settlementStatus: "pending",
        accessStatus: hasAccess ? "granted" : "locked",
        alreadyFinalized: true,
        requiresReview: conflict || (currentStatus === "success" && !hasAccess),
      };
    }

    if (order.status !== "pending" || payment.status !== "initiated") {
      throw new Error("Unexpected payment state");
    }

    if (state === "PENDING") {
      await connection.commit();

      return {
        orderReference,
        paymentStatus: "pending",
        settlementStatus: "pending",
        accessStatus: "locked",
        reconciliationPending: true,
      };
    }

    if (
      state === "COMPLETED" &&
      (!Number.isSafeInteger(verifiedAmountPaise) ||
        verifiedAmountPaise <= 0 ||
        BigInt(verifiedAmountPaise) !== expectedAmount)
    ) {
      await connection.commit();

      return {
        orderReference,
        paymentStatus: "pending",
        settlementStatus: "pending",
        accessStatus: "locked",
        requiresReview: true,
        message: "Gateway amount verification failed",
      };
    }

    const successful = state === "COMPLETED";

    if (
      successful &&
      (typeof verifiedTransactionId !== "string" ||
        !verifiedTransactionId.trim() ||
        verifiedTransactionId.length > 150)
    ) {
      const error = new Error("Verified transation ID required");
      error.statusCode = 400;
      throw error;
    }

    const [orderUpdate] = await connection.execute(
      `
      UPDATE orders
      SET status = ?,
          paid_at = CASE WHEN ? = 1 THEN NOW() ELSE paid_at END
      WHERE tenant_id = ?
        AND order_id = ?
        AND status = 'pending'
      `,
      [
        successful ? "paid" : "failed",
        successful ? 1 : 0,
        tenantId,
        order.order_id,
      ],
    );

    const [paymentUpdate] = await connection.execute(
      `
      UPDATE payments
      SET status = ?,
          gateway_txn_id = CASE
            WHEN ? = 1 THEN ?
            ELSE gateway_txn_id
          END,
          paid_at = CASE
            WHEN ? = 1 THEN NOW()
            ELSE paid_at
          END
      WHERE tenant_id = ?
        AND payment_id = ?
        AND status = 'initiated'
      `,
      [
        successful ? "success" : "failed",
        successful ? 1 : 0,
        successful ? verifiedTransactionId : null,
        successful ? 1 : 0,
        tenantId,
        payment.payment_id,
      ],
    );

    if (orderUpdate.affectedRows !== 1 || paymentUpdate.affectedRows !== 1) {
      throw new Error("Payment reconciliation update failed");
    }

    // Grant book access atomically with verified successful payment.
    // A failed insert rolls back BOTH payment updates and access grant.
    if (successful) {
      const [items] = await connection.execute(
        `
        SELECT order_item_id, product_id
        FROM order_items
        WHERE tenant_id = ?
          AND order_id = ?
        FOR UPDATE
        `,
        [tenantId, order.order_id],
      );

      if (items.length !== 1) {
        throw new Error("Expected exactly one book in payment order");
      }

      const item = items[0];

      await connection.execute(
        `
        INSERT INTO ebook_access (
          tenant_id,
          user_id,
          product_id,
          order_item_id
        )
        VALUES (?, ?, ?, ?)
        `,
        [tenantId, userId, item.product_id, item.order_item_id],
      );
    }

    await connection.commit();

    return {
      orderReference,
      paymentStatus: successful ? "success" : "failed",
      settlementStatus: "pending",
      // accessStatus: "locked",
      accessStatus: successful ? "granted" : "locked",
      alreadyFinalized: false,
      requiresReview: false,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// Store an authenticated gateway webhook.
// Assumed table: payment_webhook_events

// async function savePaymentWebhookEvent({ providerCode, eventHash, payload }) {
//   if (!["phonepe", "mswipe"].includes(providerCode)) {
//     throw new Error("Unsupported webhook provider");
//   }

//   if (typeof eventHash !== "string" || !/^[a-f0-9]{64}$/.test(eventHash)) {
//     throw new Error("Invalid webhook event hash");
//   }

//   if (typeof payload !== "string" || !payload) {
//     throw new Error("Invalid webhook payload");
//   }

//   try {
//     const [result] = await pool.execute(
//       `
//       INSERT INTO payment_webhook_events (
//         provider_code,
//         event_hash,
//         payload,
//         processing_status,
//         received_at
//       )
//       VALUES (?, ?, ?, 'pending', NOW())
//       `,
//       [providerCode, eventHash, payload],
//     );

//     return {
//       eventId: result.insertId,
//       duplicate: false,
//       processingStatus: "pending",
//     };
//   } catch (error) {
//     if (error.code !== "ER_DUP_ENTRY") {
//       throw error;
//     }

//     const [rows] = await pool.execute(
//       `
//       SELECT
//         event_id,
//         processing_status
//       FROM payment_webhook_events
//       WHERE provider_code = ?
//         AND event_hash = ?
//       LIMIT 1
//       `,
//       [providerCode, eventHash],
//     );

//     if (!rows.length) {
//       throw error;
//     }

//     return {
//       eventId: rows[0].event_id,
//       duplicate: true,
//       processingStatus: rows[0].processing_status,
//     };
//   }
// }

async function savePaymentWebhookEvent({ providerCode, eventHash, payload }) {
  if (!SUPPORTED_GATEWAYS.includes(providerCode)) {
    throw new Error("Unsupported webhook provider");
  }

  if (typeof eventHash !== "string" || !/^[a-f0-9]{64}$/.test(eventHash)) {
    throw new Error("Invalid webhook event hash");
  }

  if (typeof payload !== "string" || !payload.trim()) {
    throw new Error("Invalid webhook payload");
  }

  let parsedPayload;

  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    throw new Error("Webhook payload must be valid JSON");
  }

  if (
    !parsedPayload ||
    typeof parsedPayload !== "object" ||
    Array.isArray(parsedPayload)
  ) {
    throw new Error("Invalid webhook JSON structure");
  }

  try {
    const [result] = await pool.execute(
      `
      INSERT INTO payment_webhook_events (
        tenant_id,
        gateway,
        gateway_event_id,
        event_type,
        payload,
        signature_valid,
        processing_status
      )
      VALUES (?, ?, ?, ?, ?, 1, 'received')
      `,
      [TENANT_ID, providerCode, eventHash, "callback", payload],
    );

    return {
      eventId: result.insertId,
      duplicate: false,
      processingStatus: "received",
    };
  } catch (error) {
    if (error.code !== "ER_DUP_ENTRY") {
      throw error;
    }

    const [rows] = await pool.execute(
      `
      SELECT event_id, processing_status
      FROM payment_webhook_events
      WHERE tenant_id = ?
        AND gateway = ?
        AND gateway_event_id = ?
      LIMIT 1
      `,
      [TENANT_ID, providerCode, eventHash],
    );

    if (rows.length !== 1) {
      throw error;
    }

    return {
      eventId: rows[0].event_id,
      duplicate: true,
      processingStatus: rows[0].processing_status,
    };
  }
}

// async function getPaymentInitiationRecoveryState({
//   userId,
//   tenantId,
//   orderReference,
// }) {
//   const [rows] = await pool.execute(
//     `
//     SELECT
//       po.payment_order_id,
//       po.order_reference,
//       po.provider_code,
//       po.environment,
//       po.payment_status,
//       po.settlement_status,
//       po.access_status,
//       pt.transaction_status
//     FROM payment_orders po
//     INNER JOIN payment_transactions pt
//       ON pt.payment_order_id = po.payment_order_id
//      AND pt.provider_code = po.provider_code
//     WHERE po.user_id = ?
//       AND po.tenant_id = ?
//       AND po.order_reference = ?
//     LIMIT 2
//     `,
//     [userId, tenantId, orderReference],
//   );

//   if (rows.length !== 1) {
//     const error = new Error(
//       rows.length === 0
//         ? "Payment order or transaction not found"
//         : "Multiple payment transactions require review",
//     );
//     error.statusCode = rows.length === 0 ? 404 : 409;
//     throw error;
//   }

//   return rows[0];
// }

async function getPaymentInitiationRecoveryState({
  userId,
  tenantId,
  orderReference,
}) {
  if (
    !Number.isSafeInteger(Number(userId)) ||
    Number(userId) <= 0 ||
    tenantId !== TENANT_ID ||
    typeof orderReference !== "string" ||
    !/^SKS_[a-f0-9]{32}$/.test(orderReference)
  ) {
    const error = new Error("Invalid recovery request");
    error.statusCode = 400;
    throw error;
  }

  const [rows] = await pool.execute(
    `
    SELECT
      o.order_id AS payment_order_id,
      o.order_number AS order_reference,
      o.payment_environment AS environment,
      o.status AS order_status,

      p.gateway AS provider_code,
      p.status AS payment_transaction_status,
      p.initiation_status AS transaction_status,

      CASE
        WHEN o.status = 'paid'
         AND p.status = 'success'
          THEN 'success'
        WHEN o.status = 'failed'
          OR p.status = 'failed'
          THEN 'failed'
        ELSE 'pending'
      END AS payment_status,

      'pending' AS settlement_status,

      CASE
        WHEN EXISTS (
          SELECT 1
          FROM ebook_access ea
          INNER JOIN order_items oi
            ON oi.tenant_id = ea.tenant_id
           AND oi.order_item_id = ea.order_item_id
          WHERE ea.tenant_id = o.tenant_id
            AND ea.user_id = o.user_id
            AND oi.order_id = o.order_id
            AND ea.revoked_at IS NULL
        )
          THEN 'granted'
        ELSE 'locked'
      END AS access_status

    FROM orders o
    INNER JOIN payments p
      ON p.tenant_id = o.tenant_id
     AND p.order_id = o.order_id

    WHERE o.tenant_id = ?
      AND o.user_id = ?
      AND o.order_number = ?
      AND o.payment_environment IS NOT NULL

    LIMIT 2
    `,
    [tenantId, userId, orderReference],
  );

  if (rows.length !== 1) {
    const error = new Error(
      rows.length === 0
        ? "Payment order not found"
        : "Multiple payment records require review",
    );

    error.statusCode = rows.length === 0 ? 404 : 409;
    throw error;
  }

  return rows[0];
}

module.exports = {
  getSelectedGateway,
  getGatewayAvailability,
  saveSelectedGateway,
  createPendingPaymentOrder,
  claimPaymentInitiation,
  updatePaymentInitiationStatus,
  getCustomerPaymentOrder,
  reconcileVerifiedPayment,
  savePaymentWebhookEvent,
  getPaymentInitiationRecoveryState,
};
