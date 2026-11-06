// const pool = require("../DB/db");

// const TENANT_ID = 1;

// async function getPendingSettlements() {
//   const [rows] = await pool.execute(
//     `
//     SELECT
//       payment_order_id,
//       order_reference,
//       user_id,
//       product_id,
//       provider_code,
//       amount_paise,
//       payment_status,
//       settlement_status,
//       access_status
//     FROM payment_orders
//     WHERE tenant_id = ?
//       AND payment_status = 'success'
//       AND settlement_status = 'pending'
//     ORDER BY payment_order_id ASC
//     `,
//     [TENANT_ID]
//   );

//   return rows;
// }

// async function getSettlementDetails(paymentOrderId) {
//   const id = Number(paymentOrderId);

//   if (!Number.isSafeInteger(id) || id <= 0) {
//     const error = new Error("Invalid payment order ID");
//     error.statusCode = 400;
//     throw error;
//   }

//   const [rows] = await pool.execute(
//     `
//     SELECT
//       payment_order_id,
//       order_reference,
//       user_id,
//       product_id,
//       provider_code,
//       amount_paise,
//       payment_status,
//       settlement_status,
//       access_status
//     FROM payment_orders
//     WHERE tenant_id = ?
//       AND payment_order_id = ?
//     LIMIT 1
//     `,
//     [TENANT_ID, id]
//   );

//   if (!rows.length) {
//     const error = new Error("Payment order not found");
//     error.statusCode = 404;
//     throw error;
//   }

//   return rows[0];
// }

// module.exports = {
//   getPendingSettlements,
//   getSettlementDetails,
// };

const pool = require("../DB/db");

const TENANT_ID = 1;

const settlementQuery = `
  SELECT
    o.order_id AS payment_order_id,
    o.order_number AS order_reference,
    o.user_id,
    oi.product_id,
    p.gateway AS provider_code,
    ROUND(o.total_amount * 100) AS amount_paise,
    CASE
      WHEN o.status = 'paid'
       AND p.status = 'success' THEN 'success'
      WHEN o.status = 'failed'
        OR p.status = 'failed' THEN 'failed'
      ELSE 'pending'
    END AS payment_status,
    'unverified' AS settlement_status,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM ebook_access ea
        WHERE ea.tenant_id = o.tenant_id
          AND ea.order_item_id = oi.order_item_id
          AND ea.user_id = o.user_id
          AND ea.revoked_at IS NULL
      ) THEN 'granted'
      ELSE 'locked'
    END AS access_status
  FROM orders o
  JOIN order_items oi
    ON oi.tenant_id = o.tenant_id
   AND oi.order_id = o.order_id
  JOIN payments p
    ON p.tenant_id = o.tenant_id
   AND p.order_id = o.order_id
  WHERE o.tenant_id = ?
    AND o.payment_environment IS NOT NULL
`;

async function getPendingSettlements() {
  const [rows] = await pool.execute(
    `${settlementQuery}
     AND o.status = 'paid'
     AND p.status = 'success'
     ORDER BY o.order_id ASC`,
    [TENANT_ID],
  );

  return rows;
}

async function getSettlementDetails(paymentOrderId) {
  const id = Number(paymentOrderId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    const error = new Error("Invalid payment order ID");
    error.statusCode = 400;
    throw error;
  }

  const [rows] = await pool.execute(
    `${settlementQuery}
     AND o.order_id = ?
     LIMIT 2`,
    [TENANT_ID, id],
  );

  if (rows.length !== 1) {
    const error = new Error(
      rows.length === 0
        ? "Payment order not found"
        : "Payment order requires review",
    );
    error.statusCode = rows.length === 0 ? 404 : 409;
    throw error;
  }

  return rows[0];
}

async function previewOrderCommissions(orderId) {
  const id = Number(orderId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    const error = new Error("Invalid order ID");
    error.statusCode = 400;
    throw error;
  }

  const [orders] = await pool.execute(
    `SELECT o.order_id, o.user_id, o.status,
            o.payment_environment
     FROM orders o
     WHERE o.tenant_id = ? AND o.order_id = ?
     LIMIT 1`,
    [TENANT_ID, id],
  );

  if (!orders.length) {
    const error = new Error("Order not found");
    error.statusCode = 404;
    throw error;
  }

  const order = orders[0];

  if (order.status !== "paid" || !order.payment_environment) {
    const error = new Error("Eligible paid order required");
    error.statusCode = 409;
    throw error;
  }

  const [payments] = await pool.execute(
    `SELECT payment_id
     FROM payments
     WHERE tenant_id = ? AND order_id = ?
       AND status = 'success'
     LIMIT 1`,
    [TENANT_ID, id],
  );

  if (!payments.length) {
    const error = new Error("Successful payment not found");
    error.statusCode = 409;
    throw error;
  }

  const [items] = await pool.execute(
    `SELECT order_item_id, product_id,
          quantity, unit_price, discount_amount,
          commission_rules_snapshot,
          sponsor_chain_snapshot
   FROM order_items
   WHERE tenant_id = ? AND order_id = ?`,
    [TENANT_ID, id],
  );

  // const [users] = await pool.execute(
  //   `SELECT user_id, sponsor_id
  //    FROM users
  //    WHERE tenant_id = ?`,
  //   [TENANT_ID],
  // );

  // const userMap = new Map(users.map((user) => [String(user.user_id), user]));

  // const chain = [];
  // const visited = new Set([String(order.user_id)]);
  // let current = userMap.get(String(order.user_id));

  // while (current && current.sponsor_id != null) {
  //   const sponsorId = String(current.sponsor_id);

  //   if (visited.has(sponsorId)) {
  //     const error = new Error("Referral cycle detected");
  //     error.statusCode = 409;
  //     throw error;
  //   }

  //   const sponsor = userMap.get(sponsorId);

  //   if (!sponsor) {
  //     const error = new Error("Broken sponsor chain");
  //     error.statusCode = 409;
  //     throw error;
  //   }

  //   visited.add(sponsorId);
  //   chain.push(sponsor.user_id);
  //   current = sponsor;
  // }

  const results = [];

  for (const item of items) {
    // const [rules] = await pool.execute(
    //   `SELECT level, commission_percent
    //    FROM product_referral_rules
    //    WHERE tenant_id = ? AND product_id = ?
    //      AND is_active = 1
    //    ORDER BY level ASC`,
    //   [TENANT_ID, item.product_id],
    // );

    if (item.commission_rules_snapshot == null) {
      const error = new Error(
        "Historical order has no commission snapshot; manual review required",
      );
      error.statusCode = 409;
      throw error;
    }

    let rules;

    try {
      const snapshot = item.commission_rules_snapshot;

      rules = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;

      if (
        !Array.isArray(rules) ||
        rules.some(
          (rule) =>
            !Number.isInteger(Number(rule.level)) ||
            Number(rule.level) < 1 ||
            Number(rule.level) > 255 ||
            !Number.isFinite(Number(rule.commission_percent)) ||
            Number(rule.commission_percent) < 0 ||
            Number(rule.commission_percent) > 100,
        ) ||
        new Set(rules.map((rule) => Number(rule.level))).size !== rules.length
      ) {
        throw new Error("Invalid commission snapshot");
      }
    } catch {
      const error = new Error("Invalid saved commission rules snapshot");
      error.statusCode = 409;
      throw error;
    }

    if (item.sponsor_chain_snapshot == null) {
      const error = new Error(
        "Historical order has no sponsor snapshot; manual review required",
      );
      error.statusCode = 409;
      throw error;
    }

    let chain;

    try {
      const snapshot = item.sponsor_chain_snapshot;

      chain = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;

      if (
        !Array.isArray(chain) ||
        chain.some(
          (userId) =>
            !Number.isSafeInteger(Number(userId)) || Number(userId) <= 0,
        ) ||
        new Set(chain.map(String)).size !== chain.length ||
        chain.some((userId) => String(userId) === String(order.user_id))
      ) {
        throw new Error("Invalid sponsor chain");
      }
    } catch {
      const error = new Error("Invalid saved sponsor chain snapshot");
      error.statusCode = 409;
      throw error;
    }

    const basePaise = Math.round(
      (Number(item.unit_price) * Number(item.quantity) -
        Number(item.discount_amount)) *
        100,
    );

    if (!Number.isSafeInteger(basePaise) || basePaise < 0) {
      const error = new Error("Invalid commission base");
      error.statusCode = 409;
      throw error;
    }

    const commissions = rules
      .filter(
        (rule) =>
          Number.isInteger(Number(rule.level)) &&
          Number(rule.level) >= 1 &&
          Number(rule.level) <= chain.length,
      )
      .map((rule) => {
        const level = Number(rule.level);
        const rate = Number(rule.commission_percent);
        const amountPaise = Math.round((basePaise * rate) / 100);

        return {
          level,
          beneficiary_id: chain[level - 1],
          rate_percent: rate,
          amount: (amountPaise / 100).toFixed(2),
        };
      });

    results.push({
      order_item_id: item.order_item_id,
      product_id: item.product_id,
      configured_levels: rules.length,
      sponsor_depth: chain.length,
      base_amount: (basePaise / 100).toFixed(2),
      commissions,
    });
  }

  return {
    order_id: id,
    buyer_id: order.user_id,
    preview_only: true,
    warning:
      "Uses purchase-time commission rates and sponsor chain; preview only",
    items: results,
  };
}

async function processOrderCommissions(orderId) {
  const id = Number(orderId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    const error = new Error("Invalid order ID");
    error.statusCode = 400;
    throw error;
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Serialize commission processing for the same order.
    const [orders] = await connection.execute(
      `SELECT order_id, user_id, status, total_amount,
              payment_environment
       FROM orders
       WHERE tenant_id = ? AND order_id = ?
       FOR UPDATE`,
      [TENANT_ID, id],
    );

    if (orders.length !== 1) {
      throw new Error("Order not found");
    }

    const order = orders[0];

    if (order.status !== "paid" || !order.payment_environment) {
      throw new Error("Order is not eligible for commissions");
    }

    const [payments] = await connection.execute(
      `SELECT payment_id, gateway_txn_id, amount, currency
       FROM payments
       WHERE tenant_id = ?
         AND order_id = ?
         AND status = 'success'
       FOR UPDATE`,
      [TENANT_ID, id],
    );

    if (
      payments.length !== 1 ||
      !payments[0].gateway_txn_id ||
      payments[0].currency !== "INR" ||
      Math.round(Number(payments[0].amount) * 100) !==
        Math.round(Number(order.total_amount) * 100)
    ) {
      throw new Error("Successful matching payment required");
    }

    // Preview uses saved checkout-time snapshots.
    // const preview = await previewOrderCommissions(id);

    // const [existingItems] = await connection.execute(
    //   `SELECT order_item_id
    //    FROM order_items
    //    WHERE tenant_id = ? AND order_id = ?
    //    ORDER BY order_item_id`,
    //   [TENANT_ID, id],
    // );

    // if (existingItems.length !== preview.items.length) {
    //   throw new Error("Order items changed during processing");
    // }

    // Read purchase-time snapshots using the SAME transaction connection.
    const [snapshotItems] = await connection.execute(
      `SELECT order_item_id, product_id, quantity,
          unit_price, discount_amount,
          commission_rules_snapshot,
          sponsor_chain_snapshot
   FROM order_items
   WHERE tenant_id = ? AND order_id = ?
   ORDER BY order_item_id
   FOR UPDATE`,
      [TENANT_ID, id],
    );

    if (snapshotItems.length === 0) {
      throw new Error("Order has no items");
    }

    const preview = {
      order_id: id,
      buyer_id: order.user_id,
      items: [],
    };

    for (const item of snapshotItems) {
      if (
        item.commission_rules_snapshot == null ||
        item.sponsor_chain_snapshot == null
      ) {
        throw new Error(
          "Historical order missing purchase-time snapshots; manual review required",
        );
      }

      let rules;
      let chain;

      try {
        rules =
          typeof item.commission_rules_snapshot === "string"
            ? JSON.parse(item.commission_rules_snapshot)
            : item.commission_rules_snapshot;

        chain =
          typeof item.sponsor_chain_snapshot === "string"
            ? JSON.parse(item.sponsor_chain_snapshot)
            : item.sponsor_chain_snapshot;
      } catch {
        throw new Error("Malformed purchase-time snapshots");
      }

      if (!Array.isArray(rules) || !Array.isArray(chain)) {
        throw new Error("Invalid purchase-time snapshot format");
      }

      const levels = new Set();
      const sponsors = new Set();

      for (const rule of rules) {
        const level = Number(rule?.level);
        const rate = Number(rule?.commission_percent);

        if (
          !Number.isInteger(level) ||
          level < 1 ||
          level > 255 ||
          !Number.isFinite(rate) ||
          rate < 0 ||
          rate > 100 ||
          !Number.isInteger(rate * 100) ||
          levels.has(level)
        ) {
          throw new Error("Invalid saved commission rule");
        }

        levels.add(level);
      }

      for (const sponsorId of chain) {
        const sponsor = Number(sponsorId);

        if (
          !Number.isSafeInteger(sponsor) ||
          sponsor <= 0 ||
          sponsor === Number(order.user_id) ||
          sponsors.has(sponsor)
        ) {
          throw new Error("Invalid saved sponsor chain");
        }

        sponsors.add(sponsor);
      }

      const quantity = Number(item.quantity);
      const unitPricePaise = Math.round(Number(item.unit_price) * 100);
      const discountPaise = Math.round(Number(item.discount_amount) * 100);

      if (
        !Number.isSafeInteger(quantity) ||
        quantity <= 0 ||
        !Number.isSafeInteger(unitPricePaise) ||
        unitPricePaise < 0 ||
        !Number.isSafeInteger(discountPaise) ||
        discountPaise < 0
      ) {
        throw new Error("Invalid commission base inputs");
      }

      const basePaise = unitPricePaise * quantity - discountPaise;

      if (!Number.isSafeInteger(basePaise) || basePaise < 0) {
        throw new Error("Invalid commission base amount");
      }

      const commissions = rules
        .filter((rule) => Number(rule.level) <= chain.length)
        .sort((a, b) => Number(a.level) - Number(b.level))
        .map((rule) => {
          const level = Number(rule.level);
          const rateBasisPoints = Math.round(
            Number(rule.commission_percent) * 100,
          );

          const amountPaise = Math.round((basePaise * rateBasisPoints) / 10000);

          if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) {
            throw new Error("Invalid calculated commission amount");
          }

          return {
            level,
            beneficiary_id: Number(chain[level - 1]),
            rate_percent: Number(rule.commission_percent),
            amount: (amountPaise / 100).toFixed(2),
          };
        });

      preview.items.push({
        order_item_id: item.order_item_id,
        product_id: item.product_id,
        configured_levels: rules.length,
        sponsor_depth: chain.length,
        base_amount: (basePaise / 100).toFixed(2),
        commissions,
      });
    }

    let created = 0;
    let alreadyProcessed = 0;
    let credited = 0;

    for (const item of preview.items) {
      for (const commission of item.commissions) {
        const level = Number(commission.level);
        const beneficiaryId = Number(commission.beneficiary_id);
        const amountPaise = Math.round(Number(commission.amount) * 100);

        if (
          !Number.isSafeInteger(beneficiaryId) ||
          beneficiaryId <= 0 ||
          !Number.isSafeInteger(amountPaise) ||
          amountPaise < 0
        ) {
          throw new Error("Invalid commission calculation");
        }

        // const [existing] = await connection.execute(
        //   `SELECT commission_id
        //    FROM commissions
        //    WHERE tenant_id = ?
        //      AND order_item_id = ?
        //      AND level = ?
        //    FOR UPDATE`,
        //   [TENANT_ID, item.order_item_id, level],
        // );

        // if (existing.length) {
        //   alreadyProcessed++;
        //   continue;
        // }

        // if (existing.length) {
        //   throw new Error(
        //     "Existing commission detected; manual ledger reconciliation required",
        //   );
        // }

        const [existing] = await connection.execute(
          `SELECT commission_id, beneficiary_id, amount, status
   FROM commissions
   WHERE tenant_id = ?
     AND order_item_id = ?
     AND level = ?
   FOR UPDATE`,
          [TENANT_ID, item.order_item_id, level],
        );

        if (existing.length) {
          const saved = existing[0];

          const matches =
            Number(saved.beneficiary_id) === beneficiaryId &&
            Math.round(Number(saved.amount) * 100) === amountPaise &&
            saved.status === "approved";

          if (!matches) {
            throw new Error(
              "Existing commission mismatch; manual review required",
            );
          }

          if (amountPaise > 0) {
            const [ledger] = await connection.execute(
              `SELECT txn_id
       FROM wallet_transactions
       WHERE tenant_id = ?
         AND idempotency_key = ?
         AND user_id = ?
         AND event_type = 'credit'
         AND reference_type = 'commission'
         AND reference_id = ?
         AND amount = ?
       LIMIT 1`,
              [
                TENANT_ID,
                `commission:${saved.commission_id}:credit`,
                beneficiaryId,
                saved.commission_id,
                (amountPaise / 100).toFixed(2),
              ],
            );

            if (ledger.length !== 1) {
              throw new Error(
                "Existing commission has no matching wallet credit; manual reconciliation required",
              );
            }
          }

          alreadyProcessed++;
          continue;
        }

        const amount = (amountPaise / 100).toFixed(2);

        const [inserted] = await connection.execute(
          `INSERT INTO commissions (
             tenant_id, order_item_id,
             beneficiary_id, source_user_id,
             level, base_amount,
             rate_percent, amount, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
          [
            TENANT_ID,
            item.order_item_id,
            beneficiaryId,
            order.user_id,
            level,
            item.base_amount,
            commission.rate_percent,
            amount,
          ],
        );

        created++;

        if (amountPaise === 0) {
          // Zero-value commissions have no wallet credit.
          // Commission record remains approved for idempotency.
          continue;
        }

        // Existing wallet is locked before credit.
        const [wallets] = await connection.execute(
          `SELECT wallet_id, available_balance, reserved_balance
           FROM wallets
           WHERE tenant_id = ? AND user_id = ?
           FOR UPDATE`,
          [TENANT_ID, beneficiaryId],
        );

        if (wallets.length !== 1) {
          throw new Error(`Wallet missing for beneficiary ${beneficiaryId}`);
        }

        const wallet = wallets[0];

        const newBalancePaise =
          Math.round(Number(wallet.available_balance) * 100) + amountPaise;

        if (!Number.isSafeInteger(newBalancePaise)) {
          throw new Error("Wallet balance overflow");
        }

        const newBalance = (newBalancePaise / 100).toFixed(2);

        const idempotencyKey = `commission:${inserted.insertId}:credit`;

        await connection.execute(
          `INSERT INTO wallet_transactions (
             tenant_id, wallet_id, user_id,
             event_type, amount,
             available_after, reserved_after,
             reference_type, reference_id,
             idempotency_key, remark
           ) VALUES (?, ?, ?, 'credit', ?, ?, ?,
                     'commission', ?, ?, ?)`,
          [
            TENANT_ID,
            wallet.wallet_id,
            beneficiaryId,
            amount,
            newBalance,
            wallet.reserved_balance,
            inserted.insertId,
            idempotencyKey,
            `Commission for order ${id}, level ${level}`,
          ],
        );

        await connection.execute(
          `UPDATE wallets
           SET available_balance = ?
           WHERE tenant_id = ? AND wallet_id = ?`,
          [newBalance, TENANT_ID, wallet.wallet_id],
        );

        credited++;
      }
    }

    await connection.commit();

    return {
      order_id: id,
      created,
      already_processed: alreadyProcessed,
      wallet_credits: credited,
      success: true,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  getPendingSettlements,
  getSettlementDetails,
  previewOrderCommissions,
  processOrderCommissions,
};
