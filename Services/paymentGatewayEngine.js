const paymentRepository = require("./paymentRepository");
const phonepeService = require("./phonepeService");
const mswipeService = require("./mswipeService");

const GATEWAY_SERVICES = {
  phonepe: phonepeService,
  mswipe: mswipeService,
};

function getGatewayService(providerCode) {
  const provider = String(providerCode || "")
    .trim()
    .toLowerCase();

  const service = GATEWAY_SERVICES[provider];

  if (!service) {
    const error = new Error("Unsupported payment gateway");
    error.statusCode = 400;
    throw error;
  }

  return service;
}

async function getActiveGateway(environment = "test") {
  const selection = await paymentRepository.getSelectedGateway(environment);

  if (!selection) {
    const error = new Error("No active payment gateway selected");
    error.statusCode = 503;
    throw error;
  }

  const providerCode = String(
    selection.providerCode || selection.provider_code || "",
  ).toLowerCase();

  const service = getGatewayService(providerCode);

  return {
    providerCode,
    environment,
    service,
  };
}

async function initiateGatewayPayment({
  providerCode,
  orderReference,
  amountPaise,
  customer,
}) {
  if (
    typeof orderReference !== "string" ||
    !/^SKS_[a-f0-9]{32}$/.test(orderReference)
  ) {
    const error = new Error("Invalid payment order reference");
    error.statusCode = 400;
    throw error;
  }

  if (!Number.isSafeInteger(amountPaise) || amountPaise < 100) {
    const error = new Error("Invalid payment amount");
    error.statusCode = 400;
    throw error;
  }

  const service = getGatewayService(providerCode);

  if (typeof service.createPayment !== "function") {
    throw new Error("Gateway checkout is not configured");
  }

  //   return service.createPayment({
  //     orderReference,
  //     amountPaise,
  //   });

  const result = await service.createPayment({
    orderReference,
    amountPaise,
     ...(providerCode === "mswipe" ? { customer } : {}),
  });

  if (!result || typeof result.checkoutUrl !== "string") {
    const error = new Error("Gateway did not return a valid checkout URL");
    error.statusCode = 502;
    throw error;
  }

  let checkoutUrl;

  try {
    checkoutUrl = new URL(result.checkoutUrl);
  } catch {
    const error = new Error("Invalid gateway checkout URL");
    error.statusCode = 502;
    throw error;
  }

  if (checkoutUrl.protocol !== "https:") {
    const error = new Error("Gateway checkout URL must use HTTPS");
    error.statusCode = 502;
    throw error;
  }

  return result;
}

async function verifyGatewayPayment({ providerCode, orderReference }) {
  const service = getGatewayService(providerCode);

  if (typeof service.verifyPayment !== "function") {
    throw new Error("Gateway verification is not configured");
  }

  return service.verifyPayment({
    orderReference,
  });
}

module.exports = {
  getGatewayService,
  getActiveGateway,
  initiateGatewayPayment,
  verifyGatewayPayment,
};
