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

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Check for an existing checkout request.
    const [existing] = await connection.execute(
      `
      SELECT *
      FROM payment_orders
      WHERE tenant_id = ?
        AND user_id = ?
        AND idempotency_key = ?
      LIMIT 1
      `,
      [tenantId, userId, idempotencyKey],
    );

    if (existing.length) {
      const order = existing[0];

      if (
        Number(order.product_id) !== productId ||
        order.environment !== environment
      ) {
        const error = new Error(
          "Idempotency key already used for another checkout",
        );

        error.statusCode = 409;

        throw error;
      }

      await connection.commit();

      return {
        reused: true,
        order: {
          paymentOrderId: order.payment_order_id,
          orderReference: order.order_reference,
          productId: order.product_id,
          amountPaise: order.amount_paise,
          currency: order.currency,
          providerCode: order.provider_code,
          environment: order.environment,
          paymentStatus: order.payment_status,
          settlementStatus: order.settlement_status,
          accessStatus: order.access_status,
        },
      };
    }

    // 2. Read actual product price from database.
    const [products] = await connection.execute(
      `
      SELECT product_id, title, price, is_active
      FROM products
      WHERE tenant_id = ?
        AND product_id = ?
      LIMIT 1
      `,
      [tenantId, productId],
    );

    if (!products.length || !products[0].is_active) {
      throw new Error("Product is unavailable");
    }

    const product = products[0];

    // Assumes price is stored as a decimal INR value.
    const price = String(product.price);

    if (!/^\d+(\.\d{1,2})?$/.test(price)) {
      throw new Error("Invalid product price");
    }

    const [rupees, fraction = ""] = price.split(".");

    const amountPaise = BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, "0"));

    if (amountPaise < 100n || amountPaise > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Product price must be at least INR 1");
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
    const [providers] = await connection.execute(
      `
      SELECT provider_id, status
      FROM payment_gateway_providers
      WHERE tenant_id = ?
        AND provider_code = ?
      LIMIT 1
      `,
      [tenantId, providerCode],
    );

    if (!providers.length || providers[0].status !== "active") {
      throw new Error("Selected payment provider is inactive");
    }

    // 5. Create order reference.
    const orderReference = "SKS_" + crypto.randomUUID().replace(/-/g, "");

    // 6. Save pending order.
    const [orderResult] = await connection.execute(
      `
      INSERT INTO payment_orders (
        tenant_id,
        order_reference,
        idempotency_key,
        user_id,
        product_id,
        amount_paise,
        currency,
        provider_code,
        environment,
        payment_status,
        settlement_status,
        access_status
      )
      VALUES (?, ?, ?, ?, ?, ?, 'INR', ?, ?,
              'pending', 'pending', 'locked')
      `,
      [
        tenantId,
        orderReference,
        idempotencyKey,
        userId,
        productId,
        Number(amountPaise),
        providerCode,
        environment,
      ],
    );

    // 7. Create transaction record.
    await connection.execute(
      `
      INSERT INTO payment_transactions (
        payment_order_id,
        provider_code,
        amount_paise,
        transaction_status
      )
      VALUES (?, ?, ?, 'created')
      `,
      [orderResult.insertId, providerCode, Number(amountPaise)],
    );

    await connection.commit();

    return {
      reused: false,
      order: {
        paymentOrderId: orderResult.insertId,
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
    if (error.code === "ER_DUP_ENTRY") {
      const [existingOrders] = await pool.query(
        `
        SELECT
          payment_order_id,
          order_reference,
          product_id,
          amount_paise,
          currency,
          provider_code,
          environment,
          payment_status,
          settlement_status,
          access_status
        FROM payment_orders
        WHERE tenant_id = ?
          AND user_id = ?
          AND idempotency_key = ?
        LIMIT 1
        `,
        [tenantId, userId, idempotencyKey],
      );

      if (existingOrders.length > 0) {
        const existing = existingOrders[0];

        if (
          Number(existing.product_id) !== Number(productId) ||
          existing.environment !== environment
        ) {
          const conflict = new Error(
            "Idempotency key already used for a different checkout",
          );
          conflict.statusCode = 409;
          throw conflict;
        }

        return {
          reused: true,
          order: {
            paymentOrderId: existing.payment_order_id,
            orderReference: existing.order_reference,
            productId: existing.product_id,
            amountPaise: existing.amount_paise,
            currency: existing.currency,
            providerCode: existing.provider_code,
            environment: existing.environment,
            paymentStatus: existing.payment_status,
            settlementStatus: existing.settlement_status,
            accessStatus: existing.access_status,
          },
        };
      }
    }

    throw error;
  } finally {
    connection.release();
  }
}

async function claimPaymentInitiation({ userId, tenantId, orderReference }) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [orders] = await connection.execute(
      `SELECT payment_order_id, order_reference, user_id,
              amount_paise, provider_code, environment,
              payment_status, access_status
       FROM payment_orders
       WHERE order_reference = ?
         AND user_id = ?
         AND tenant_id = ?
       LIMIT 1
       FOR UPDATE`,
      [orderReference, userId, tenantId],
    );

    if (!orders.length) {
      const error = new Error("Payment order not found");
      error.statusCode = 404;
      throw error;
    }

    const order = orders[0];

    if (
      order.provider_code !== "phonepe" ||
      order.environment !== "test" ||
      order.payment_status !== "pending" ||
      order.access_status !== "locked"
    ) {
      const error = new Error("Order cannot initiate PhonePe payment");
      error.statusCode = 409;
      throw error;
    }

    const [result] = await connection.execute(
      `UPDATE payment_transactions
       SET transaction_status = 'initiating'
       WHERE payment_order_id = ?
         AND provider_code = 'phonepe'
         AND transaction_status = 'created'`,
      [order.payment_order_id],
    );

    if (result.affectedRows !== 1) {
      const error = new Error("Payment initiation already attempted");
      error.statusCode = 409;
      throw error;
    }

    await connection.commit();

    return {
      paymentOrderId: order.payment_order_id,
      orderReference: order.order_reference,
      amountPaise: Number(order.amount_paise),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updatePaymentInitiationStatus({ paymentOrderId, status }) {
  if (!["initiated", "initiation_unknown"].includes(status)) {
    const error = new Error("Invalid initiation status");
    error.statusCode = 400;
    throw error;
  }

  if (!Number.isSafeInteger(Number(paymentOrderId))) {
    const error = new Error("Invalid payment order ID");
    error.statusCode = 400;
    throw error;
  }

  const [result] = await pool.execute(
    `
    UPDATE payment_transactions
    SET transaction_status = ?
    WHERE payment_order_id = ?
      AND transaction_status = 'initiating'
    `,
    [status, paymentOrderId],
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
async function getCustomerPaymentOrder({ userId, tenantId, orderReference }) {
  const [rows] = await pool.execute(
    `
    SELECT
      payment_order_id,
      order_reference,
      amount_paise,
      currency,
      provider_code,
      environment,
      payment_status,
      settlement_status,
      access_status
    FROM payment_orders
    WHERE tenant_id = ?
      AND user_id = ?
      AND order_reference = ?
    LIMIT 1
    `,
    [tenantId, userId, orderReference],
  );

  if (!rows.length) {
    const error = new Error("Payment order not found");
    error.statusCode = 404;
    throw error;
  }

  return rows[0];
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

async function reconcileVerifiedPayment({
  userId,
  tenantId,
  orderReference,
  gatewayState,
  verifiedAmountPaise,
}) {
  const state = String(gatewayState || "").toUpperCase();

  if (!["COMPLETED", "FAILED", "PENDING"].includes(state)) {
    const error = new Error("Unrecognized gateway payment state");
    error.statusCode = 422;
    throw error;
  }

  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    const [rows] = await connection.execute(
      `
      SELECT
        payment_order_id,
        amount_paise,
        provider_code,
        environment,
        payment_status,
        settlement_status,
        access_status
      FROM payment_orders
      WHERE tenant_id = ?
        AND user_id = ?
        AND order_reference = ?
      LIMIT 1
      FOR UPDATE
      `,
      [tenantId, userId, orderReference],
    );

    if (rows.length !== 1) {
      const error = new Error("Payment order not found");
      error.statusCode = 404;
      throw error;
    }

    const order = rows[0];

    if (order.provider_code !== "phonepe" || order.environment !== "test") {
      const error = new Error("Invalid payment provider or environment");
      error.statusCode = 409;
      throw error;
    }

    const expectedAmount = Number(order.amount_paise);

    // Never accept missing, invalid or mismatched amounts
    // for a completed payment.
    if (
      state === "COMPLETED" &&
      (!Number.isSafeInteger(verifiedAmountPaise) ||
        verifiedAmountPaise <= 0 ||
        !Number.isSafeInteger(expectedAmount) ||
        verifiedAmountPaise !== expectedAmount)
    ) {
      await connection.commit();
      transactionStarted = false;

      return {
        orderReference,
        paymentStatus: order.payment_status,
        settlementStatus: order.settlement_status,
        accessStatus: order.access_status,
        requiresReview: true,
        message: "Gateway payment amount verification failed",
      };
    }

    const targetStatus =
      state === "COMPLETED"
        ? "success"
        : state === "FAILED"
          ? "failed"
          : "pending";

    // A terminal status must never be silently overwritten.
    if (
      order.payment_status === "success" ||
      order.payment_status === "failed"
    ) {
      const conflict =
        targetStatus !== "pending" && targetStatus !== order.payment_status;

      await connection.commit();
      transactionStarted = false;

      return {
        orderReference,
        paymentStatus: order.payment_status,
        settlementStatus: order.settlement_status,
        accessStatus: order.access_status,
        alreadyFinalized: true,
        requiresReview: conflict,
        message: conflict
          ? "Gateway status conflicts with recorded payment status"
          : "Payment already finalized",
      };
    }

    if (order.payment_status !== "pending") {
      const error = new Error("Unexpected payment status");
      error.statusCode = 409;
      throw error;
    }

    if (targetStatus === "pending") {
      await connection.commit();
      transactionStarted = false;

      return {
        orderReference,
        paymentStatus: "pending",
        settlementStatus: order.settlement_status,
        accessStatus: order.access_status,
        reconciliationPending: true,
      };
    }

    const [paymentUpdate] = await connection.execute(
      `
      UPDATE payment_orders
      SET payment_status = ?
      WHERE payment_order_id = ?
        AND payment_status = 'pending'
      `,
      [targetStatus, order.payment_order_id],
    );

    if (paymentUpdate.affectedRows !== 1) {
      throw new Error("Payment order status update failed");
    }

    const [transactionUpdate] = await connection.execute(
      `
      UPDATE payment_transactions
      SET transaction_status = ?
      WHERE payment_order_id = ?
        AND provider_code = 'phonepe'
        AND transaction_status IN (
          'created',
          'initiating',
          'initiated',
          'initiation_unknown'
        )
      `,
      [targetStatus, order.payment_order_id],
    );

    if (transactionUpdate.affectedRows !== 1) {
      throw new Error("Payment transaction status update failed");
    }

    await connection.commit();
    transactionStarted = false;

    return {
      orderReference,
      paymentStatus: targetStatus,
      settlementStatus: order.settlement_status,
      accessStatus: order.access_status,
      alreadyFinalized: false,
      requiresReview: false,
    };
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }

    throw error;
  } finally {
    connection.release();
  }
}

// Store an authenticated gateway webhook.
// Assumed table: payment_webhook_events

async function savePaymentWebhookEvent({ providerCode, eventHash, payload }) {
  if (!["phonepe", "mswipe"].includes(providerCode)) {
    throw new Error("Unsupported webhook provider");
  }

  if (typeof eventHash !== "string" || !/^[a-f0-9]{64}$/.test(eventHash)) {
    throw new Error("Invalid webhook event hash");
  }

  if (typeof payload !== "string" || !payload) {
    throw new Error("Invalid webhook payload");
  }

  try {
    const [result] = await pool.execute(
      `
      INSERT INTO payment_webhook_events (
        provider_code,
        event_hash,
        payload,
        processing_status,
        received_at
      )
      VALUES (?, ?, ?, 'pending', NOW())
      `,
      [providerCode, eventHash, payload],
    );

    return {
      eventId: result.insertId,
      duplicate: false,
      processingStatus: "pending",
    };
  } catch (error) {
    if (error.code !== "ER_DUP_ENTRY") {
      throw error;
    }

    const [rows] = await pool.execute(
      `
      SELECT
        event_id,
        processing_status
      FROM payment_webhook_events
      WHERE provider_code = ?
        AND event_hash = ?
      LIMIT 1
      `,
      [providerCode, eventHash],
    );

    if (!rows.length) {
      throw error;
    }

    return {
      eventId: rows[0].event_id,
      duplicate: true,
      processingStatus: rows[0].processing_status,
    };
  }
}

async function getPaymentInitiationRecoveryState({
  userId,
  tenantId,
  orderReference,
}) {
  const [rows] = await pool.execute(
    `
    SELECT
      po.payment_order_id,
      po.order_reference,
      po.provider_code,
      po.environment,
      po.payment_status,
      po.settlement_status,
      po.access_status,
      pt.transaction_status
    FROM payment_orders po
    INNER JOIN payment_transactions pt
      ON pt.payment_order_id = po.payment_order_id
     AND pt.provider_code = po.provider_code
    WHERE po.user_id = ?
      AND po.tenant_id = ?
      AND po.order_reference = ?
    LIMIT 2
    `,
    [userId, tenantId, orderReference],
  );

  if (rows.length !== 1) {
    const error = new Error(
      rows.length === 0
        ? "Payment order or transaction not found"
        : "Multiple payment transactions require review",
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
