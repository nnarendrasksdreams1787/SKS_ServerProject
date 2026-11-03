const pool = require("../DB/db");

const TENANT_ID = 1;

async function getPendingSettlements() {
  const [rows] = await pool.execute(
    `
    SELECT
      payment_order_id,
      order_reference,
      user_id,
      product_id,
      provider_code,
      amount_paise,
      payment_status,
      settlement_status,
      access_status
    FROM payment_orders
    WHERE tenant_id = ?
      AND payment_status = 'success'
      AND settlement_status = 'pending'
    ORDER BY payment_order_id ASC
    `,
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
    `
    SELECT
      payment_order_id,
      order_reference,
      user_id,
      product_id,
      provider_code,
      amount_paise,
      payment_status,
      settlement_status,
      access_status
    FROM payment_orders
    WHERE tenant_id = ?
      AND payment_order_id = ?
    LIMIT 1
    `,
    [TENANT_ID, id]
  );

  if (!rows.length) {
    const error = new Error("Payment order not found");
    error.statusCode = 404;
    throw error;
  }

  return rows[0];
}

module.exports = {
  getPendingSettlements,
  getSettlementDetails,
};