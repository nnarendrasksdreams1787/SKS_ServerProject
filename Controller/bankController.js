const pool = require("../DB/db");

const {
  encryptAccountNumber,
  fingerprintAccountNumber,
} = require("../Utils/bankCrypto");

// ============================================
// VALIDATE BANK ACCOUNT DETAILS
// ============================================

function validateBankDetails(data) {
  const accountHolder = String(data.account_holder || "").trim();
  const bankName = String(data.bank_name || "").trim();
  const accountNumber = String(data.account_number || "").trim();
  const ifscCode = String(data.ifsc_code || "").trim().toUpperCase();
  const upiId = String(data.upi_id || "").trim();
  const branch = String(data.branch || "").trim();
  const accountType = String(data.account_type || "").trim();

  if (!accountHolder || accountHolder.length > 150) {
    return { error: "Invalid account holder name" };
  }

  if (!bankName || bankName.length > 100) {
    return { error: "Invalid bank name" };
  }

  if (!/^[0-9]{6,30}$/.test(accountNumber)) {
    return { error: "Invalid bank account number" };
  }

  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
    return { error: "Invalid IFSC code" };
  }

  if (upiId.length > 100) {
    return { error: "Invalid UPI ID" };
  }

  if (!branch || branch.length > 100) {
    return { error: "Invalid bank branch" };
  }

  if (!["Savings", "Current"].includes(accountType)) {
    return {
      error: "Account type must be Savings or Current",
    };
  }

  return {
    value: {
      accountHolder,
      bankName,
      accountNumber,
      ifscCode,
      upiId: upiId || null,
      branch,
      accountType,
    },
  };
}

// ============================================
// GET ALL BANK ACCOUNTS
// GET /api/user/bank-accounts
// ============================================

const getBankAccounts = async (req, res) => {
  try {
    const { userId, tenantId } = req.user;

    const [accounts] = await pool.query(
      `SELECT
         bank_account_id,
         account_holder,
         bank_name,
         account_last4,
         ifsc_code,
         upi_id,
         branch,
         account_type,
         is_verified,
         is_primary,
         created_at
       FROM bank_accounts
       WHERE tenant_id = ?
         AND user_id = ?
       ORDER BY is_primary DESC, created_at DESC`,
      [tenantId, userId]
    );

    return res.status(200).json({
      success: true,
      accounts: accounts.map((account) => ({
        ...account,
        masked_account_number: account.account_last4
          ? `XXXX${account.account_last4}`
          : "XXXX",
        is_verified: Boolean(account.is_verified),
        is_primary: Boolean(account.is_primary),
      })),
    });
  } catch (error) {
    console.error("Get bank accounts error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch bank accounts",
    });
  }
};

// ============================================
// ADD BANK ACCOUNT
// POST /api/user/bank-accounts
// ============================================

const addBankAccount = async (req, res) => {
  const validation = validateBankDetails(req.body || {});

  if (validation.error) {
    return res.status(400).json({
      success: false,
      message: validation.error,
    });
  }

  const {
    accountHolder,
    bankName,
    accountNumber,
    ifscCode,
    upiId,
    branch,
    accountType,
  } = validation.value;

  const { userId, tenantId } = req.user;

  try {
    const encrypted = encryptAccountNumber(accountNumber);
    const fingerprint = fingerprintAccountNumber(accountNumber);
    const last4 = accountNumber.slice(-4);

    const [result] = await pool.query(
      `INSERT INTO bank_accounts (
         tenant_id,
         user_id,
         account_holder,
         bank_name,
         account_number_ciphertext,
         account_number_fingerprint,
         account_last4,
         ifsc_code,
         upi_id,
         branch,
         account_type,
         is_verified,
         is_primary
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      [
        tenantId,
        userId,
        accountHolder,
        bankName,
        encrypted,
        fingerprint,
        last4,
        ifscCode,
        upiId,
        branch,
        accountType,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Bank account added successfully",
      bank_account_id: result.insertId,
    });
  } catch (error) {
    console.error("Add bank account error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add bank account",
    });
  }
};

// ============================================
// UPDATE BANK ACCOUNT
// PUT /api/user/bank-accounts/:id
// ============================================

const updateBankAccount = async (req, res) => {
  const validation = validateBankDetails(req.body || {});

  if (validation.error) {
    return res.status(400).json({
      success: false,
      message: validation.error,
    });
  }

  const { userId, tenantId } = req.user;
  const bankAccountId = req.params.id;

  if (!/^[1-9]\d*$/.test(bankAccountId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid bank account ID",
    });
  }

  const {
    accountHolder,
    bankName,
    accountNumber,
    ifscCode,
    upiId,
    branch,
    accountType,
  } = validation.value;

  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Verify that the bank account belongs to this user.
    const [accounts] = await connection.query(
      `SELECT bank_account_id
       FROM bank_accounts
       WHERE bank_account_id = ?
         AND tenant_id = ?
         AND user_id = ?
       FOR UPDATE`,
      [bankAccountId, tenantId, userId]
    );

    if (accounts.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Bank account not found",
      });
    }

    // Prevent editing bank details during an active withdrawal.
    const [withdrawals] = await connection.query(
      `SELECT withdrawal_id
       FROM withdrawal_requests
       WHERE tenant_id = ?
         AND user_id = ?
         AND bank_account_id = ?
         AND status IN ('pending', 'approved', 'processing')
       LIMIT 1`,
      [tenantId, userId, bankAccountId]
    );

    if (withdrawals.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Bank details cannot be edited while a withdrawal is active",
      });
    }

    const encrypted = encryptAccountNumber(accountNumber);
    const fingerprint = fingerprintAccountNumber(accountNumber);
    const last4 = accountNumber.slice(-4);

    await connection.query(
      `UPDATE bank_accounts
       SET account_holder = ?,
           bank_name = ?,
           account_number_ciphertext = ?,
           account_number_fingerprint = ?,
           account_last4 = ?,
           ifsc_code = ?,
           upi_id = ?,
           branch = ?,
           account_type = ?,
           is_verified = 0
       WHERE bank_account_id = ?
         AND tenant_id = ?
         AND user_id = ?`,
      [
        accountHolder,
        bankName,
        encrypted,
        fingerprint,
        last4,
        ifscCode,
        upiId,
        branch,
        accountType,
        bankAccountId,
        tenantId,
        userId,
      ]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Bank account updated. Verification reset.",
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    console.error("Update bank account error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update bank account",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// ============================================
// SET PRIMARY BANK ACCOUNT
// PATCH /api/user/bank-accounts/:id/primary
// ============================================

const setPrimaryBankAccount = async (req, res) => {
  const { userId, tenantId } = req.user;
  const bankAccountId = req.params.id;

  if (!/^[1-9]\d*$/.test(bankAccountId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid bank account ID",
    });
  }

  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Lock the user row to serialize primary-account changes.
    const [users] = await connection.query(
      `SELECT user_id
       FROM users
       WHERE tenant_id = ?
         AND user_id = ?
       FOR UPDATE`,
      [tenantId, userId]
    );

    if (users.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Verify bank account ownership.
    const [accounts] = await connection.query(
      `SELECT bank_account_id
       FROM bank_accounts
       WHERE bank_account_id = ?
         AND tenant_id = ?
         AND user_id = ?
       FOR UPDATE`,
      [bankAccountId, tenantId, userId]
    );

    if (accounts.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Bank account not found",
      });
    }

    // Remove primary status from existing primary account.
    await connection.query(
      `UPDATE bank_accounts
       SET is_primary = 0
       WHERE tenant_id = ?
         AND user_id = ?
         AND is_primary = 1`,
      [tenantId, userId]
    );

    // Set selected bank account as primary.
    await connection.query(
      `UPDATE bank_accounts
       SET is_primary = 1
       WHERE bank_account_id = ?
         AND tenant_id = ?
         AND user_id = ?`,
      [bankAccountId, tenantId, userId]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Primary bank account updated successfully",
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    console.error("Set primary bank account error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update primary bank account",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// ============================================
// EXPORT CONTROLLERS
// ============================================

module.exports = {
  getBankAccounts,
  addBankAccount,
  updateBankAccount,
  setPrimaryBankAccount,
};