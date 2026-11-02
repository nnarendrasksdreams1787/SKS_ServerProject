const express = require("express");
const requireUser = require("../Middleware/requireUser");
const { getDashboard } = require("../Controller/dashboardController");
const { getDirectReferrals } = require("../Controller/referralController");
const { getMyNetwork } = require("../Controller/networkController");
const { getMyOrders } = require("../Controller/orderController");
const { getMyWallet } = require("../Controller/walletController");
const {
  getBankAccounts,
  addBankAccount,
  updateBankAccount,
  setPrimaryBankAccount,
} = require("../Controller/bankController");
const router = express.Router();

// Protect all user routes
router.use(requireUser);

// Dashboard API
router.get("/dashboard", getDashboard);

// Refer & Earn — logged-in user's direct referrals
router.get("/referrals", getDirectReferrals);

router.get("/network", getMyNetwork);

router.get("/orders", getMyOrders);

router.get("/wallet", getMyWallet);



// Bank Details APIs
router.get("/bank-accounts", getBankAccounts);

router.post("/bank-accounts", addBankAccount);

router.put("/bank-accounts/:id", updateBankAccount);

router.patch(
  "/bank-accounts/:id/primary",
  setPrimaryBankAccount
);

// Logged-in user information
router.get("/me", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "User authenticated successfully",
    user: {
      user_id: req.user.userId,
      tenant_id: req.user.tenantId,
      login_id: req.user.loginId,
      full_name: req.user.fullName,
      referral_code: req.user.referralCode,
      sponsor_id: req.user.sponsorId,
    },
  });
});

module.exports = router;