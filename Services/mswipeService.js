const MSWIPE_UAT_BASE_URL = "https://dcuat.mswipetech.co.in";

const { randomUUID } = require("node:crypto");

function getMswipeConfig() {
  const config = {
    enabled: process.env.MSWIPE_PAYMENT_ENABLED === "true",
    environment: process.env.MSWIPE_ENVIRONMENT,
    userId: process.env.MSWIPE_USER_ID,
    clientId: process.env.MSWIPE_CLIENT_ID,
    password: process.env.MSWIPE_PASSWORD,
    custCode: process.env.MSWIPE_CUST_CODE,
  };

  if (config.environment !== "test") {
    throw new Error("Only Mswipe test environment is supported");
  }

  if (
    !config.userId ||
    !config.clientId ||
    !config.password ||
    !config.custCode
  ) {
    throw new Error("Mswipe Demo credentials are incomplete");
  }

  return config;
}

async function generateMswipeToken() {
  const config = getMswipeConfig();

  const response = await fetch(
    `${MSWIPE_UAT_BASE_URL}/ipg/api/CreatePBLAuthToken`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: config.userId,
        clientId: config.clientId,
        password: config.password,
        applId: "api",
        channelId: "pbl",
      }),
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!response.ok) {
    throw new Error(`Mswipe token request failed: HTTP ${response.status}`);
  }

  const data = await response.json();

  if (
    String(data.status).toLowerCase() !== "true" ||
    typeof data.token !== "string" ||
    !data.token
  ) {
    throw new Error(
      `Mswipe authentication failed: ${String(data.msg || "Unknown error")}`,
    );
  }

  return data.token;
}

// async function createPayment() {
//   throw new Error("Mswipe checkout is not implemented yet");
// }

async function createPayment({ orderReference, amountPaise, customer }) {
  const config = getMswipeConfig();

  if (
    typeof orderReference !== "string" ||
    !/^SKS_[a-f0-9]{32}$/.test(orderReference)
  ) {
    throw new Error("Invalid Mswipe order reference");
  }

  if (!Number.isSafeInteger(amountPaise) || amountPaise < 100) {
    throw new Error("Invalid Mswipe payment amount");
  }

  if (
    !customer ||
    !/^\d{10}$/.test(String(customer.mobile || "")) ||
    typeof customer.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)
  ) {
    throw new Error("Valid Mswipe customer details are required");
  }

  const token = await generateMswipeToken();

  const requestId = randomUUID();

  const response = await fetch(`${MSWIPE_UAT_BASE_URL}/ipg/api/MswipePayment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: (amountPaise / 100).toFixed(2),
      mobileno: customer.mobile,
      custcode: config.custCode,
      user_id: config.userId,
      sessiontoken: token,
      versionno: "VER4.0.0",
      email_id: customer.email,
      invoice_id: orderReference,
      request_id: requestId,
      redirect_url: process.env.MSWIPE_REDIRECT_URL || "",
      IsSendSMS: false,
      ConvAllow: "false",
      ApplicationId: "api",
      ChannelId: "pbl",
      ClientId: config.clientId,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(
      `Mswipe payment link request failed: HTTP ${response.status}`,
    );
  }

  const data = await response.json();

  if (
    String(data.status).toLowerCase() !== "true" ||
    typeof data.smslink !== "string" ||
    !data.smslink ||
    typeof data.txn_id !== "string" ||
    !data.txn_id
  ) {
    throw new Error("Mswipe did not confirm payment link creation");
  }

  const checkoutUrl = new URL(data.smslink);

  if (
    checkoutUrl.protocol !== "https:" ||
    checkoutUrl.hostname !== "dcuat.mswipetech.co.in"
  ) {
    throw new Error("Unexpected Mswipe checkout URL");
  }

  const transId = checkoutUrl.searchParams.get("TransID");

  if (!transId) {
    throw new Error("Mswipe checkout URL has no transaction reference");
  }

  return {
    checkoutUrl: checkoutUrl.toString(),
    gatewayTransactionId: data.txn_id,
    gatewayReference: transId,
    requestId,
  };
}

async function verifyPayment({ gatewayReference }) {
  if (
    typeof gatewayReference !== "string" ||
    !gatewayReference.trim() ||
    gatewayReference.length > 150
  ) {
    throw new Error("Invalid Mswipe transaction reference");
  }

  const config = getMswipeConfig();

  const response = await fetch(
    `${MSWIPE_UAT_BASE_URL}/ipg/api/getPBLTransactionDetails`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: gatewayReference,
      }),
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Mswipe verification request failed: HTTP ${response.status}`,
    );
  }

  const data = await response.json();

  if (
    String(data.Status).toLowerCase() !== "true" ||
    !Array.isArray(data.Data) ||
    data.Data.length !== 1
  ) {
    throw new Error("Invalid Mswipe verification response");
  }

  const txn = data.Data[0];

  const paymentStatus = Number(txn.Payment_Status);

  const gatewayState =
    paymentStatus === 1
      ? "COMPLETED"
      : paymentStatus === 2
        ? "PENDING"
        : paymentStatus === 0
          ? "FAILED"
          : "UNKNOWN";
  return {
    providerCode: "mswipe",
    gatewayState,
    orderReference: String(txn.Order_Id || ""),
    amount: txn.Amount,
    gatewayTransactionId: String(txn.IPG_ID || ""),
    paymentId: String(txn.Payment_Id || ""),
    gatewayReference,
  };
}

module.exports = {
  provider: "mswipe",
  getMswipeConfig,
  generateMswipeToken,
  createPayment,
  verifyPayment,
};
