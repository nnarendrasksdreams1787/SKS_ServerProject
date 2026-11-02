
const crypto = require("node:crypto");
const bcrypt = require("bcrypt");
const pool = require("../DB/db");
const { sendSms, isConfigured } = require("../Services/smsService");

const TOKEN_EXPIRY_MINUTES = 30;
const TENANT_ID = Number(process.env.TENANT_ID || 1);

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest();
}

function normalizeMobile(value) {
  return String(value || "").trim();
}

function validMobile(value) {
  return /^\+?[0-9]{10,15}$/.test(value);
}

function validPassword(value) {
  return typeof value === "string" && value.length >= 8;
}

function resetUrl(baseUrl, token) {
  if (!baseUrl) {
    throw new Error("Password reset URL is not configured.");
  }

  const url = new URL(baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

function smsUnavailable(res) {
  return res.status(503).json({
    success: false,
    message: "Password reset SMS service is not configured yet.",
  });
}

// Request a reset link for a user using their registered mobile.
async function requestUserReset(req, res) {
  const mobile = normalizeMobile(req.body.mobile);

  if (!validMobile(mobile)) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid registered mobile number.",
    });
  }

  // Do not create tokens until a working SMS adapter is configured.
  if (!isConfigured()) {
    return smsUnavailable(res);
  }

  let connection;

  try {
    connection = await pool.getConnection();

    const [users] = await connection.execute(
      `SELECT user_id, tenant_id, mobile
       FROM users
       WHERE tenant_id = ? AND mobile = ? AND status = 'active'
       LIMIT 1`,
      [TENANT_ID, mobile]
    );

    // Generic response avoids revealing whether a mobile is registered.
    if (users.length === 0) {
      return res.json({
        success: true,
        message: "If the number is registered, a reset link will be sent.",
      });
    }

    const user = users[0];
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);

    await connection.beginTransaction();

    await connection.execute(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE tenant_id = ? AND user_id = ?
         AND used_at IS NULL`,
      [user.tenant_id, user.user_id]
    );

    await connection.execute(
      `INSERT INTO password_reset_tokens
       (tenant_id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
      [
        user.tenant_id,
        user.user_id,
        tokenHash,
        TOKEN_EXPIRY_MINUTES,
      ]
    );

    await connection.commit();

    const link = resetUrl(process.env.USER_RESET_URL, rawToken);

    try {
      await sendSms(
        user.mobile,
        `Reset your SKS Dream password using this link (valid for ${TOKEN_EXPIRY_MINUTES} minutes): ${link}`
      );
    } catch (smsError) {
      // Do not leave a usable token if delivery failed.
      await connection.execute(
        `UPDATE password_reset_tokens
         SET used_at = NOW()
         WHERE token_hash = ? AND used_at IS NULL`,
        [tokenHash]
      );

      console.error("User password-reset SMS delivery failed.");
      return res.status(502).json({
        success: false,
        message: "Unable to deliver the reset link. Please try again later.",
      });
    }

    return res.json({
      success: true,
      message: "If the number is registered, a reset link will be sent.",
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {}
    }

    console.error("User password-reset request failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to process the password-reset request.",
    });
  } finally {
    if (connection) connection.release();
  }
}

// Request a reset link for an administrator using their registered mobile.
async function requestAdminReset(req, res) {
  const mobile = normalizeMobile(req.body.mobile);

  if (!validMobile(mobile)) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid registered mobile number.",
    });
  }

  if (!isConfigured()) {
    return smsUnavailable(res);
  }

  let connection;

  try {
    connection = await pool.getConnection();

    const [admins] = await connection.execute(
      `SELECT admin_id, mobile
       FROM platform_admins
       WHERE mobile = ? AND status = 'active'
       LIMIT 1`,
      [mobile]
    );

    if (admins.length === 0) {
      return res.json({
        success: true,
        message: "If the number is registered, a reset link will be sent.",
      });
    }

    const admin = admins[0];
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);

    await connection.beginTransaction();

    await connection.execute(
      `UPDATE admin_password_reset_tokens
       SET used_at = NOW()
       WHERE admin_id = ? AND used_at IS NULL`,
      [admin.admin_id]
    );

    await connection.execute(
      `INSERT INTO admin_password_reset_tokens
       (admin_id, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
      [admin.admin_id, tokenHash, TOKEN_EXPIRY_MINUTES]
    );

    await connection.commit();

    const link = resetUrl(process.env.ADMIN_RESET_URL, rawToken);

    try {
      await sendSms(
        admin.mobile,
        `Reset your SKS Dream admin password using this link (valid for ${TOKEN_EXPIRY_MINUTES} minutes): ${link}`
      );
    } catch (smsError) {
      await connection.execute(
        `UPDATE admin_password_reset_tokens
         SET used_at = NOW()
         WHERE token_hash = ? AND used_at IS NULL`,
        [tokenHash]
      );

      console.error("Admin password-reset SMS delivery failed.");
      return res.status(502).json({
        success: false,
        message: "Unable to deliver the reset link. Please try again later.",
      });
    }

    return res.json({
      success: true,
      message: "If the number is registered, a reset link will be sent.",
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {}
    }

    console.error("Admin password-reset request failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to process the password-reset request.",
    });
  } finally {
    if (connection) connection.release();
  }
}

// Shared validation for both user and administrator reset flows.
async function completeReset(req, res, isAdmin) {
  const { token, newPassword } = req.body || {};

  if (
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/i.test(token) ||
    !validPassword(newPassword)
  ) {
    return res.status(400).json({
      success: false,
      message: "Provide a valid reset token and a password of at least 8 characters.",
    });
  }

  const table = isAdmin
    ? "admin_password_reset_tokens"
    : "password_reset_tokens";

  const idColumn = isAdmin ? "admin_id" : "user_id";
  const accountTable = isAdmin ? "platform_admins" : "users";
  const accountIdColumn = isAdmin ? "admin_id" : "user_id";

  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const tokenHash = hashToken(token);

    const [tokens] = await connection.execute(
      `SELECT reset_token_id, ${idColumn}${isAdmin ? "" : ", tenant_id"}
       FROM ${table}
       WHERE token_hash = ?
         AND used_at IS NULL
         AND expires_at > NOW()
       LIMIT 1
       FOR UPDATE`,
      [tokenHash]
    );

    if (tokens.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "This reset link is invalid, expired, or already used.",
      });
    }

    const reset = tokens[0];
    const accountId = reset[idColumn];

    let accountSql = isAdmin
      ? `SELECT ${accountIdColumn}
         FROM ${accountTable}
         WHERE ${accountIdColumn} = ? AND status = 'active'
         FOR UPDATE`
      : `SELECT ${accountIdColumn}
         FROM ${accountTable}
         WHERE ${accountIdColumn} = ?
           AND tenant_id = ?
           AND status = 'active'
         FOR UPDATE`;

    const accountParams = isAdmin
      ? [accountId]
      : [accountId, reset.tenant_id];

    const [accounts] = await connection.execute(
      accountSql,
      accountParams
    );

    if (accounts.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "This reset link is invalid, expired, or already used.",
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    if (isAdmin) {
      await connection.execute(
        `UPDATE platform_admins
         SET password_hash = ?
         WHERE admin_id = ?`,
        [passwordHash, accountId]
      );

      await connection.execute(
        `UPDATE admin_password_reset_tokens
         SET used_at = NOW()
         WHERE admin_id = ? AND used_at IS NULL`,
        [accountId]
      );
    } else {
      await connection.execute(
        `UPDATE users
         SET password_hash = ?
         WHERE user_id = ? AND tenant_id = ?`,
        [passwordHash, accountId, reset.tenant_id]
      );

      await connection.execute(
        `UPDATE password_reset_tokens
         SET used_at = NOW()
         WHERE tenant_id = ? AND user_id = ? AND used_at IS NULL`,
        [reset.tenant_id, accountId]
      );
    }

    await connection.commit();

    return res.json({
      success: true,
      message: "Password reset successfully. You can now log in.",
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {}
    }

    console.error("Password reset failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to reset the password. Please try again.",
    });
  } finally {
    if (connection) connection.release();
  }
}

async function resetUserPassword(req, res) {
  return completeReset(req, res, false);
}

async function resetAdminPassword(req, res) {
  return completeReset(req, res, true);
}

module.exports = {
  requestUserReset,
  requestAdminReset,
  resetUserPassword,
  resetAdminPassword,
};
