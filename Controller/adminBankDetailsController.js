const pool = require("../DB/db");

const TENANT_ID = 1;

const BANK_VERIFICATION_STATUSES = ["verified", "unverified"];

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

// GET /api/admin/bank-details
exports.getBankDetails = async (req, res) => {
  try {
    const { search = "", status = "", page = "1", limit = "20" } = req.query;

    const pagination = parsePagination({ page, limit });

    if (!pagination) {
      return res.status(400).json({
        message: "Invalid page or limit. Limit must be between 1 and 100.",
      });
    }

    if (status && !BANK_VERIFICATION_STATUSES.includes(status)) {
      return res.status(400).json({
        message: "Invalid verification status.",
      });
    }

    const conditions = ["ba.tenant_id = ?", "u.tenant_id = ba.tenant_id"];

    const values = [TENANT_ID];

    if (status === "verified") {
      conditions.push("ba.is_verified = 1");
    } else if (status === "unverified") {
      conditions.push("ba.is_verified = 0");
    }

    if (String(search).trim()) {
      const term = `%${String(search).trim()}%`;

      // conditions.push(`(
      //   u.full_name LIKE ?
      //   OR u.email LIKE ?
      //   OR u.mobile LIKE ?
      //   OR u.referral_code LIKE ?
      //   OR ba.bank_name LIKE ?
      //   OR ba.account_holder LIKE ?
      //   OR ba.ifsc_code LIKE ?
      //   OR ba.account_last4 LIKE ?
      //   OR CAST(ba.bank_account_id AS CHAR) LIKE ?
      // )`);

      // values.push(
      //   term, term, term, term, term,
      //   term, term, term, term
      // );

      conditions.push(`(
        u.full_name LIKE ?
        OR u.mobile LIKE ?
        OR u.reference_id LIKE ?
        OR ba.bank_name LIKE ?
        OR ba.account_holder LIKE ?
        OR ba.ifsc_code LIKE ?
        OR ba.account_last4 LIKE ?
        OR CAST(ba.bank_account_id AS CHAR) LIKE ?
      )`);

      values.push(term, term, term, term, term, term, term, term);
    }

    const whereClause = conditions.join(" AND ");

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total
       FROM bank_accounts ba
       INNER JOIN users u
         ON u.user_id = ba.user_id
        AND u.tenant_id = ba.tenant_id
       WHERE ${whereClause}`,
      values,
    );

    // const [rows] = await pool.execute(
    //   `SELECT
    //      ba.bank_account_id,
    //      ba.user_id,
    //      u.full_name,
    //      u.email,
    //      u.mobile,
    //      u.referral_code,
    //      ba.account_holder,
    //      ba.bank_name,
    //      ba.account_last4,
    //      ba.ifsc_code,
    //      ba.upi_id,
    //      ba.is_verified,
    //      ba.is_primary,
    //      ba.created_at
    //    FROM bank_accounts ba
    //    INNER JOIN users u
    //      ON u.user_id = ba.user_id
    //     AND u.tenant_id = ba.tenant_id
    //    WHERE ${whereClause}
    //    ORDER BY ba.created_at DESC, ba.bank_account_id DESC
    //    LIMIT ? OFFSET ?`,
    //   [...values, pagination.limit, pagination.offset],
    // );

    const [rows] = await pool.execute(
      `SELECT
        ba.bank_account_id,
        ba.user_id,
        u.full_name,
        NULL AS email,
        u.mobile,
        u.reference_id AS referral_code,
        ba.account_holder,
        ba.bank_name,
        ba.account_last4,
        ba.ifsc_code,
        ba.upi_id,
        ba.is_verified,
        ba.is_primary,
        ba.created_at
      FROM bank_accounts ba
      INNER JOIN users u
        ON u.user_id = ba.user_id
        AND u.tenant_id = ba.tenant_id
      WHERE ${whereClause}
      ORDER BY ba.created_at DESC, ba.bank_account_id DESC
      LIMIT ? OFFSET ?`,
      [...values, pagination.limit, pagination.offset],
    );

    const total = Number(countRows[0].total);

    return res.json({
      bankDetails: rows.map((row) => ({
        ...row,
        is_verified: Boolean(row.is_verified),
        is_primary: Boolean(row.is_primary),
        masked_account_number: row.account_last4
          ? `XXXX${row.account_last4}`
          : null,
      })),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    console.error("Admin get bank details error:", error);

    return res.status(500).json({
      message: "Failed to fetch bank details.",
    });
  }
};

// PATCH /api/admin/bank-details/:id/verification
exports.updateBankVerification = async (req, res) => {
  try {
    const bankAccountId = Number(req.params.id);
    const { is_verified } = req.body;

    if (!Number.isSafeInteger(bankAccountId) || bankAccountId < 1) {
      return res.status(400).json({
        message: "Invalid bank account ID.",
      });
    }

    if (typeof is_verified !== "boolean") {
      return res.status(400).json({
        message: "is_verified must be true or false.",
      });
    }

    const [result] = await pool.execute(
      `UPDATE bank_accounts
       SET is_verified = ?
       WHERE tenant_id = ?
         AND bank_account_id = ?`,
      [is_verified ? 1 : 0, TENANT_ID, bankAccountId],
    );

    if (result.affectedRows === 0) {
      const [rows] = await pool.execute(
        `SELECT bank_account_id
         FROM bank_accounts
         WHERE tenant_id = ?
           AND bank_account_id = ?
         LIMIT 1`,
        [TENANT_ID, bankAccountId],
      );

      if (rows.length === 0) {
        return res.status(404).json({
          message: "Bank account not found.",
        });
      }
    }

    return res.json({
      message: "Bank verification status updated successfully.",
      bankAccount: {
        bank_account_id: bankAccountId,
        is_verified,
      },
    });
  } catch (error) {
    console.error("Admin update bank verification error:", error);

    return res.status(500).json({
      message: "Failed to update bank verification status.",
    });
  }
};
