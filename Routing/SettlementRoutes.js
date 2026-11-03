const express = require("express");

const settleRoutes = express.Router();

const requireAdmin = require("../Middleware/requireAdmin");

const {
  listPendingSettlements,
  getSettlement,
  prepareSettlement,
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

router.post(
  "/:paymentOrderId/prepare",
  requireAdmin,
  prepareSettlement
);



module.exports = settleRoutes;