const pool = require("../DB/db");

// GET /api/user/referrals
const getDirectReferrals = async (req, res) => {
  try {
    // Authenticated user from JWT middleware
    const { userId, tenantId } = req.user;

    // Search filters from frontend
    const {
      name = "",
      status = "",
      fromDate = "",
      toDate = "",
    } = req.query;

    // Validate status
    const allowedStatuses = ["active", "blocked", "pending"];

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid referral status",
      });
    }

    // Validate dates
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    const isValidDate = (value) => {
      if (!datePattern.test(value)) return false;

      const parsed = new Date(`${value}T00:00:00Z`);

      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    };

    if (
      (fromDate && !isValidDate(fromDate)) ||
      (toDate && !isValidDate(toDate))
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Use YYYY-MM-DD",
      });
    }

    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({
        success: false,
        message: "From Date cannot be after To Date",
      });
    }

    // Only direct referrals of logged-in user
    let query = `
      SELECT
        user_id,
        login_id,
        full_name,
        referral_code AS login_id,
        status,
        created_at
      FROM users
      WHERE sponsor_id = ?
        AND tenant_id = ?
    `;

    const params = [userId, tenantId];

    // Filter by name
    if (name.trim()) {
      query += " AND full_name LIKE ?";
      params.push(`%${name.trim()}%`);
    }

    // Filter by status
    if (status) {
      query += " AND status = ?";
      params.push(status);
    }

    // Filter by registration start date
    if (fromDate) {
      query += " AND created_at >= ?";
      params.push(`${fromDate} 00:00:00`);
    }

    // Filter by registration end date
    if (toDate) {
      query += " AND created_at < DATE_ADD(?, INTERVAL 1 DAY)";
      params.push(toDate);
    }

    query += " ORDER BY created_at DESC, user_id DESC";

    const [referrals] = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      message: "Direct referrals fetched successfully",
      total: referrals.length,
      referrals,
    });
  } catch (error) {
    console.error("Referral API error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch referral records",
    });
  }
};

module.exports = {
  getDirectReferrals,
};