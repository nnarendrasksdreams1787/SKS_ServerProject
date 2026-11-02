
const pool = require("../DB/db");

const TENANT_ID = 1;

const WITHDRAWAL_STATUSES = [
  "pending",
  "approved",
  "processing",
  "paid",
  "rejected",
  "failed",
  "cancelled",
];

const BATCH_STATUSES = [
  "draft",
  "processing",
  "completed",
  "partially_failed",
  "failed",
  "cancelled",
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

// GET /api/admin/withdrawals
exports.getWithdrawals = async (req, res) => {
  try {
    const {
      search = "",
      status = "",
      page = "1",
      limit = "20",
    } = req.query;

    const pagination = parsePagination({ page, limit });

    if (!pagination) {
      return res.status(400).json({
        message: "Invalid page or limit. Limit must be between 1 and 100.",
      });
    }

    if (status && !WITHDRAWAL_STATUSES.includes(status)) {
      return res.status(400).json({
        message: "Invalid withdrawal status.",
      });
    }

    const conditions = ["wr.tenant_id = ?"];
    const values = [TENANT_ID];

    if (status) {
      conditions.push("wr.status = ?");
      values.push(status);
    }

    if (String(search).trim()) {
      const term = `%${String(search).trim()}%`;

      conditions.push(`(
        u.full_name LIKE ?
        OR u.email LIKE ?
        OR u.mobile LIKE ?
        OR u.referral_code LIKE ?
        OR CAST(wr.withdrawal_id AS CHAR) LIKE ?
      )`);

      values.push(term, term, term, term, term);
    }

    const whereClause = conditions.join(" AND ");

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM withdrawal_requests wr
       INNER JOIN users u
         ON u.user_id = wr.user_id
        AND u.tenant_id = wr.tenant_id
       WHERE ${whereClause}`,
      values
    );

    const [withdrawals] = await pool.execute(
      `SELECT
         wr.withdrawal_id,
         wr.user_id,
         u.full_name,
         u.email,
         u.mobile,
         u.referral_code,
         wr.wallet_id,
         wr.bank_account_id,
         wr.amount,
         wr.status,
         wr.payout_reference,
         wr.remark,
         wr.requested_at,
         wr.processed_at
       FROM withdrawal_requests wr
       INNER JOIN users u
         ON u.user_id = wr.user_id
        AND u.tenant_id = wr.tenant_id
       WHERE ${whereClause}
       ORDER BY wr.requested_at DESC, wr.withdrawal_id DESC
       LIMIT ? OFFSET ?`,
      [...values, pagination.limit, pagination.offset]
    );

    const total = Number(countRows[0].total);

    return res.json({
      withdrawals,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Admin get withdrawals error:", error);

    return res.status(500).json({
      message: "Failed to fetch withdrawal requests.",
    });
  }
};

// GET /api/admin/payout-batches
exports.getPayoutBatches = async (req, res) => {
  try {
    const {
      search = "",
      status = "",
      page = "1",
      limit = "20",
    } = req.query;

    const pagination = parsePagination({ page, limit });

    if (!pagination) {
      return res.status(400).json({
        message: "Invalid page or limit. Limit must be between 1 and 100.",
      });
    }

    if (status && !BATCH_STATUSES.includes(status)) {
      return res.status(400).json({
        message: "Invalid payout batch status.",
      });
    }

    const conditions = ["pb.tenant_id = ?"];
    const values = [TENANT_ID];

    if (status) {
      conditions.push("pb.status = ?");
      values.push(status);
    }

    if (String(search).trim()) {
      conditions.push("pb.batch_number LIKE ?");
      values.push(`%${String(search).trim()}%`);
    }

    const whereClause = conditions.join(" AND ");

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM payout_batches pb
       WHERE ${whereClause}`,
      values
    );

    const [batches] = await pool.execute(
      `SELECT
         pb.payout_batch_id,
         pb.batch_number,
         pb.status,
         pb.total_requests,
         pb.total_amount,
         pb.created_by_admin_id,
         pb.created_at,
         pb.started_at,
         pb.completed_at,
         pb.notes,
         COALESCE(items.paid_count, 0) AS paid_count,
         COALESCE(items.failed_count, 0) AS failed_count,
         COALESCE(items.queued_count, 0) AS queued_count
       FROM payout_batches pb
       LEFT JOIN (
         SELECT
           tenant_id,
           payout_batch_id,
           SUM(status = 'paid') AS paid_count,
           SUM(status = 'failed') AS failed_count,
           SUM(status = 'queued') AS queued_count
         FROM payout_batch_items
         WHERE tenant_id = ?
         GROUP BY tenant_id, payout_batch_id
       ) items
         ON items.tenant_id = pb.tenant_id
        AND items.payout_batch_id = pb.payout_batch_id
       WHERE ${whereClause}
       ORDER BY pb.created_at DESC, pb.payout_batch_id DESC
       LIMIT ? OFFSET ?`,
      [TENANT_ID, ...values, pagination.limit, pagination.offset]
    );

    const total = Number(countRows[0].total);

    return res.json({
      batches,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Admin get payout batches error:", error);

    return res.status(500).json({
      message: "Failed to fetch payout batches.",
    });
  }
};
