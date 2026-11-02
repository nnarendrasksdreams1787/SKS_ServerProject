
const pool = require("../DB/db");

const TENANT_ID = 1;

const MEMBER_STATUSES = ["active", "blocked", "pending"];

const LEAD_STATUSES = [
  "not_registered",
  "registered_unpaid",
  "paid",
  "pending",
  "cancelled",
];

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function validUserId(value) {
  return /^\d+$/.test(String(value)) && Number(value) > 0;
}

// ======================================================
// 1. GET /api/admin/referrals
// List registered members and their sponsor relationships
// ======================================================

exports.getReferrals = async (req, res) => {
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

    if (status && !MEMBER_STATUSES.includes(status)) {
      return res.status(400).json({
        message: "Invalid member status",
      });
    }

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
      conditions.push("u.created_at < DATE_ADD(?, INTERVAL 1 DAY)");
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
         u.status,
         u.created_at,
         sponsor.full_name AS sponsor_name,
         sponsor.referral_code AS sponsor_referral_code,
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
       WHERE ${whereClause}
       ORDER BY u.created_at DESC, u.user_id DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    return res.json({
      referrals: members,
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
    console.error("Get registered referrals error:", error);

    return res.status(500).json({
      message: "Unable to load registered referrals",
    });
  }
};

// ======================================================
// 2. GET /api/admin/referral-tree/:userId
// Get the selected member's ancestors and descendants
// ======================================================

exports.getReferralTree = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!validUserId(userId)) {
      return res.status(400).json({
        message: "Invalid user ID",
      });
    }

    const [members] = await pool.execute(
      `SELECT
         user_id,
         full_name,
         referral_code,
         sponsor_id,
         status,
         created_at
       FROM users
       WHERE tenant_id = ? AND user_id = ?
       LIMIT 1`,
      [TENANT_ID, userId]
    );

    if (!members.length) {
      return res.status(404).json({
        message: "Member not found",
      });
    }

    const [ancestors] = await pool.execute(
      `SELECT
         rp.level,
         u.user_id,
         u.full_name,
         u.referral_code,
         u.sponsor_id,
         u.status
       FROM referral_paths rp
       INNER JOIN users u
         ON u.tenant_id = rp.tenant_id
        AND u.user_id = rp.ancestor_id
       WHERE rp.tenant_id = ?
         AND rp.descendant_id = ?
       ORDER BY rp.level ASC`,
      [TENANT_ID, userId]
    );

    const [descendants] = await pool.execute(
      `SELECT
         rp.level,
         u.user_id,
         u.full_name,
         u.referral_code,
         u.sponsor_id,
         u.status,
         u.created_at
       FROM referral_paths rp
       INNER JOIN users u
         ON u.tenant_id = rp.tenant_id
        AND u.user_id = rp.descendant_id
       WHERE rp.tenant_id = ?
         AND rp.ancestor_id = ?
       ORDER BY rp.level ASC, u.created_at DESC`,
      [TENANT_ID, userId]
    );

    return res.json({
      member: members[0],
      ancestors,
      descendants,
    });
  } catch (error) {
    console.error("Get referral tree error:", error);

    return res.status(500).json({
      message: "Unable to load referral tree",
    });
  }
};

// ======================================================
// 3. POST /api/admin/referrals/leads
// Add a prospective referral; does not create a user
// ======================================================

exports.createReferral = async (req, res) => {
  try {
    const sponsorUserId = Number(req.body.sponsor_user_id);
    const fullName = String(req.body.full_name || "").trim();
    const mobile = String(req.body.mobile || "").trim();
    const email = String(req.body.email || "").trim();
    const notes = String(req.body.notes || "").trim();
    const status = req.body.status || "not_registered";

    if (
      !Number.isSafeInteger(sponsorUserId) ||
      sponsorUserId <= 0
    ) {
      return res.status(400).json({
        message: "A valid sponsor user ID is required",
      });
    }

    if (
      fullName.length > 150 ||
      mobile.length > 20 ||
      email.length > 254 ||
      notes.length > 500
    ) {
      return res.status(400).json({
        message: "One or more fields exceed their maximum length",
      });
    }

    if (!fullName && !mobile && !email) {
      return res.status(400).json({
        message: "Provide at least a name, mobile number, or email",
      });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        message: "Enter a valid email address",
      });
    }

    if (!LEAD_STATUSES.includes(status)) {
      return res.status(400).json({
        message: "Invalid referral lead status",
      });
    }

    const [sponsors] = await pool.execute(
      `SELECT user_id
       FROM users
       WHERE user_id = ? AND tenant_id = ?
       LIMIT 1`,
      [sponsorUserId, TENANT_ID]
    );

    if (!sponsors.length) {
      return res.status(400).json({
        message: "Sponsor user not found",
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO referral_leads
       (
         tenant_id,
         sponsor_user_id,
         full_name,
         mobile,
         email,
         status,
         notes,
         created_by_admin_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        TENANT_ID,
        sponsorUserId,
        fullName || null,
        mobile || null,
        email || null,
        status,
        notes || null,
        req.session?.adminId || null,
      ]
    );

    return res.status(201).json({
      message: "Referral lead created successfully",
      referral: {
        id: result.insertId,
        sponsor_user_id: sponsorUserId,
        full_name: fullName || null,
        mobile: mobile || null,
        email: email || null,
        status,
      },
    });
  } catch (error) {
    console.error("Create referral lead error:", error);

    return res.status(500).json({
      message: "Unable to create referral lead",
    });
  }
};
