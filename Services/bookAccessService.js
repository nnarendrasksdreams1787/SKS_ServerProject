const pool = require("../DB/db");

const TENANT_ID = 1;

async function checkBookAccess({ userId, productId }) {
  const uid = Number(userId);
  const pid = Number(productId);

  if (
    !Number.isSafeInteger(uid) ||
    uid <= 0 ||
    !Number.isSafeInteger(pid) ||
    pid <= 0
  ) {
    const error = new Error("Invalid user or product ID");
    error.statusCode = 400;
    throw error;
  }

  const [rows] = await pool.execute(
    `
    SELECT
      payment_order_id,
      order_reference,
      product_id,
      payment_status,
      settlement_status,
      access_status
    FROM payment_orders
    WHERE tenant_id = ?
      AND user_id = ?
      AND product_id = ?
      AND payment_status = 'success'
      AND settlement_status = 'settled'
      AND access_status = 'unlocked'
    ORDER BY payment_order_id DESC
    LIMIT 1
    `,
    [TENANT_ID, uid, pid]
  );

  if (!rows.length) {
    return {
      hasAccess: false,
      productId: pid,
      message: "Book access is not available",
    };
  }

  return {
    hasAccess: true,
    productId: pid,
    paymentOrderId: rows[0].payment_order_id,
    orderReference: rows[0].order_reference,
  };
}

async function getMyPurchasedBooks(userId) {
  const uid = Number(userId);

  if (!Number.isSafeInteger(uid) || uid <= 0) {
    const error = new Error("Invalid user ID");
    error.statusCode = 400;
    throw error;
  }

  const [rows] = await pool.execute(
    `
    SELECT DISTINCT
      product_id
    FROM payment_orders
    WHERE tenant_id = ?
      AND user_id = ?
      AND payment_status = 'success'
      AND settlement_status = 'settled'
      AND access_status = 'unlocked'
    ORDER BY product_id ASC
    `,
    [TENANT_ID, uid]
  );

  return rows;
}

module.exports = {
  checkBookAccess,
  getMyPurchasedBooks,
};