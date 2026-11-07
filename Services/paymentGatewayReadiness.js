
function hasValue(value) {
  return typeof value === "string" &&
    value.trim().length > 0;
}

function getGatewayReadiness(providerCode, environment = "test") {
  const code = String(providerCode || "").toLowerCase();

  if (environment !== "test") {
    return {
      configured: false,
      ready: false,
      reason: "Live gateway configuration not validated",
    };
  }

  if (code === "phonepe") {
    const version = Number(process.env.PHONEPE_CLIENT_VERSION);

    const configured =
      process.env.PHONEPE_ENVIRONMENT === "sandbox" &&
      hasValue(process.env.PHONEPE_CLIENT_ID) &&
      hasValue(process.env.PHONEPE_CLIENT_SECRET) &&
      Number.isSafeInteger(version) &&
      version > 0 &&
      hasValue(process.env.PHONEPE_REDIRECT_URL) &&
      !process.env.PHONEPE_CLIENT_ID.startsWith("demo_") &&
      !process.env.PHONEPE_CLIENT_SECRET.startsWith("demo_");

    return {
      configured,
      ready:
        configured &&
        process.env.PHONEPE_PAYMENT_ENABLED === "true",
      reason: configured ? null : "PhonePe configuration incomplete",
    };
  }

  if (code === "mswipe") {
    const configured =
      process.env.MSWIPE_ENVIRONMENT === "test" &&
      [
        "MSWIPE_USER_ID",
        "MSWIPE_CLIENT_ID",
        "MSWIPE_PASSWORD",
        "MSWIPE_CUST_CODE",
      ].every(key => hasValue(process.env[key]));

    return {
      configured,
      ready:
        configured &&
        process.env.MSWIPE_PAYMENT_ENABLED === "true",
      reason: configured ? null : "Mswipe configuration incomplete",
    };
  }

  return {
    configured: false,
    ready: false,
    reason: "Unsupported gateway",
  };
}

module.exports = { getGatewayReadiness };
