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
    [TENANT_ID]
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
    [TENANT_ID, id]
  );

  if (rows.length !== 1) {
    const error = new Error(
      rows.length === 0
        ? "Payment order not found"
        : "Payment order requires review"
    );
    error.statusCode = rows.length === 0 ? 404 : 409;
    throw error;
  }

  return rows[0];
}

module.exports = {
  getPendingSettlements,
  getSettlementDetails,
};