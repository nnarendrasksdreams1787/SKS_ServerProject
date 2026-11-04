const crypto = require("node:crypto");

const phonepeService = require("../Services/phonepeService");

const paymentRepository = require("../Services/paymentRepository");

async function handlePhonePeWebhook(req, res) {
  // Real gateway processing is disabled until
  // valid merchant credentials are configured.
  // if (process.env.PHONEPE_PAYMENT_ENABLED !== "true") {
  //   return res.sendStatus(503);
  // }

  if (
    process.env.PHONEPE_PAYMENT_ENABLED !== "true" ||
    process.env.PHONEPE_ENVIRONMENT !== "sandbox"
  ) {
    return res.sendStatus(503);
  }

  const authorizationHeader = req.get("authorization");

  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString("utf8")
    : req.rawBody;

  if (!authorizationHeader || typeof rawBody !== "string" || !rawBody) {
    return res.sendStatus(400);
  }

  // Step 1: Authenticate the callback.
  try {
    await phonepeService.validateWebhook({
      authorizationHeader,
      rawBody,
    });
  } catch (error) {
    console.error("PhonePe webhook authentication failed");

    return res.sendStatus(401);
  }

  // Step 2: Save the authenticated event.
  try {
    const eventHash = crypto
      .createHash("sha256")
      .update(rawBody, "utf8")
      .digest("hex");

    const result = await paymentRepository.savePaymentWebhookEvent({
      providerCode: "phonepe",
      eventHash,
      payload: rawBody,
    });

    // Step 3: Acknowledge only after durable storage.
    return res.status(200).json({
      success: true,
      accepted: true,
      duplicate: result.duplicate,
    });
  } catch (error) {
    console.error("PhonePe webhook storage failed:", error.message);

    // Non-2xx response allows the gateway to retry,
    // according to its delivery policy.
    return res.sendStatus(503);
  }
}

module.exports = {
  handlePhonePeWebhook,
};
