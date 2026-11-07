require("dotenv").config();
const express = require("express");
const app = express();
const pool = require("./DB/db");
const cors = require("cors");
const session = require("express-session");
const MySQLStoreFactory = require("express-mysql-session");
const authRoute = require("./Routing/authRoutes");
const adminRoute = require("./Routing/adminRoutes");
const PORT = process.env.PORT || 4010;
const chantTTSRoutes = require("./Routing/ChantTtsRoutes");

const { startCommissionWorker } = require("./Services/commissionWorker");

const userRoutes = require("./Routing/userRoutes");

const paymentRoutes = require("./Routing/PaymentRoutes");

const isProduction = process.env.NODE_ENV == "production";

const {
  startPhonePeWebhookWorker,
} = require("./Services/phonepeWebhookWorker");
const settleRoutes = require("./Routing/SettlementRoutes");
const bookAccRoutes = require("./Routing/BookAccessRoutes");

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required");
}

if (isProduction) {
  // Required when HTTPS terminaes at a trusted revese proxy
  app.set("trust proxy", 1);
}

// if (process.env.FRONTEND_URL) {
//   app.use(
//     cors({
//       origin: process.env.FRONTEND_URL,
//       credentials: true,
//     }),
//   );
// }

const allowedOrigins = (
  process.env.FRONTEND_URLS ||
  process.env.FRONTEND_URL ||
  ""
)
  .split(",")
  .map((url) => url.trim().replace(/\/+$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server and non-browser requests.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn("CORS blocked origin:", origin);
      return callback(null, false);
    },

    credentials: true,

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(
  express.json({
    verify: (req, res, buf) => {
      if (req.originalUrl.startsWith("/api/payments/webhooks/phonepe")) {
        req.rawBody = buf.toString("utf8");
      }
    },
  }),
);

app.use(express.urlencoded({ extended: true }));

const MySQLStore = MySQLStoreFactory(session);

const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  ...(process.env.DB_CA_CERT
    ? {
        ssl: {
          ca: process.env.DB_CA_CERT.replace(/\\n/g, "\n"),
          rejectUnauthorized: true,
        },
      }
    : {}),

  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 8 * 60 * 60 * 1000,
});

app.use(
  session({
    name: "sks_admin.sid",
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "none",
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);

// IMPORTANT: Parse incoming request bodies first
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("SKS Dream API is running");
});

app.use("/api/auth", authRoute);
app.use("/api/admin", adminRoute);

app.use("/api/user", userRoutes);

app.use("/api/payments", paymentRoutes);

app.use("/api/settlements", settleRoutes);

app.use("/api/library", bookAccRoutes);

app.use("/api/chant-tts", chantTTSRoutes);

app.get("/api/products", async (req, res) => {
  try {
    const pool = require("./DB/db");

    // const [rows] = await pool.execute(
    //   `SELECT
    //      p.product_id AS id,
    //      p.title AS name,
    //      p.slug,
    //      p.description,
    //      p.author,
    //      c.name AS category,
    //      p.price,
    //      p.cover_image_key
    //    FROM products p
    //    INNER JOIN categories c
    //      ON c.category_id = p.category_id
    //     AND c.tenant_id = p.tenant_id
    //    WHERE p.tenant_id = ?
    //      AND p.is_active = 1
    //    ORDER BY p.created_at DESC`,
    //   [1],
    // );

    const [rows] = await pool.execute(
      `SELECT
     p.product_id AS id,
     p.title AS name,
     p.slug,
     p.description,
     p.author,
     c.name AS category,
     p.price,
     p.cover_image_key,
     p.ebook_storage_key,
     p.docx_storage_key
   FROM products p
   INNER JOIN categories c
     ON c.category_id = p.category_id
    AND c.tenant_id = p.tenant_id
   WHERE p.tenant_id = ?
     AND p.is_active = 1
   ORDER BY p.created_at DESC`,
      [1],
    );
    res.json({
      products: rows.map((product) => ({
        ...product,
        price: Number(product.price),
      })),
    });
  } catch (error) {
    console.error("Public products error:", error.message);
    res.status(500).json({
      message: "Unable to load products",
    });
  }
});

async function startServer() {
  try {
    await pool.query("SELECT 1");
    app.listen(PORT, () => {
      startPhonePeWebhookWorker();
      startCommissionWorker();
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Datebase connection failed: ", error.message);
    process.exit(1);
  }
}

startServer();
