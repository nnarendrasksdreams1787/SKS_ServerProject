const pool = require("../DB/db");

// GET /api/user/wallet
const getMyWallet = async (req, res) => {
  try {
    const { userId, tenantId } = req.user;

    // 1. Fetch wallet balance
    const [walletRows] = await pool.query(
      `
      SELECT
        wallet_id,
        available_balance,
        reserved_balance
      FROM wallets
      WHERE user_id = ?
        AND tenant_id = ?
      LIMIT 1
      `,
      [userId, tenantId]
    );

    // New users may not have a wallet row yet.
    if (walletRows.length === 0) {
      return res.status(200).json({
        success: true,
        summary: {
          balance: 0,
          totalCredit: 0,
          totalDebit: 0,
          reservedBalance: 0,
        },
        transactions: [],
      });
    }

    const wallet = walletRows[0];

    // 2. Fetch transaction totals
    const [summaryRows] = await pool.query(
      `
      SELECT
        COALESCE(
          SUM(CASE WHEN event_type = 'credit' THEN amount ELSE 0 END),
          0
        ) AS totalCredit,

        COALESCE(
          SUM(CASE WHEN event_type = 'debit' THEN amount ELSE 0 END),
          0
        ) AS totalDebit
      FROM wallet_transactions
      WHERE wallet_id = ?
        AND user_id = ?
        AND tenant_id = ?
      `,
      [wallet.wallet_id, userId, tenantId]
    );

    // 3. Fetch transaction history
    const [transactionRows] = await pool.query(
      `
      SELECT
        txn_id,
        event_type,
        amount,
        reference_type,
        remark,
        created_at
      FROM wallet_transactions
      WHERE wallet_id = ?
        AND user_id = ?
        AND tenant_id = ?
      ORDER BY created_at DESC, txn_id DESC
      `,
      [wallet.wallet_id, userId, tenantId]
    );

    return res.status(200).json({
      success: true,
      summary: {
        balance: Number(wallet.available_balance),
        totalCredit: Number(summaryRows[0].totalCredit),
        totalDebit: Number(summaryRows[0].totalDebit),
        reservedBalance: Number(wallet.reserved_balance),
      },
      transactions: transactionRows.map((txn) => ({
        id: txn.txn_id,
        date: txn.created_at,
        amount: Number(txn.amount),
        type: txn.event_type,
        referenceType: txn.reference_type,
        remarks: txn.remark || "—",
      })),
    });
  } catch (error) {
    console.error("Get My Wallet Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch wallet details.",
    });
  }
};

module.exports = {
  getMyWallet,
};