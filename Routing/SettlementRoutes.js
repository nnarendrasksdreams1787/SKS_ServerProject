const express = require("express");

const settleRoutes = express.Router();

const requireAdmin = require("../Middleware/requireAdmin");

const {
  listPendingSettlements,
  getSettlement,
  prepareSettlement,
  previewCommissions,
  processCommissions,
} = require("../Controller/settlementController");

settleRoutes.get(
  "/pending",
  requireAdmin,
  listPendingSettlements
);

settleRoutes.get(
  "/:paymentOrderId",
  requireAdmin,
  getSettlement
);

settleRoutes.post(
  "/:paymentOrderId/prepare",
  requireAdmin,
  prepareSettlement
);


settleRoutes.get(
  "/:paymentOrderId/commission-preview",
  requireAdmin,
  previewCommissions
);


settleRoutes.post(
  "/:paymentOrderId/process-commissions",
  requireAdmin,
  processCommissions,
);


module.exports = settleRoutes;