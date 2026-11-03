const express = require("express");
const adminRoute = express.Router();
const {
  login,
  me,
  logout,
  setupFirstAdmin,
  getDashboardStats,
} = require("../Controller/adminController");
const requireAdmin = require("../Middleware/requireAdmin");
const uploadEbook = require("../Middleware/uploadEbook");

const {
  getProducts,
  getProductCategories,
  createProduct,
  updateProduct,
  updateProductStatus,
  createProductCategory,
  deleteProduct,
  updateProductCategory,
  updateProductCategoryStatus,
} = require("../Controller/adminProductsController");
const { getReferrals, createReferral, getReferralTree } = require("../Controller/adminReferralsController");
const { getNetwork } = require("../Controller/adminNetworkController");
const { getWallets, getWalletTransactions,  } = require("../Controller/adminWalletController");
const { getWithdrawals, getPayoutBatches } = require("../Controller/adminPayoutController");
const { getOrders, getOrderDetails } = require("../Controller/adminOrdersController");
const { getPaymentGateways, updateProviderStatus, updateGatewayEnabled } = require("../Controller/adminPaymentGetwayController");
const { getBankDetails, updateBankVerification } = require("../Controller/adminBankDetailsController");
const { requestAdminReset, resetAdminPassword } = require("../Controller/passwordResetController");

adminRoute.post("/setup", setupFirstAdmin);
adminRoute.post("/login", login);
adminRoute.get("/me", requireAdmin, me);
adminRoute.post("/logout", requireAdmin, logout);

adminRoute.post("/forgot-password", requestAdminReset);
adminRoute.post("/reset-password", resetAdminPassword);


adminRoute.get("/dashboard", requireAdmin, getDashboardStats);

adminRoute.get("/products", requireAdmin, getProducts);
adminRoute.post("/products", requireAdmin, uploadEbook, createProduct)
adminRoute.put("/products/:id", requireAdmin, uploadEbook, updateProduct);
adminRoute.patch("/products/:id/status", requireAdmin, updateProductStatus)
adminRoute.delete("/products/:id", requireAdmin, deleteProduct)

adminRoute.get("/categories", requireAdmin, getProductCategories);
adminRoute.post("/categories", requireAdmin, createProductCategory)
adminRoute.put("/categories/:id", requireAdmin, updateProductCategory);
adminRoute.patch("/categories/:id/status", requireAdmin, updateProductCategoryStatus)


// adminRoute.get("/referrals", requireAdmin, getReferrals);
// adminRoute.post("/referrals", requireAdmin, createReferral)

adminRoute.get("/referrals", requireAdmin, getReferrals)
adminRoute.get("/referral-tree/:userId", requireAdmin, getReferralTree)
adminRoute.post("/referrals/leads", requireAdmin, createReferral)


adminRoute.get("/network", requireAdmin, getNetwork);

adminRoute.get("/wallets", requireAdmin, getWallets);
adminRoute.get("/wallet-transactions", requireAdmin, getWalletTransactions)

adminRoute.get("/withdrawals", requireAdmin, getWithdrawals);
adminRoute.get("/payout-batches", requireAdmin, getPayoutBatches);


adminRoute.get("/orders", requireAdmin, getOrders);
adminRoute.get("/orders/:id", requireAdmin, getOrderDetails);

adminRoute.get("/payment-gateways", requireAdmin, getPaymentGateways)
adminRoute.patch("/payment-gateways/:providerId/status", requireAdmin, updateProviderStatus);
adminRoute.patch("/payment-gateways/:providerId/enabled", requireAdmin, updateGatewayEnabled)


adminRoute.get("/bank-details", requireAdmin, getBankDetails);
adminRoute.patch("/bank-details/:id/verification", requireAdmin, updateBankVerification);

module.exports = adminRoute;
