const express = require("express");
const requireUser = require("../Middleware/requireUser");

const paymentRoutes = express.Router();

const {
  paymentHealth,
  getPaymentProviders,
  createPaymentOrder,
  initiatePayment,
  verifyPaymentStatus,
  reconcilePaymentStatus,
  initiateCommonPayment,
  recoverPaymentInitiation,
  
} = require("../Controller/paymentController");
const { handlePhonePeWebhook } = require("../Controller/phonepeWebhookController");

// Payment Engine Health Check
paymentRoutes.get("/health", paymentHealth);

// Available payment geteways
paymentRoutes.get("/providers", getPaymentProviders);


// Only authentication users can create payment orders.

paymentRoutes.post("/orders", requireUser, createPaymentOrder)

// paymentRoutes.post(
//   "/initiate",
//   requireUser,
//   initiatePayment
// );

// Legacy PhonePe-specific initiation endpoint disabled.
// Use POST /api/payments/checkout instead.


paymentRoutes.get(
  "/orders/:orderReference/status",
  requireUser,
  verifyPaymentStatus
);


paymentRoutes.post(
  "/orders/:orderReference/reconcile",
  requireUser,
  reconcilePaymentStatus
);


paymentRoutes.post(
  "/webhooks/phonepe",
  express.raw({ type: "application/json" }),
  handlePhonePeWebhook
);


paymentRoutes.post(
  "/checkout",
  requireUser,
  initiateCommonPayment
);


paymentRoutes.get(
  "/orders/:orderReference/recovery",
  requireUser,
  recoverPaymentInitiation
);

module.exports = paymentRoutes;