const bcrypt = require("bcrypt");
const pool = require("../DB/db");
const crypto = require("node:crypto");

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

exports.login = async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const password = req.body.password;

    if (!email || typeof password !== "string" || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const [admins] = await pool.execute(
      `SELECT admin_id, email, password_hash, status
            FROM platform_admins
            WHERE email = ?
            LIMIT 1`,
      [email],
    );

    const admin = admins[0];

    const passwordMatches = 
        admin && typeof password === "string"
        ? await bcrypt.compare(password, admin.password_hash)
        : false;

    // console.log("Admin found: ", Boolean(admin));
    // console.log("Admin active: ", admin?.status == "active");
    // console.log("Password matches:", passwordMatches);

    if (
        !admin ||
        admin.status !== "active" ||
        !passwordMatches
    ){
        return res.status(401).json({
            message: "Invalid email or password",
        })
    }

    // Use a generic response to avoid reveling account status.

    // if (
    //   !admin ||
    //   admin.status !== "active" ||
    //   !((await bcrypt) > bcrypt.compare(password, admin.password_hash))
    // ) {
    //   return res.status(401).json({
    //     message: "Invalid email or password",
    //   });
    // }

    // Route the session ID after successful authenticaiton.
    await regenerateSession(req);

    req.session.adminId = admin.admin_id;
    req.session.adminEmail = admin.email;

    await saveSession(req);

    return res.json({
      message: "Admin login successful",
      admin: {
        id: admin.admin_id,
        email: admin.email,
      },
    });
  } catch (error) {
    console.error("Admin login error: ", error.message);

    return res.status(500).json({
      message: "Unable to log in",
    });
  }
};

exports.me = (req, res) => {
  res.json({
    admin: req.admin,
  });
};


exports.logout = (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error("Admin logout error:", error.message);
      return res.status(500).json({
        message: "Unable to log out",
      });
    }

    res.clearCookie("sks_admin.sid", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    return res.json({
      message: "Admin logged out successfully",
    });
  });
};



exports.setupFirstAdmin = async (req, res) => {
  let connection;

  try {
    const suppliedSecreate = req.get("x-admin-setup-secret") || "";
    const expectedSecreate = process.env.ADMIN_SETUP_SECRET || "";

    if (!expectedSecreate) {
      return res.status(503).json({
        message: "Admin setup is not configured",
      });
    }

    const supplied = Buffer.from(suppliedSecreate);
    const expected = Buffer.from(expectedSecreate);

    // console.log("SETUP secret configured:", Boolean(expectedSecreate))
    // console.log("Recive setup secret:", Boolean(suppliedSecreate));
    // console.log(
    //     "Recived secret length:",
    //     suppliedSecreate.length
    // );
    // console.log("Expected secret length: ", expectedSecreate.length)


    if (
      supplied.length !== expected.length ||
      !crypto.timingSafeEqual(supplied, expected)
    ) {
      return res.status(403).json({
        message: "Invalid setup secret",
      });
    }

    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const password = req.body.password;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        message: "Enter a valid email address",
      });
    }

    if (typeof password !== "string" || password.length < 12) {
      return res.status(400).json({
        message: "Password must contain at least 12 characters",
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Lock the admin table for concurrent setup requests.
    await connection.query("LOCK TABLES platform_admins WRITE");

    const [existing] = await connection.query(
      "SELECT admin_id FROM platform_admins LIMIT 1",
    );

    if (existing.length > 0) {
      await connection.query("UNLOCK TABLES");
      await connection.rollback();

      return res.status(409).json({
        message: "An admin already exists. Setup is closed.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await connection.query(
      `INSERT INTO platform_admins
       (email, password_hash, status)
       VALUES (?, ?, 'active')`,
      [email, passwordHash],
    );

    await connection.query("UNLOCK TABLES");
    await connection.commit();

    return res.status(201).json({
      message: "First admin account created successfully",
      email,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.query("UNLOCK TABLES");
        await connection.rollback();
      } catch (_) {}
    }

    console.error("Admin setup error:", error.message);

    return res.status(500).json({
      message: "Unable to create the first admin",
    });
  } finally {
    if (connection) connection.release();
  }
};





// exports.getDashboardStats = async (req, res) => {
//   try {
//     // SKS Dream tenant
    

//     const [rows] = await pool.execute(
//       `
//             SELECT 
//                 (SELECT COUNT(*) FROM users) AS totalCustomers,
//                 (SELECT COUNT(*) FROM products) AS totalProducts,
//                 (SELECT COUNT(*) FROM orders) AS totalOrders,
//                 (
//                     SELECT COUNT(*)
//                     FROM withdrawal_requests
//                     WHERE status = "pending"
//                 ) AS pendingPayouts
                


//             `,
//     );

//     const stats = rows[0];

//     return res.json({
//       stats: {
//         totalCustomers: Number(stats.totalCustomers),
//         totalProducts: Number(stats.totalProducts),
//         totalOrders: Number(stats.totalOrders),
//         pendingPayouts: Number(stats.pendingPayouts),
//       },
//     });
//   } catch (error) {
//     console.error("Dashboard stats error:", error.message);

//     return res.status(500).json({
//         message: "Unable to load dashboard statistics",
//     })
//   }
// };




exports.getDashboardStats = async (req, res) => {
  try {
    const TENANT_ID = 1;

    const [rows] = await pool.execute(
      `SELECT
        (
          SELECT COUNT(*)
          FROM users
          WHERE tenant_id = ?
        ) AS totalCustomers,

        (
          SELECT COUNT(*)
          FROM products
          WHERE tenant_id = ?
        ) AS totalProducts,

        (
          SELECT COALESCE(SUM(total_amount), 0)
          FROM orders
          WHERE tenant_id = ?
            AND status = 'paid'
        ) AS totalRevenue,

        (
          SELECT COALESCE(SUM(tax_amount), 0)
          FROM orders
          WHERE tenant_id = ?
            AND status = 'paid'
        ) AS totalTaxCollected,

        (
          SELECT COALESCE(SUM(amount), 0)
          FROM commissions
          WHERE tenant_id = ?
            AND status = 'approved'
        ) AS commissionEarned,

        (
          SELECT COALESCE(SUM(amount), 0)
          FROM withdrawal_requests
          WHERE tenant_id = ?
            AND status = 'paid'
        ) AS totalWithdrawn,

        (
          SELECT COUNT(*)
          FROM withdrawal_requests
          WHERE tenant_id = ?
            AND status = 'pending'
        ) AS pendingPayouts,

        (
          SELECT COUNT(*)
          FROM user_profiles
          WHERE tenant_id = ?
            AND kyc_status = 'pending'
        ) AS pendingKycRequests
      `,
      [
        TENANT_ID,
        TENANT_ID,
        TENANT_ID,
        TENANT_ID,
        TENANT_ID,
        TENANT_ID,
        TENANT_ID,
        TENANT_ID,
      ]
    );

    const row = rows[0];

    return res.json({
      stats: {
        totalCustomers: Number(row.totalCustomers),
        totalProducts: Number(row.totalProducts),
        totalRevenue: Number(row.totalRevenue),
        totalTaxCollected: Number(row.totalTaxCollected),
        commissionEarned: Number(row.commissionEarned),
        totalWithdrawn: Number(row.totalWithdrawn),
        pendingPayouts: Number(row.pendingPayouts),
        pendingKycRequests: Number(row.pendingKycRequests),
      },
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);

    return res.status(500).json({
      message: "Unable to load dashboard statistics",
    });
  }
};
