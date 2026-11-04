// const pool = require("../DB/db");

// const TENANT_ID = 1;

// async function checkBookAccess({ userId, productId }) {
//   const uid = Number(userId);
//   const pid = Number(productId);

//   if (
//     !Number.isSafeInteger(uid) ||
//     uid <= 0 ||
//     !Number.isSafeInteger(pid) ||
//     pid <= 0
//   ) {
//     const error = new Error("Invalid user or product ID");
//     error.statusCode = 400;
//     throw error;
//   }

//   const [rows] = await pool.execute(
//     `
//     SELECT
//       payment_order_id,
//       order_reference,
//       product_id,
//       payment_status,
//       settlement_status,
//       access_status
//     FROM payment_orders
//     WHERE tenant_id = ?
//       AND user_id = ?
//       AND product_id = ?
//       AND payment_status = 'success'
//       AND settlement_status = 'settled'
//       AND access_status = 'unlocked'
//     ORDER BY payment_order_id DESC
//     LIMIT 1
//     `,
//     [TENANT_ID, uid, pid]
//   );

//   if (!rows.length) {
//     return {
//       hasAccess: false,
//       productId: pid,
//       message: "Book access is not available",
//     };
//   }

//   return {
//     hasAccess: true,
//     productId: pid,
//     paymentOrderId: rows[0].payment_order_id,
//     orderReference: rows[0].order_reference,
//   };
// }

// async function getMyPurchasedBooks(userId) {
//   const uid = Number(userId);

//   if (!Number.isSafeInteger(uid) || uid <= 0) {
//     const error = new Error("Invalid user ID");
//     error.statusCode = 400;
//     throw error;
//   }

//   const [rows] = await pool.execute(
//     `
//     SELECT DISTINCT
//       product_id
//     FROM payment_orders
//     WHERE tenant_id = ?
//       AND user_id = ?
//       AND payment_status = 'success'
//       AND settlement_status = 'settled'
//       AND access_status = 'unlocked'
//     ORDER BY product_id ASC
//     `,
//     [TENANT_ID, uid]
//   );

//   return rows;
// }

// module.exports = {
//   checkBookAccess,
//   getMyPurchasedBooks,
// };

const pool = require("../DB/db");

const TENANT_ID = 1;

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function checkBookAccess({ userId, productId }) {
  const uid = validId(userId);
  const pid = validId(productId);

  if (!uid || !pid) {
    const error = new Error("Invalid user or product ID");
    error.statusCode = 400;
    throw error;
  }

  const [rows] = await pool.execute(
    `
    SELECT
      o.order_id AS payment_order_id,
      o.order_number AS order_reference,
      oi.product_id
    FROM ebook_access ea
    INNER JOIN order_items oi
      ON oi.tenant_id = ea.tenant_id
     AND oi.order_item_id = ea.order_item_id
     AND oi.product_id = ea.product_id
    INNER JOIN orders o
      ON o.tenant_id = oi.tenant_id
     AND o.order_id = oi.order_id
     AND o.user_id = ea.user_id
    WHERE ea.tenant_id = ?
      AND ea.user_id = ?
      AND ea.product_id = ?
      AND ea.revoked_at IS NULL
      AND o.status = 'paid'
      AND EXISTS (
        SELECT 1
        FROM payments p
        WHERE p.tenant_id = o.tenant_id
          AND p.order_id = o.order_id
          AND p.status = 'success'
      )
    ORDER BY ea.granted_at DESC
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
  const uid = validId(userId);

  if (!uid) {
    const error = new Error("Invalid user ID");
    error.statusCode = 400;
    throw error;
  }

  const [rows] = await pool.execute(
    `
    SELECT DISTINCT ea.product_id
    FROM ebook_access ea
    INNER JOIN order_items oi
      ON oi.tenant_id = ea.tenant_id
     AND oi.order_item_id = ea.order_item_id
     AND oi.product_id = ea.product_id
    INNER JOIN orders o
      ON o.tenant_id = oi.tenant_id
     AND o.order_id = oi.order_id
     AND o.user_id = ea.user_id
    WHERE ea.tenant_id = ?
      AND ea.user_id = ?
      AND ea.revoked_at IS NULL
      AND o.status = 'paid'
      AND EXISTS (
        SELECT 1
        FROM payments p
        WHERE p.tenant_id = o.tenant_id
          AND p.order_id = o.order_id
          AND p.status = 'success'
      )
    ORDER BY ea.product_id ASC
    `,
    [TENANT_ID, uid]
  );

  return rows;
}

module.exports = {
  checkBookAccess,
  getMyPurchasedBooks,
};