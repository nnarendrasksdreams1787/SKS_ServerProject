const mswipeService = {
  provider: "mswipe",

  async createPayment() {
    throw new Error("Mswipe payment API is not configured yet.");
  },

  async verifyPayment() {
    throw new Error("Mswipe verification API is not configured yet.");
  },
};

// Add above the existing mswipeService object.

function getMswipeConfig() {
  const config = {
    enabled: process.env.MSWIPE_PAYMENT_ENABLED === "true",
    environment: process.env.MSWIPE_ENVIRONMENT || "sandbox",
    merchantId: process.env.MSWIPE_MERCHANT_ID,
    apiKey: process.env.MSWIPE_API_KEY,
  };

  if (!config.enabled) {
    const error = new Error("Mswipe payment processing is disabled");
    error.statusCode = 503;
    throw error;
  }

  if (
    !config.merchantId ||
    !config.apiKey ||
    config.merchantId.startsWith("demo_") ||
    config.apiKey.startsWith("demo_")
  ) {
    throw new Error("Valid Mswipe credentials are required");
  }

  return config;
}

module.exports = {
  ...mswipeService,
  getMswipeConfig,
}
