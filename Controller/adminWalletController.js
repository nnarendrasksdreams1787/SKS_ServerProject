const pool = require("../DB/db");

const TENANT_ID = 1;

const ALLOWED_EVENT_TYPES = ["credit", "debit", "reserve", "release"];

const ALLOWED_REFERENCE_TYPES = [
  "commission",
  "commission_reversal",
  "withdrawal",
  "refund",
  "adjustment",
];

const isValidDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

// GET /api/admin/wallets
exports.getWallets = async (req, res) => {
  try {
    const { search = "", page = "1", limit = "20" } = req.query;

    const currentPage = Number(page);
    const pageSize = Number(limit);

    if (
      !Number.isInteger(currentPage) ||
      currentPage < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      return res.status(400).json({
        message: "Invalid page or limit. Limit must be between 1 and 100.",
      });
    }

    const offset = (currentPage - 1) * pageSize;
    const keyword = String(search).trim();
    // const searchCondition = keyword
    //   ? `AND (
    //       u.full_name LIKE ?
    //       OR u.mobile LIKE ?
    //       OR u.referral_code LIKE ?
    //     )`
    //   : "";

    const searchCondition = keyword
      ? `AND (
      u.full_name LIKE ?
      OR u.mobile LIKE ?
      OR u.reference_id LIKE ?
      OR u.referral_id LIKE ?
    )`
      : "";

    const params = keyword
      ? [TENANT_ID, ...Array(4).fill(`%${keyword}%`), pageSize, offset]
      : [TENANT_ID, pageSize, offset];

    const countParams = keyword
      ? [TENANT_ID, ...Array(4).fill(`%${keyword}%`)]
      : [TENANT_ID];

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM wallets w
       INNER JOIN users u
         ON u.user_id = w.user_id
        AND u.tenant_id = w.tenant_id
       WHERE w.tenant_id = ?
       ${searchCondition}`,
      countParams,
    );

    const [wallets] = await pool.execute(
      `SELECT
         w.wallet_id,
         w.user_id,
         u.full_name,
         NULL AS email,
         u.mobile,
         u.reference_id AS referral_code,
         u.status AS user_status,
         w.available_balance,
         w.reserved_balance,
         w.updated_at
       FROM wallets w
       INNER JOIN users u
         ON u.user_id = w.user_id
        AND u.tenant_id = w.tenant_id
       WHERE w.tenant_id = ?
       ${searchCondition}
       ORDER BY w.updated_at DESC, w.wallet_id DESC
       LIMIT ? OFFSET ?`,
      params,
    );

    const total = Number(countRows[0].total);

    return res.json({
      wallets,
      pagination: {
        page: currentPage,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("Admin get wallets error:", error);
    return res.status(500).json({
      message: "Failed to fetch wallets.",
    });
  }
};

// GET /api/admin/wallet-transactions
exports.getWalletTransactions = async (req, res) => {
  try {
    const {
      search = "",
      eventType = "",
      referenceType = "",
      fromDate = "",
      toDate = "",
      page = "1",
      limit = "20",
    } = req.query;

    const currentPage = Number(page);
    const pageSize = Number(limit);

    if (
      !Number.isInteger(currentPage) ||
      currentPage < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      return res.status(400).json({
        message: "Invalid page or limit. Limit must be between 1 and 100.",
      });
    }

    if (eventType && !ALLOWED_EVENT_TYPES.includes(eventType)) {
      return res.status(400).json({
        message: "Invalid transaction event type.",
      });
    }

    if (referenceType && !ALLOWED_REFERENCE_TYPES.includes(referenceType)) {
      return res.status(400).json({
        message: "Invalid transaction reference type.",
      });
    }

    if (
      (fromDate && !isValidDate(fromDate)) ||
      (toDate && !isValidDate(toDate)) ||
      (fromDate && toDate && fromDate > toDate)
    ) {
      return res.status(400).json({
        message: "Invalid date range.",
      });
    }

    const conditions = ["t.tenant_id = ?"];
    const values = [TENANT_ID];

    if (search.trim()) {
      const term = `%${String(search).trim()}%`;
      // conditions.push(
      //   "(u.full_name LIKE ? OR u.email LIKE ? OR u.referral_code LIKE ? OR t.remark LIKE ?)"
      // );
      // values.push(term, term, term, term);

      conditions.push(
        "(u.full_name LIKE ? OR u.mobile LIKE ? OR u.reference_id LIKE ? OR t.remark LIKE ?)",
      );

      values.push(term, term, term, term);
    }

    if (eventType) {
      conditions.push("t.event_type = ?");
      values.push(eventType);
    }

    if (referenceType) {
      conditions.push("t.reference_type = ?");
      values.push(referenceType);
    }

    if (fromDate) {
      conditions.push("t.created_at >= ?");
      values.push(`${fromDate} 00:00:00`);
    }

    if (toDate) {
      conditions.push("t.created_at < DATE_ADD(?, INTERVAL 1 DAY)");
      values.push(toDate);
    }

    const whereClause = conditions.join(" AND ");
    const offset = (currentPage - 1) * pageSize;

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM wallet_transactions t
       INNER JOIN users u
         ON u.user_id = t.user_id
        AND u.tenant_id = t.tenant_id
       WHERE ${whereClause}`,
      values,
    );

    // const [transactions] = await pool.execute(
    //   `SELECT
    //      t.txn_id,
    //      t.wallet_id,
    //      t.user_id,
    //      u.full_name,
    //      NULL AS email,
    //      u.reference_id AS referral_code,
    //      t.event_type,
    //      t.amount,
    //      t.available_after,
    //      t.reserved_after,
    //      t.reference_type,
    //      t.reference_id,
    //      t.remark,
    //      t.created_at
    //    FROM wallet_transactions t
    //    INNER JOIN users u
    //      ON u.user_id = t.user_id
    //     AND u.tenant_id = t.tenant_id
    //    WHERE ${whereClause}
    //    ORDER BY t.created_at DESC, t.txn_id DESC
    //    LIMIT ? OFFSET ?`,
    //   [...values, pageSize, offset],
    // );

    const [transactions] = await pool.execute(
      `SELECT
     t.txn_id,
     t.wallet_id,
     t.user_id,
     u.full_name,
     NULL AS email,
     u.reference_id AS referral_code,
     t.event_type,
     t.amount,
     t.available_after,
     t.reserved_after,
     t.reference_type,
     t.reference_id,
     t.remark,
     t.created_at,

     CASE
       WHEN t.reference_type = 'commission'
         AND oi.product_title_snapshot IS NOT NULL
       THEN CONCAT(
         'Commission · Order #',
         COALESCE(o.order_number, o.order_id),
         ' · ',
         oi.product_title_snapshot
       )
       ELSE COALESCE(t.remark, t.reference_type)
     END AS description

   FROM wallet_transactions t

   INNER JOIN users u
     ON u.user_id = t.user_id
    AND u.tenant_id = t.tenant_id

   LEFT JOIN commissions c
     ON t.reference_type = 'commission'
    AND c.commission_id = t.reference_id
    AND c.tenant_id = t.tenant_id

   LEFT JOIN order_items oi
     ON oi.order_item_id = c.order_item_id
    AND oi.tenant_id = c.tenant_id

   LEFT JOIN orders o
     ON o.order_id = oi.order_id
    AND o.tenant_id = oi.tenant_id

   WHERE ${whereClause}

   ORDER BY t.created_at DESC, t.txn_id DESC
   LIMIT ? OFFSET ?`,
      [...values, pageSize, offset],
    );

    const total = Number(countRows[0].total);

    return res.json({
      transactions,
      pagination: {
        page: currentPage,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("Admin wallet transactions error:", error);
    return res.status(500).json({
      message: "Failed to fetch wallet transactions.",
    });
  }
};

// GET /api/admin/my-wallet
exports.getBusinessWallet = async (req, res) => {
  try {
    // 1. Total successful payment collections
    const [paymentRows] = await pool.execute(
      `SELECT
         COALESCE(SUM(amount), 0) AS totalCollections,
         COUNT(*) AS successfulPayments
       FROM payments
       WHERE tenant_id = ?
         AND status = 'success'`,
      [TENANT_ID],
    );

    // 2. Total paid orders
    const [orderRows] = await pool.execute(
      `SELECT
         COALESCE(SUM(total_amount), 0) AS totalSales,
         COUNT(*) AS totalOrders
       FROM orders
       WHERE tenant_id = ?
         AND status = 'paid'`,
      [TENANT_ID],
    );

    // 3. Total approved commissions
    const [commissionRows] = await pool.execute(
      `SELECT
         COALESCE(SUM(amount), 0) AS totalCommissions
       FROM commissions
       WHERE tenant_id = ?
         AND status = 'approved'`,
      [TENANT_ID],
    );

    // 4. Total completed withdrawals
    const [withdrawalRows] = await pool.execute(
      `SELECT
         COALESCE(SUM(amount), 0) AS totalWithdrawals
       FROM withdrawal_requests
       WHERE tenant_id = ?
         AND status = 'paid'`,
      [TENANT_ID],
    );

    // 5. Business payment transaction history
    const [transactions] = await pool.execute(
      `SELECT
     p.payment_id AS txn_id,
     p.order_id,
     o.order_number,
     p.gateway,
     p.gateway_txn_id,
     p.method,
     p.amount,
     p.currency,
     p.status,
     p.paid_at,
     p.created_at,

     GROUP_CONCAT(
       DISTINCT oi.product_title_snapshot
       ORDER BY oi.product_title_snapshot
       SEPARATOR ', '
     ) AS product_names,

     CASE
       WHEN p.status = 'success' THEN 'Credit'
       ELSE p.status
     END AS event_type,

     CONCAT(
       'Order #',
       o.order_number,
       ' · ',
       COALESCE(
         GROUP_CONCAT(
           DISTINCT oi.product_title_snapshot
           SEPARATOR ', '
         ),
         'Order payment'
       )
     ) AS description

   FROM payments p

   INNER JOIN orders o
     ON o.order_id = p.order_id
    AND o.tenant_id = p.tenant_id

   LEFT JOIN order_items oi
     ON oi.order_id = o.order_id
    AND oi.tenant_id = o.tenant_id

   WHERE p.tenant_id = ?

   GROUP BY
     p.payment_id,
     p.order_id,
     o.order_number,
     p.gateway,
     p.gateway_txn_id,
     p.method,
     p.amount,
     p.currency,
     p.status,
     p.paid_at,
     p.created_at

   ORDER BY p.created_at DESC, p.payment_id DESC
   LIMIT 100`,
      [TENANT_ID],
    );

    return res.status(200).json({
      success: true,
      summary: {
        totalSales: Number(orderRows[0].totalSales),
        totalCollections: Number(paymentRows[0].totalCollections),
        successfulPayments: Number(paymentRows[0].successfulPayments),
        totalOrders: Number(orderRows[0].totalOrders),
        totalCommissions: Number(commissionRows[0].totalCommissions),
        totalWithdrawals: Number(withdrawalRows[0].totalWithdrawals),
      },
    });
  } catch (error) {
    console.error("Admin business wallet error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch business wallet.",
    });
  }
};
