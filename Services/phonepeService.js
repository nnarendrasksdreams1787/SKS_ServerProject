// Services/phonepeService.js

const {
  StandardCheckoutClient,
  StandardCheckoutPayRequest,
  Env,
} = require("@phonepe-pg/pg-sdk-node");

let phonepeClient = null;

// Check whether real PhonePe calls are enabled
function isPhonePeEnabled() {
  return process.env.PHONEPE_PAYMENT_ENABLED === "true";
}

// Initialize PhonePe SDK only when needed
function getPhonePeClient() {
  if (!isPhonePeEnabled()) {
    throw new Error("PhonePe payment processing is disabled.");
  }

  const clientId = process.env.PHONEPE_CLIENT_ID;
  const clientSecret = process.env.PHONEPE_CLIENT_SECRET;
  const clientVersion = Number(process.env.PHONEPE_CLIENT_VERSION);

  if (
    !clientId ||
    !clientSecret ||
    !Number.isSafeInteger(clientVersion) ||
    clientVersion <= 0 ||
    clientId.startsWith("demo_") ||
    clientSecret.startsWith("demo_")
  ) {
    throw new Error("Valid PhonePe merchant credentials are required.");
  }

  if (!phonepeClient) {
    const environment =
      process.env.PHONEPE_ENVIRONMENT === "production"
        ? Env.PRODUCTION
        : Env.SANDBOX;

    phonepeClient = StandardCheckoutClient.getInstance(
      clientId,
      clientSecret,
      clientVersion,
      environment,
    );
  }

  return phonepeClient;
}

const phonepeService = {
  provider: "phonepe",

  // Initiate payment with PhonePe
  async createPayment({ orderReference, amountPaise }) {
    if (
      typeof orderReference !== "string" ||
      !/^[A-Za-z0-9_-]{1,63}$/.test(orderReference)
    ) {
      throw new Error("Invalid payment order reference.");
    }

    if (!Number.isSafeInteger(amountPaise) || amountPaise < 100) {
      throw new Error("Invalid payment amount.");
    }

    const client = getPhonePeClient();

    const redirectUrl = process.env.PHONEPE_REDIRECT_URL;

    if (!redirectUrl) {
      throw new Error("PhonePe redirect URL is not configured.");
    }

    const request = StandardCheckoutPayRequest.builder()
      .merchantOrderId(orderReference)
      .amount(amountPaise)
      .redirectUrl(redirectUrl)
      .build();

    const response = await client.pay(request);

    if (!response?.redirectUrl) {
      throw new Error("PhonePe did not return a checkout URL.");
    }

    return {
      providerCode: "phonepe",
      orderReference,
      checkoutUrl: response.redirectUrl,
      paymentStatus: "pending",
    };
  },

  // Check actual payment status from PhonePe
  // async verifyPayment({ orderReference }) {
  //   if (
  //     typeof orderReference !== "string" ||
  //     !/^[A-Za-z0-9_-]{1,63}$/.test(orderReference)
  //   ) {
  //     throw new Error("Invalid payment order reference.");
  //   }

  //   const client = getPhonePeClient();

  //   const response = await client.getOrderStatus(
  //     orderReference
  //   );

  //   return {
  //     providerCode: "phonepe",
  //     orderReference,
  //     gatewayState: response.state,
  //     gatewayResponse: response,
  //   };
  // },

  async verifyPayment({ orderReference }) {
    if (
      typeof orderReference !== "string" ||
      !/^SKS_[a-f0-9]{32}$/.test(orderReference)
    ) {
      const error = new Error("Invalid order reference");
      error.statusCode = 400;
      throw error;
    }

    const client = getPhonePeClient();

    const response = await client.getOrderStatus(orderReference);

    const gatewayState = String(response?.state || "")
      .trim()
      .toUpperCase();

    if (!["COMPLETED", "FAILED", "PENDING"].includes(gatewayState)) {
      const error = new Error("PhonePe returned an unsupported payment state");
      error.statusCode = 502;
      throw error;
    }

    return {
      providerCode: "phonepe",
      orderReference,
      gatewayState,
      gatewayResponse: response,
    };
  },

  // Validate PhonePe webhook authentication
  validateWebhook({ authorizationHeader, rawBody }) {
    if (
      typeof authorizationHeader !== "string" ||
      !authorizationHeader ||
      typeof rawBody !== "string" ||
      !rawBody
    ) {
      throw new Error("Invalid PhonePe webhook request.");
    }

    const username = process.env.PHONEPE_WEBHOOK_USERNAME;

    const password = process.env.PHONEPE_WEBHOOK_PASSWORD;

    if (
      !username ||
      !password ||
      username.startsWith("demo_") ||
      password.startsWith("demo_")
    ) {
      throw new Error("PhonePe webhook credentials are not configured.");
    }

    const client = getPhonePeClient();

    return client.validateCallback(
      username,
      password,
      authorizationHeader,
      rawBody,
    );
  },
};

module.exports = phonepeService;
