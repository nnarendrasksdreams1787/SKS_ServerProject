const pool = require("../DB/db");

const TENANT_ID = 1;

function settlementError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Prepare a settlement for verification.
 *
 * This function DOES NOT confirm settlement
 * and DOES NOT unlock a book.
 */
async function prepareSettlementVerification(paymentOrderId) {
  const id = Number(paymentOrderId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw settlementError("Invalid payment order ID");
  }

  const [rows] = await pool.execute(
    `
    SELECT
      payment_order_id,
      order_reference,
      provider_code,
      environment,
      amount_paise,
      currency,
      payment_status,
      settlement_status,
      access_status
    FROM payment_orders
    WHERE tenant_id = ?
      AND payment_order_id = ?
    LIMIT 1
    `,
    [TENANT_ID, id]
  );

  if (!rows.length) {
    throw settlementError("Payment order not found", 404);
  }

  const order = rows[0];

  if (order.payment_status !== "success") {
    throw settlementError(
      "Payment must be verified successfully before settlement",
      409
    );
  }

  if (order.settlement_status === "settled") {
    return {
      eligible: false,
      alreadySettled: true,
      orderReference: order.order_reference,
      settlementStatus: "settled",
      accessStatus: order.access_status,
    };
  }

  if (order.settlement_status !== "pending") {
    throw settlementError(
      "Order is not eligible for settlement verification",
      409
    );
  }

  if (order.access_status !== "locked") {
    throw settlementError(
      "Unexpected book access state",
      409
    );
  }

  return {
    eligible: true,
    paymentOrderId: order.payment_order_id,
    orderReference: order.order_reference,
    providerCode: order.provider_code,
    environment: order.environment,
    expectedAmountPaise: Number(order.amount_paise),
    currency: order.currency,
    paymentStatus: order.payment_status,
    settlementStatus: order.settlement_status,
    accessStatus: order.access_status,
    verificationStatus: "awaiting_provider_evidence",
  };
}

module.exports = {
  prepareSettlementVerification,
};