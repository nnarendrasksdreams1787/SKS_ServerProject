const pool = require("../DB/db");

const getMyNetwork = async (req, res) => {
  try {
    const { userId, tenantId } = req.user;

    const {
      name = "",
      status = "",
      fromDate = "",
      toDate = "",
    } = req.query;

    // Only Paid and Pending orders are shown.
    const allowedStatuses = ["paid", "pending"];

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment status",
      });
    }

    // Validate date filters.
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

    let query = `
      SELECT
        oi.order_item_id AS id,
        o.order_id,
        o.created_at AS date,
        u.full_name AS name,
        u.mobile,
        up.city,
        oi.product_title_snapshot AS product,
        oi.unit_price AS price,
        oi.quantity,
        o.status

      FROM users u

      INNER JOIN orders o
        ON o.user_id = u.user_id
        AND o.tenant_id = u.tenant_id

      INNER JOIN order_items oi
        ON oi.order_id = o.order_id
        AND oi.tenant_id = o.tenant_id

      LEFT JOIN user_profiles up
        ON up.user_id = u.user_id
        AND up.tenant_id = u.tenant_id

      WHERE u.sponsor_id = ?
        AND u.tenant_id = ?
        AND o.status IN ('paid', 'pending')
    `;

    const params = [userId, tenantId];

    // Filter by referral name.
    if (name.trim()) {
      query += " AND u.full_name LIKE ?";
      params.push(`%${name.trim()}%`);
    }

    // Filter by payment status.
    if (status) {
      query += " AND o.status = ?";
      params.push(status);
    }

    // Filter by order date.
    if (fromDate) {
      query += " AND o.created_at >= ?";
      params.push(`${fromDate} 00:00:00`);
    }

    if (toDate) {
      query += " AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)";
      params.push(toDate);
    }

    query += " ORDER BY o.created_at DESC, oi.order_item_id DESC";

    const [records] = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      message: "My Network records fetched successfully",
      total: records.length,
      records,
    });
  } catch (error) {
    console.error("My Network API error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch My Network records",
    });
  }
};

module.exports = { getMyNetwork };