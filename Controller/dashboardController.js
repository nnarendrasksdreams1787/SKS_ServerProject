const pool = require("../DB/db");

// GET /api/user/dashboard
const getDashboard = async (req, res) => {
  try {
    // Logged-in user details come from JWT middleware
    const { userId, tenantId } = req.user;

    // 1. Get user information
    // const [users] = await pool.query(
    //   `SELECT user_id, login_id, full_name, referral_code
    //    FROM users
    //    WHERE user_id = ? AND tenant_id = ?
    //    LIMIT 1`,
    //   [userId, tenantId]
    // );
    const [users] = await pool.query(
      `SELECT
            user_id,
            reference_id AS login_id,
            full_name,
            reference_id
        FROM users
        WHERE user_id = ?
          AND tenant_id = ?
        LIMIT 1`,
      [userId, tenantId],
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 2. Available wallet balance
    const [wallets] = await pool.query(
      `SELECT available_balance
       FROM wallets
       WHERE user_id = ? AND tenant_id = ?
       LIMIT 1`,
      [userId, tenantId],
    );

    const totalAmount = wallets.length
      ? Number(wallets[0].available_balance)
      : 0;

    // Count users directly sponsored by the logged-in user.
    const [referrals] = await pool.query(
      `SELECT COUNT(*) AS total_referrals
        FROM users
        WHERE sponsor_id = ?
        AND tenant_id = ?`,
      [userId, tenantId],
    );

    const totalReferrals = Number(referrals[0].total_referrals);
    // 4. Approved commission only
    const [commissions] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_commission
       FROM commissions
       WHERE beneficiary_id = ?
       AND tenant_id = ?
       AND status = 'approved'`,
      [userId, tenantId],
    );

    const totalCommission = Number(commissions[0].total_commission);

    // 5. Paid orders only
    const [orders] = await pool.query(
      `SELECT COUNT(*) AS total_orders
       FROM orders
       WHERE user_id = ?
         AND tenant_id = ?
         AND status = 'paid'`,
      [userId, tenantId],
    );

    const totalOrders = Number(orders[0].total_orders);

    // 6. Bank account status
    const [bankAccounts] = await pool.query(
      `SELECT
         bank_account_id,
         bank_name,
         account_last4,
         is_verified,
         is_primary
       FROM bank_accounts
       WHERE user_id = ?
         AND tenant_id = ?
       ORDER BY is_primary DESC, created_at DESC
       LIMIT 1`,
      [userId, tenantId],
    );

    const bankAdded = bankAccounts.length > 0;

    // 7. Final dashboard response
    return res.status(200).json({
      success: true,
      message: "Dashboard data fetched successfully",

      user: {
        user_id: users[0].user_id,
        login_id: users[0].login_id,
        full_name: users[0].full_name,
        referral_code: users[0].referral_code,
      },

      statistics: {
        total_amount: totalAmount,
        total_referrals: totalReferrals,
        total_commission: totalCommission,
        total_orders: totalOrders,
      },

      bank: {
        is_added: bankAdded,
        is_verified: bankAdded ? Boolean(bankAccounts[0].is_verified) : false,
      },
    });
  } catch (error) {
    console.error("Dashboard error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard data",
    });
  }
};

module.exports = {
  getDashboard,
};
