const express = require("express")
const authRoute = express.Router();

const { register, login } = require("../Controller/authController");
const { requestUserReset, resetUserPassword } = require("../Controller/passwordResetController");

authRoute.post("/register", register);
authRoute.post("/login", login)

// Password reset using a link sent by SMS - no OTP.

authRoute.post("/forgot-password", requestUserReset);
authRoute.post("/reset-password", resetUserPassword)

module.exports = authRoute;