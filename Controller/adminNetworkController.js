
const pool = require("../DB/db");

const TENANT_ID = 1;

// GET /api/admin/network
exports.getNetwork = async (req, res) => {
  try {
    const {
      search = "",
      status = "",
      fromDate = "",
      toDate = "",
      page = "1",
      limit = "20",
    } = req.query;

    const pageNumber = Number(page);
    const pageSize = Number(limit);

    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    ) {
      return res.status(400).json({
        message: "Invalid page or limit",
      });
    }

    if (status && !["active", "blocked", "pending"].includes(status)) {
      return res.status(400).json({
        message: "Invalid member status",
      });
    }

    const isValidDate = (value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

      const date = new Date(`${value}T00:00:00.000Z`);

      return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      );
    };

    if (
      (fromDate && !isValidDate(fromDate)) ||
      (toDate && !isValidDate(toDate)) ||
      (fromDate && toDate && fromDate > toDate)
    ) {
      return res.status(400).json({
        message: "Invalid date range. Use YYYY-MM-DD",
      });
    }

    const conditions = ["u.tenant_id = ?"];
    const params = [TENANT_ID];

    if (search.trim()) {
      const term = `%${search.trim()}%`;

      conditions.push(
        "(u.full_name LIKE ? OR u.email LIKE ? OR " +
        "u.mobile LIKE ? OR u.referral_code LIKE ?)"
      );

      params.push(term, term, term, term);
    }

    if (status) {
      conditions.push("u.status = ?");
      params.push(status);
    }

    if (fromDate) {
      conditions.push("u.created_at >= ?");
      params.push(`${fromDate} 00:00:00`);
    }

    if (toDate) {
      conditions.push(
        "u.created_at < DATE_ADD(?, INTERVAL 1 DAY)"
      );
      params.push(`${toDate} 00:00:00`);
    }

    const whereClause = conditions.join(" AND ");
    const offset = (pageNumber - 1) * pageSize;

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM users u
       WHERE ${whereClause}`,
      params
    );

    const [members] = await pool.execute(
      `SELECT
         u.user_id,
         u.full_name,
         u.email,
         u.mobile,
         u.referral_code,
         u.sponsor_id,
         sponsor.full_name AS sponsor_name,
         sponsor.referral_code AS sponsor_referral_code,
         u.status,
         u.created_at,
         p.city,
         p.state,
         p.country,
         p.kyc_status,
         (
           SELECT COUNT(*)
           FROM users child
           WHERE child.tenant_id = u.tenant_id
             AND child.sponsor_id = u.user_id
         ) AS direct_referrals
       FROM users u
       LEFT JOIN users sponsor
         ON sponsor.user_id = u.sponsor_id
        AND sponsor.tenant_id = u.tenant_id
       LEFT JOIN user_profiles p
         ON p.user_id = u.user_id
        AND p.tenant_id = u.tenant_id
       WHERE ${whereClause}
       ORDER BY u.created_at DESC, u.user_id DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    return res.json({
      members,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total: Number(countRows[0].total),
        totalPages: Math.ceil(
          Number(countRows[0].total) / pageSize
        ),
      },
    });
  } catch (error) {
    console.error("Get network error:", error);

    return res.status(500).json({
      message: "Unable to load network members",
    });
  }
};
