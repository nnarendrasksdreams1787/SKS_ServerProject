const pool = require("../DB/db");

const getMyOrders = async (req, res) => {
  try {
    const { userId, tenantId } = req.user;
    const { fromDate = "", toDate = "" } = req.query;

    // Validate YYYY-MM-DD dates.
    const isValidDate = (value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
      }

      const date = new Date(`${value}T00:00:00Z`);

      return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      );
    };

    if (
      (fromDate && !isValidDate(fromDate)) ||
      (toDate && !isValidDate(toDate))
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Use YYYY-MM-DD.",
      });
    }

    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({
        success: false,
        message: "From Date cannot be after To Date.",
      });
    }

    let query = `
      SELECT
        oi.order_item_id AS id,
        o.order_id,
        o.order_number,
        oi.product_title_snapshot AS product,
        oi.unit_price AS price,
        oi.quantity AS qty,
        oi.discount_amount,
        oi.tax_amount AS taxAmount,
        oi.line_total AS grandTotal,
        o.status,
        o.created_at AS date

      FROM orders o

      INNER JOIN order_items oi
        ON oi.order_id = o.order_id
        AND oi.tenant_id = o.tenant_id

      WHERE o.user_id = ?
        AND o.tenant_id = ?
    `;

    const params = [userId, tenantId];

    if (fromDate) {
      query += " AND o.created_at >= ?";
      params.push(`${fromDate} 00:00:00`);
    }

    if (toDate) {
      query += " AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)";
      params.push(toDate);
    }

    query += `
      ORDER BY
        o.created_at DESC,
        o.order_id DESC,
        oi.order_item_id DESC
    `;

    const [rows] = await pool.query(query, params);

    const orders = rows.map((row) => ({
      ...row,

      // GST rate snapshot is not stored in order_items.
      // Do not substitute the product's current GST rate.
      tax: "—",

      // Receipt download API will be implemented later.
      receiptUrl: null,
    }));

    return res.status(200).json({
      success: true,
      message: "My Orders fetched successfully",
      total: orders.length,
      orders,
    });
  } catch (error) {
    console.error("My Orders API error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch My Orders.",
    });
  }
};

module.exports = { getMyOrders };