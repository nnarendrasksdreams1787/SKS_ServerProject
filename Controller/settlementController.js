const settlementService = require("../Services/settlementService");

const {
  prepareSettlementVerification,
} = require("../Services/settlementConfirmationService");



async function listPendingSettlements(req, res) {
  try {
    const settlements =
      await settlementService.getPendingSettlements();

    return res.status(200).json({
      success: true,
      count: settlements.length,
      data: settlements,
    });
  } catch (error) {
    console.error("Settlement listing error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve settlements",
    });
  }
}

async function getSettlement(req, res) {
  try {
    const settlement =
      await settlementService.getSettlementDetails(
        req.params.paymentOrderId
      );

    return res.status(200).json({
      success: true,
      data: settlement,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Unable to retrieve settlement",
    });
  }
}



async function prepareSettlement(req, res) {
  try {
    const result = await prepareSettlementVerification(
      req.params.paymentOrderId
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Settlement verification error:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Unable to prepare settlement verification",
    });
  }
}



module.exports = {
  listPendingSettlements,
  getSettlement,
  prepareSettlement,
};