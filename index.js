require("dotenv").config();
const express = require("express")
const app = express();
const pool = require("./DB/db");
const cors = require("cors")
const session = require("express-session")
const MySQLStoreFactory = require("express-mysql-session");
const authRoute = require("./Routing/authRoutes");
const adminRoute = require("./Routing/adminRoutes");
const PORT =  process.env.PORT || 4010;

const isProduction = process.env.NODE_ENV == "production";

if (!process.env.SESSION_SECRET){
    throw new Error("SESSION_SECRET is required")
}

if (isProduction ){
    // Required when HTTPS terminaes at a trusted revese proxy
    app.set("trust proxy", 1);
}

if (process.env.FRONTEND_URL){
    app.use(
        cors({
            origin: process.env.FRONTEND_URL,
            credentials: true,
        })
    )
}

app.use (express.json());

app.use(express.urlencoded({ extended: true }));

const MySQLStore = MySQLStoreFactory(session);

const sessionStore = new MySQLStore({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: 8 * 60 * 60 * 1000,
});

app.use(
    session ({
        name: "sks_admin.sid",
        secret: process.env.SESSION_SECRET,
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: isProduction,
            sameSite: "lax",
            maxAge: 8 * 60 * 60 * 1000,
        }

    })
)



// IMPORTANT: Parse incoming request bodies first
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.get("/", (req, res)=>{
    res.send("SKS Dream API is running");
});


app.use("/api/auth", authRoute);
app.use("/api/admin", adminRoute);

async function startServer() {
    try {
        await pool.query("SELECT 1");
        app.listen(PORT, ()=> {
            console.log(`Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Datebase connection failed: ", error.message)
        process.exit(1);
    }
}


startServer();