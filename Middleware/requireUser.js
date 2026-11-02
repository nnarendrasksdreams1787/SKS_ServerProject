const jwt = require("jsonwebtoken");
const pool = require("../DB/db");

const requireUser = async (req, res, next) => {
  try {
    // 1. Read Authorization header
    const authHeader = req.headers.authorization;

    if (
      typeof authHeader !== "string" ||
      !authHeader.startsWith("Bearer ")
    ) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is required",
      });
    }

    // 2. Extract JWT token
    const token = authHeader.slice(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is required",
      });
    }

    // 3. Verify JWT configuration
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured");

      return res.status(500).json({
        success: false,
        message: "Authentication configuration error",
      });
    }

    // 4. Verify token signature and expiration
    let decoded;

    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ["HS256"],
      });
    } catch (error) {
      return res.status(401).json({
        success: false,
        message:
          error.name === "TokenExpiredError"
            ? "Session expired. Please login again"
            : "Invalid authentication token",
      });
    }

    // 5. Verify this token belongs to a user
    if (
      !decoded ||
      decoded.type !== "user" ||
      !Number.isSafeInteger(decoded.userId) ||
      !Number.isSafeInteger(decoded.tenantId) ||
      decoded.userId <= 0 ||
      decoded.tenantId <= 0
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid user session",
      });
    }

    // 6. Verify user still exists and is active
    const [users] = await pool.query(
      `SELECT
         user_id,
         tenant_id,
         login_id,
         full_name,
         referral_code,
         sponsor_id,
         status
       FROM users
       WHERE user_id = ?
         AND tenant_id = ?
       LIMIT 1`,
      [decoded.userId, decoded.tenantId]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: "User account not found",
      });
    }

    const user = users[0];

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Your account is not active",
      });
    }

    // 7. Attach authenticated user to request
    req.user = {
      userId: user.user_id,
      tenantId: user.tenant_id,
      loginId: user.login_id,
      fullName: user.full_name,
      referralCode: user.referral_code,
      sponsorId: user.sponsor_id,
    };

    // 8. Continue to protected controller
    return next();
  } catch (error) {
    console.error("User authentication middleware error:", error);

    return res.status(500).json({
      success: false,
      message: "Authentication failed due to a server error",
    });
  }
};

module.exports = requireUser;