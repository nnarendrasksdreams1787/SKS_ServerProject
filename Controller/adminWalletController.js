
const pool = require("../DB/db");

const TENANT_ID = 1;

const ALLOWED_EVENT_TYPES = [
  "credit",
  "debit",
  "reserve",
  "release",
];

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
    const {
      search = "",
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

    const offset = (currentPage - 1) * pageSize;
    const keyword = String(search).trim();
    const searchCondition = keyword
      ? `AND (
          u.full_name LIKE ?
          OR u.email LIKE ?
          OR u.mobile LIKE ?
          OR u.referral_code LIKE ?
        )`
      : "";

    const params = keyword
      ? [
          TENANT_ID,
          ...Array(4).fill(`%${keyword}%`),
          pageSize,
          offset,
        ]
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
      countParams
    );

    const [wallets] = await pool.execute(
      `SELECT
         w.wallet_id,
         w.user_id,
         u.full_name,
         u.email,
         u.mobile,
         u.referral_code,
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
      params
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

    if (
      referenceType &&
      !ALLOWED_REFERENCE_TYPES.includes(referenceType)
    ) {
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
      conditions.push(
        "(u.full_name LIKE ? OR u.email LIKE ? OR u.referral_code LIKE ? OR t.remark LIKE ?)"
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
      values
    );

    const [transactions] = await pool.execute(
      `SELECT
         t.txn_id,
         t.wallet_id,
         t.user_id,
         u.full_name,
         u.email,
         u.referral_code,
         t.event_type,
         t.amount,
         t.available_after,
         t.reserved_after,
         t.reference_type,
         t.reference_id,
         t.remark,
         t.created_at
       FROM wallet_transactions t
       INNER JOIN users u
         ON u.user_id = t.user_id
        AND u.tenant_id = t.tenant_id
       WHERE ${whereClause}
       ORDER BY t.created_at DESC, t.txn_id DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
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
