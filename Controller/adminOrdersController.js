const pool = require("../DB/db");

const TENANT_ID = 1;

const ORDER_STATUSES = [
  "pending",
  "paid",
  "failed",
  "cancelled",
  "partially_refunded",
  "refunded",
];

function parsePagination(query) {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);

  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return null;
  }

  return { page, limit, offset: (page - 1) * limit };
}

// GET /api/admin/orders
exports.getOrders = async (req, res) => {
  try {
    const {
      search = "",
      status = "",
      fromDate = "",
      toDate = "",
      page = "1",
      limit = "20",
    } = req.query;

    const pagination = parsePagination({ page, limit });

    if (!pagination) {
      return res.status(400).json({
        message: "Invalid page or limit. Limit must be between 1 and 100.",
      });
    }

    if (status && !ORDER_STATUSES.includes(status)) {
      return res.status(400).json({
        message: "Invalid order status.",
      });
    }

    const isValidDate = (value) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

    if (
      (fromDate && !isValidDate(fromDate)) ||
      (toDate && !isValidDate(toDate)) ||
      (fromDate && toDate && fromDate > toDate)
    ) {
      return res.status(400).json({
        message: "Invalid date range.",
      });
    }

    const conditions = ["o.tenant_id = ?"];
    const values = [TENANT_ID];

    if (status) {
      conditions.push("o.status = ?");
      values.push(status);
    }

    if (String(search).trim()) {
      const term = `%${String(search).trim()}%`;

      // conditions.push(`(
      //   o.order_number LIKE ?
      //   OR u.full_name LIKE ?
      //   OR u.email LIKE ?
      //   OR u.mobile LIKE ?
      //   OR u.referral_code LIKE ?
      // )`);

      // values.push(term, term, term, term, term);

      conditions.push(`(
        o.order_number LIKE ?
        OR u.full_name LIKE ?
        OR u.mobile LIKE ?
        OR u.reference_id LIKE ?
      )`);

      values.push(term, term, term, term);
    }

    if (fromDate) {
      conditions.push("o.created_at >= ?");
      values.push(`${fromDate} 00:00:00`);
    }

    if (toDate) {
      conditions.push("o.created_at < DATE_ADD(?, INTERVAL 1 DAY)");
      values.push(toDate);
    }

    const whereClause = conditions.join(" AND ");

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM orders o
       INNER JOIN users u
         ON u.user_id = o.user_id
        AND u.tenant_id = o.tenant_id
       WHERE ${whereClause}`,
      values,
    );

    const [orders] = await pool.execute(
      `SELECT
         o.order_id,
         o.order_number,
         o.user_id,
         u.full_name,
         NULL AS email,
         u.mobile,
         u.reference_id AS referral_code,
         o.referrer_id,
         referrer.full_name AS referrer_name,
         o.subtotal,
         o.discount_amount,
         o.tax_amount,
         o.total_amount,
         o.currency,
         o.status,
         (
            SELECT p.status
            FROM payments p
            WHERE p.tenant_id = o.tenant_id
              AND p.order_id = o.order_id
            ORDER BY p.created_at DESC, p.payment_id DESC
            LIMIT 1
         ) AS payment_status,
         o.paid_at,
         o.created_at,
         o.updated_at,
         (
           SELECT COUNT(*)
           FROM order_items oi
           WHERE oi.tenant_id = o.tenant_id
             AND oi.order_id = o.order_id
         ) AS item_count
       FROM orders o
       INNER JOIN users u
         ON u.user_id = o.user_id
        AND u.tenant_id = o.tenant_id
       LEFT JOIN users referrer
         ON referrer.user_id = o.referrer_id
        AND referrer.tenant_id = o.tenant_id
       WHERE ${whereClause}
       ORDER BY o.created_at DESC, o.order_id DESC
       LIMIT ? OFFSET ?`,
      [...values, pagination.limit, pagination.offset],
    );

    const total = Number(countRows[0].total);

    return res.json({
      orders,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Admin get orders error:", error);

    return res.status(500).json({
      message: "Failed to fetch orders.",
    });
  }
};

// GET /api/admin/orders/:id
exports.getOrderDetails = async (req, res) => {
  try {
    const orderId = req.params.id;

    if (!/^[1-9]\d*$/.test(orderId)) {
      return res.status(400).json({
        message: "Invalid order ID.",
      });
    }

    const [orders] = await pool.execute(
      `SELECT
         o.order_id,
         o.order_number,
         o.user_id,
         u.full_name,
         NULL AS email,
         u.mobile,
         u.reference_id AS referral_code,
         o.referrer_id,
         referrer.full_name AS referrer_name,
         o.subtotal,
         o.discount_amount,
         o.tax_amount,
         o.total_amount,
         o.currency,
         o.status,
         o.paid_at,
         o.created_at,
         o.updated_at
       FROM orders o
       INNER JOIN users u
         ON u.user_id = o.user_id
        AND u.tenant_id = o.tenant_id
       LEFT JOIN users referrer
         ON referrer.user_id = o.referrer_id
        AND referrer.tenant_id = o.tenant_id
       WHERE o.tenant_id = ?
         AND o.order_id = ?
       LIMIT 1`,
      [TENANT_ID, orderId],
    );

    if (!orders.length) {
      return res.status(404).json({
        message: "Order not found.",
      });
    }

    const order = orders[0];

    const [items] = await pool.execute(
      `SELECT
         oi.order_item_id,
         oi.product_id,
         oi.product_title_snapshot,
         oi.quantity,
         oi.unit_price,
         oi.discount_amount,
         oi.tax_amount,
         oi.line_total
       FROM order_items oi
       WHERE oi.tenant_id = ?
         AND oi.order_id = ?
       ORDER BY oi.order_item_id ASC`,
      [TENANT_ID, orderId],
    );

    const [payments] = await pool.execute(
      `SELECT
         payment_id,
         gateway,
         gateway_order_id,
         gateway_txn_id,
         method,
         amount,
         currency,
         status,
         paid_at,
         created_at
       FROM payments
       WHERE tenant_id = ?
         AND order_id = ?
       ORDER BY created_at DESC, payment_id DESC`,
      [TENANT_ID, orderId],
    );

    const [refunds] = await pool.execute(
      `SELECT
         refund_id,
         payment_id,
         gateway,
         gateway_refund_id,
         amount,
         currency,
         reason,
         status,
         requested_at,
         completed_at
       FROM refunds
       WHERE tenant_id = ?
         AND order_id = ?
       ORDER BY requested_at DESC, refund_id DESC`,
      [TENANT_ID, orderId],
    );

    return res.json({
      order,
      items,
      payments,
      refunds,
    });
  } catch (error) {
    console.error("Admin get order details error:", error);

    return res.status(500).json({
      message: "Failed to fetch order details.",
    });
  }
};
