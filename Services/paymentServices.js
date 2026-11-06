const pool = require("../DB/db");

const { getGateway, getSupportedGateways } = require("./getwaySelector");
const paymentRepository = require("./paymentRepository");
const paymentGatewayEngine = require("./paymentGatewayEngine");

const TENANT_ID = 1;

// const SUPPORTED_GATWAYS = ["phonepe", "mswipe"];

/**
 * Get payment gateway configuration status.
 *
 * This function does NOT initiate payments.
 * It only reads configured gateway availability.
 */

// async function getAvailableGateways(environment = "test") {

//    if (!["test", "live"].includes(environment)) {
//     throw new Error("Invalid payment environment.");
//   }

//   const [rows] = await pool.execute(
//     `
//     SELECT
//       p.provider_id,
//       p.provider_code,
//       p.provider_name,
//       p.status,
//       p.is_default,
//       c.environment,
//       c.is_enabled

//     FROM payment_gateway_providers p

//     INNER JOIN payment_gateway_configs c
//       ON c.provider_id = p.provider_id
//       AND c.tenant_id = p.tenant_id

//     WHERE
//       p.tenant_id = ?
//       AND p.status = 'active'
//       AND c.is_enabled = 1
//       AND c.environment = ?

//     ORDER BY p.provider_id ASC
//     `,
//     [TENANT_ID, environment]
//   );

//   return rows
//     .filter((row) =>
//       SUPPORTED_GATEWAYS.includes(
//         String(row.provider_code).toLowerCase()
//       )
//     )
//     .map((row) => ({
//       providerId: row.provider_id,
//       providerCode: row.provider_code,
//       providerName: row.provider_name,
//       environment: row.environment,
//       isDefault: Boolean(row.is_default),
//     }));
// }

// /**
//  * Resolve a gateway service by provider code.
//  *
//  * This function is for internal backend use.
//  * It does not determine the admin-selected gateway.
//  */
// function resolveGatewayService(providerCode) {
//   return getGateway(providerCode);
// }

// // services/paymentServices.js

// const {getGateway, get} = require("./getwaySelector");

// module.exports = {
//   getAvailableGateways,
//   resolveGatewayService,
// };

async function getAvailableGateways(environment = "test") {
  if (!["test", "live"].includes(environment)) {
    throw new Error("Invalid payment environment");
  }

  const supportedGateways = getSupportedGateways();

  const [rows] = await pool.execute(
    `
    SELECT
      p.provider_id,
      p.provider_code,
      p.provider_name,
      p.status,
      p.is_default,
      c.environment,
      c.is_enabled

    FROM payment_gateway_providers p

    INNER JOIN payment_gateway_configs c
      ON c.provider_id = p.provider_id
      AND c.tenant_id = p.tenant_id

    WHERE
      p.tenant_id = ?
      AND p.status = 'active'
      AND c.is_enabled = 1
      AND c.environment = ?

    ORDER BY p.provider_id ASC
    `,
    [TENANT_ID, environment],
  );

  return rows
    .filter((row) =>
      supportedGateways.includes(String(row.provider_code).toLowerCase()),
    )
    .map((row) => ({
      providerId: row.provider_id,
      providerCode: row.provider_code,
      providerName: row.provider_name,
      environment: row.environment,
      isDefault: Boolean(row.is_default),
    }));
}

// Resolve payment gateway service
function resolveGatewayService(providerCode) {
  return getGateway(providerCode);
}

async function getSelectedPaymentGateway(environment = "test") {
  return paymentRepository.getSelectedGateway(environment);
}

// Update admin-selected payment getways

async function updateSelectedPaymentGateway(
  providerCode,
  environment = "test",
) {
  const code = String(providerCode || "")
    .trim()
    .toLowerCase();

  const result = await paymentRepository.saveSelectedGateway(code, environment);

  return {
    success: true,
    message: "Payment geteway selected successfully",
    ...result,
  };
}

// Customer checkout: create a pending order.
// The repository is responsible for database operations.

async function createCheckoutOrder({
  userId,
  tenantId,
  productId,
  idempotencyKey,
  environment = "test",
}) {
  return paymentRepository.createPendingPaymentOrder({
    userId,
    tenantId,
    productId,
    idempotencyKey,
    environment,
  });
}

async function initiatePhonePeCheckout({ userId, tenantId, orderReference }) {
  if (process.env.PHONEPE_PAYMENT_ENABLED !== "true") {
    const error = new Error("PhonePe payment processing is currently disabled");
    error.statusCode = 503;
    throw error;
  }

  if (
    typeof orderReference !== "string" ||
    !/^SKS_[a-f0-9]{32}$/.test(orderReference)
  ) {
    const error = new Error("Invalid order reference");
    error.statusCode = 400;
    throw error;
  }

  const phonepeService = require("./phonepeService");

  const order = await paymentRepository.claimPaymentInitiation({
    userId,
    tenantId,
    orderReference,
  });

  try {
    const checkout = await phonepeService.createPayment({
      orderReference: order.orderReference,
      amountPaise: order.amountPaise,
    });

    await paymentRepository.updatePaymentInitiationStatus({
      paymentOrderId: order.paymentOrderId,
      status: "initiated",
    });

    return checkout;
  } catch (error) {
    // A timeout may mean PhonePe accepted the payment request.
    // Never automatically retry an ambiguous initiation.
    try {
      await paymentRepository.updatePaymentInitiationStatus({
        paymentOrderId: order.paymentOrderId,
        status: "initiation_unknown",
      });
    } catch (updateError) {
      console.error("Payment initiation status update failed:", updateError);
    }

    throw error;
  }
}

// Verify payment status directly with PhonePe.
// Does not grant book access.
async function verifyPhonePeCheckout({ userId, tenantId, orderReference }) {
  if (
    typeof orderReference !== "string" ||
    !/^SKS_[a-f0-9]{32}$/.test(orderReference)
  ) {
    const error = new Error("Invalid order reference");
    error.statusCode = 400;
    throw error;
  }

  const order = await paymentRepository.getCustomerPaymentOrder({
    userId,
    tenantId,
    orderReference,
  });

  if (order.provider_code !== "phonepe") {
    const error = new Error("Order does not belong to PhonePe");
    error.statusCode = 409;
    throw error;
  }

  // Never call the real gateway while credentials are placeholders.
  if (process.env.PHONEPE_PAYMENT_ENABLED !== "true") {
    return {
      orderReference,
      providerCode: "phonepe",
      paymentStatus: order.payment_status,
      settlementStatus: order.settlement_status,
      accessStatus: order.access_status,
      gatewayVerified: false,
      message: "PhonePe verification is disabled",
    };
  }

  const phonepeService = require("./phonepeService");

  const result = await phonepeService.verifyPayment({
    orderReference,
  });

  // Do not treat an unknown gateway state as successful.
  const gatewayState = String(result.gatewayState || "UNKNOWN").toUpperCase();

  return {
    orderReference,
    providerCode: "phonepe",
    gatewayState,
    gatewayVerified: true,
    recordedPaymentStatus: order.payment_status,
    settlementStatus: order.settlement_status,
    accessStatus: order.access_status,
    message: "Gateway status retrieved. Database reconciliation is pending.",
  };
}

async function reconcilePhonePeCheckout({ userId, tenantId, orderReference }) {
  if (
    typeof orderReference !== "string" ||
    !/^SKS_[a-f0-9]{32}$/.test(orderReference)
  ) {
    const error = new Error("Invalid order reference");
    error.statusCode = 400;
    throw error;
  }

  const order = await paymentRepository.getCustomerPaymentOrder({
    userId,
    tenantId,
    orderReference,
  });

  if (order.provider_code !== "phonepe") {
    const error = new Error("Order is not assigned to PhonePe");
    error.statusCode = 409;
    throw error;
  }

  if (process.env.PHONEPE_PAYMENT_ENABLED !== "true") {
    const error = new Error("PhonePe verification is currently disabled");
    error.statusCode = 503;
    throw error;
  }

  // TEST MODE SAFETY:
  // Prevent accidently reconcilling a production payment
  // while the integration is being developed.

  if (
    order.environment !== "test" ||
    process.env.PHONEPE_ENVIRONMENT !== "sandbox"
  ) {
    const error = new Error(
      "Only PhonePe sandbox payments are allowed during testing",
    );
    error.statusCode = 409;
    throw error;
  }

  const phonepeService = require("./phonepeService");

  // The payment state comes directly from PhonePe,
  // not from the frontend.
  const verification = await phonepeService.verifyPayment({
    orderReference,
  });

  const gatewayResponse = verification.gatewayResponse;

  console.log("PHONEPE_VERIFY_DIAGNOSTIC", {
    expectedOrderReference: orderReference,
    gatewayState: verification.gatewayState,
    responseKeys: Object.keys(gatewayResponse || {}),
    merchantOrderId: gatewayResponse?.merchantOrderId ?? null,
    orderId: gatewayResponse?.orderId ?? null,
    paymentDetailFields: Array.isArray(gatewayResponse?.paymentDetails)
      ? gatewayResponse.paymentDetails.map((item) => Object.keys(item || {}))
      : null,
  });

  if (!gatewayResponse || typeof gatewayResponse !== "object") {
    throw new Error("Invalid PhonePe verification response");
  }

  // Only accept a response explicitly tied to this order.
  // If the SDK response does not expose the merchant order ID,
  // do not finalize until the response contract is verified.
  // const verifiedOrderReference = gatewayResponse.merchantOrderId;

  // if (verifiedOrderReference !== orderReference) {
  //   return {
  //     orderReference,
  //     requiresReview: true,
  //     message: "Gateway order reference could not be verified",
  //     paymentStatus: order.payment_status,
  //     settlementStatus: order.settlement_status,
  //     accessStatus: order.access_status,
  //   };
  // }

  const responseMerchantOrderId = gatewayResponse.merchantOrderId;

  if (
    responseMerchantOrderId != null &&
    responseMerchantOrderId !== orderReference
  ) {
    return {
      orderReference,
      requiresReview: true,
      message: "Gateway merchant order reference mismatch",
      paymentStatus: order.payment_status,
      settlementStatus: order.settlement_status,
      accessStatus: order.access_status,
    };
  }

  if (
    typeof gatewayResponse.orderId !== "string" ||
    !gatewayResponse.orderId.trim()
  ) {
    return {
      orderReference,
      requiresReview: true,
      message: "PhonePe gateway order ID missing",
      paymentStatus: order.payment_status,
      settlementStatus: order.settlement_status,
      accessStatus: order.access_status,
    };
  }

  // const verifiedAmountPaise = Number(gatewayResponse.amount);

  const rawAmount = gatewayResponse.amount;

  const verifiedAmountPaise =
    typeof rawAmount === "number" &&
    Number.isSafeInteger(rawAmount) &&
    rawAmount > 0
      ? rawAmount
      : null;

  // Until the verified gateway transaction ID is captured
  // and uniquely stored, do not finalize a successful payment.
  // if (verification.gatewayState === "COMPLETED") {
  //   const error = new Error(
  //     "Payment confirmation pending secure transaction verification",
  //   );
  //   error.statusCode = 409;
  //   throw error;
  // }

  let verifiedTransactionId = null;

  if (verification.gatewayState === "COMPLETED") {
    const details = gatewayResponse.paymentDetails;

    if (!Array.isArray(details)) {
      const error = new Error("PhonePe payment details missing");
      error.statusCode = 409;
      throw error;
    }

    const completed = details.filter(
      (item) => String(item?.state || "").toUpperCase() === "COMPLETED",
    );

    if (
      completed.length !== 1 ||
      typeof completed[0].transactionId !== "string" ||
      !completed[0].transactionId.trim() ||
      completed[0].transactionId.length > 150 ||
      !Number.isSafeInteger(completed[0].amount) ||
      completed[0].amount !== verifiedAmountPaise
    ) {
      const error = new Error(
        "PhonePe transaction identity or amount requires review",
      );
      error.statusCode = 409;
      throw error;
    }

    verifiedTransactionId = completed[0].transactionId.trim();
  }

  return paymentRepository.reconcileVerifiedPayment({
    userId,
    tenantId,
    orderReference,
    gatewayState: verification.gatewayState,
    verifiedAmountPaise,
    verifiedTransactionId,
  });
}

// async function initiateCommonCheckout({ userId, tenantId, orderReference }) {
//   if (
//     typeof orderReference !== "string" ||
//     !/^SKS_[a-f0-9]{32}$/.test(orderReference)
//   ) {
//     const error = new Error("Invalid order reference");
//     error.statusCode = 400;
//     throw error;
//   }

//   // Retrieve the customer's existing payment order.
//   const order = await paymentRepository.getCustomerPaymentOrder({
//     userId,
//     tenantId,
//     orderReference,
//   });

//   // Use the gateway stored when the order was created.
//   // Do NOT use a provider supplied by the frontend.
//   const providerCode = order.provider_code;

//   if (order.payment_status !== "pending") {
//     const error = new Error("Payment order is no longer pending");
//     error.statusCode = 409;
//     throw error;
//   }

//   if (order.access_status !== "locked") {
//     const error = new Error("Payment order has an invalid access state");
//     error.statusCode = 409;
//     throw error;
//   }

//   // Currently supported checkout environment.
//   if (order.environment !== "test") {
//     const error = new Error("Live checkout is not enabled yet");
//     error.statusCode = 503;
//     throw error;
//   }

//   // Reserve initiation atomically to prevent
//   // duplicate payment creation.
//   //
//   // The existing repository function currently
//   // supports PhonePe only.
//   if (providerCode === "phonepe") {
//     await paymentRepository.claimPaymentInitiation({
//       userId,
//       tenantId,
//       orderReference,
//     });
//   } else {
//     const error = new Error("Mswipe checkout is not implemented yet");
//     error.statusCode = 503;
//     throw error;
//   }

//   try {
//     const result = await paymentGatewayEngine.initiateGatewayPayment({
//       providerCode,
//       orderReference,
//       amountPaise: Number(order.amount_paise),
//     });

//     await paymentRepository.updatePaymentInitiationStatus({
//       paymentOrderId: order.payment_order_id,
//       status: "initiated",
//     });

//     return {
//       success: true,
//       orderReference,
//       providerCode,
//       checkoutUrl: result.checkoutUrl,
//       paymentStatus: "pending",
//       settlementStatus: "pending",
//       accessStatus: "locked",
//     };
//   } catch (error) {
//     // The gateway may have accepted the request
//     // even if the network response was lost.
//     await paymentRepository.updatePaymentInitiationStatus({
//       paymentOrderId: order.payment_order_id,
//       status: "initiation_unknown",
//     });

//     throw error;
//   }
// }

async function initiateCommonCheckout({ userId, tenantId, orderReference }) {
  if (
    typeof orderReference !== "string" ||
    !/^SKS_[a-f0-9]{32}$/.test(orderReference)
  ) {
    const error = new Error("Invalid order reference");
    error.statusCode = 400;
    throw error;
  }

  const order = await paymentRepository.getCustomerPaymentOrder({
    userId,
    tenantId,
    orderReference,
  });

  if (order.payment_status !== "pending") {
    const error = new Error("Payment is not pending");
    error.statusCode = 409;
    throw error;
  }

  if (order.access_status !== "locked") {
    const error = new Error("Invalid access state");
    error.statusCode = 409;
    throw error;
  }

  if (order.environment !== "test") {
    const error = new Error("Live payments are not enabled");
    error.statusCode = 503;
    throw error;
  }

  const providerCode = order.provider_code;

  // if (providerCode === "mswipe") {
  //   const error = new Error("Mswipe checkout is not configured yet");
  //   error.statusCode = 503;
  //   throw error;
  // }

  // if (providerCode !== "phonepe") {
  //   const error = new Error("Unsupported payment gateway");
  //   error.statusCode = 409;
  //   throw error;
  // }

  if (!["phonepe", "mswipe"].includes(providerCode)) {
    const error = new Error("Unsupported payment gateway");
    error.statusCode = 409;
    throw error;
  }

  if (
    providerCode === "mswipe" &&
    process.env.MSWIPE_PAYMENT_ENABLED !== "true"
  ) {
    const error = new Error("Mswipe checkout is currently disabled");
    error.statusCode = 503;
    throw error;
  }

  // Check gateway configuration BEFORE claiming initiation.
  // Disabled configuration must not consume an order attempt.
  // if (process.env.PHONEPE_PAYMENT_ENABLED !== "true") {
  //   const error = new Error("PhonePe checkout is currently disabled");
  //   error.statusCode = 503;
  //   throw error;
  // }

  if (
    providerCode === "phonepe" &&
    process.env.PHONEPE_PAYMENT_ENABLED !== "true"
  ) {
    const error = new Error("PhonePe checkout is currently disabled");
    error.statusCode = 503;
    throw error;
  }

  const mswipeCustomer =
    providerCode === "mswipe"
      ? await paymentRepository.getMswipeCheckoutCustomer({
          userId,
          tenantId,
          orderReference,
        })
      : null;
  // This repository function atomically changes
  // transaction_status from created to initiating.
  const claimedOrder = await paymentRepository.claimPaymentInitiation({
    userId,
    tenantId,
    orderReference,
  });

  let checkout;

  try {
    checkout = await paymentGatewayEngine.initiateGatewayPayment({
      providerCode,
      orderReference: claimedOrder.orderReference,
      amountPaise: claimedOrder.amountPaise,
      customer: mswipeCustomer,
    });

    if (providerCode === "mswipe") {
      try {
        await paymentRepository.saveMswipePaymentReferences({
          paymentOrderId: claimedOrder.paymentOrderId,
          gatewayOrderId: checkout.gatewayReference,
          gatewayTransactionId: checkout.gatewayTransactionId,
        });
      } catch (error) {
        console.error("MSWIPE_REFERENCE_SAVE_FAILED", {
          orderReference: claimedOrder.orderReference,
          message: error.message,
        });

        const syncError = new Error(
          "Mswipe checkout was created but its references could not be saved. Manual reconciliation required.",
        );
        syncError.statusCode = 503;
        syncError.requiresReview = true;
        throw syncError;
      }
    }
  } catch (error) {
    // Gateway may have accepted the request.
    // Never automatically retry an ambiguous initiation.
    try {
      await paymentRepository.updatePaymentInitiationStatus({
        paymentOrderId: claimedOrder.paymentOrderId,
        status: "initiation_unknown",
      });
    } catch (updateError) {
      console.error(
        "Unable to update payment initiation:",
        updateError.message,
      );
    }

    throw error;
  }

  // await paymentRepository.updatePaymentInitiationStatus({
  //   paymentOrderId: claimedOrder.paymentOrderId,
  //   status: "initiated",
  // });

  // return {
  //   success: true,
  //   orderReference: claimedOrder.orderReference,
  //   providerCode,
  //   checkoutUrl: checkout.checkoutUrl,
  //   paymentStatus: "pending",
  //   settlementStatus: "pending",
  //   accessStatus: "locked",
  // };

  try {
    await paymentRepository.updatePaymentInitiationStatus({
      paymentOrderId: claimedOrder.paymentOrderId,
      status: "initiated",
    });
  } catch (error) {
    console.error("PAYMENT_INITIATION_DB_SYNC_FAILED", {
      paymentOrderId: claimedOrder.paymentOrderId,
      orderReference: claimedOrder.orderReference,
      providerCode,
      message: error.message,
    });

    const syncError = new Error(
      "Checkout was created, but payment status synchronization failed. Please check payment status before trying again.",
    );

    syncError.statusCode = 503;
    syncError.requiresReview = true;

    throw syncError;
  }

  return {
    success: true,
    orderReference: claimedOrder.orderReference,
    providerCode,
    checkoutUrl: checkout.checkoutUrl,
    paymentStatus: "pending",
    settlementStatus: "pending",
    accessStatus: "locked",
  };
}

async function recoverPhonePeInitiation({ userId, tenantId, orderReference }) {
  if (
    typeof orderReference !== "string" ||
    !/^SKS_[a-f0-9]{32}$/.test(orderReference)
  ) {
    const error = new Error("Invalid order reference");
    error.statusCode = 400;
    throw error;
  }

  const order = await paymentRepository.getPaymentInitiationRecoveryState({
    userId,
    tenantId,
    orderReference,
  });

  if (order.provider_code !== "phonepe") {
    const error = new Error("Order is not assigned to PhonePe");
    error.statusCode = 409;
    throw error;
  }

  if (order.environment !== "test") {
    const error = new Error("Recovery for this environment is not configured");
    error.statusCode = 503;
    throw error;
  }

  if (order.payment_status !== "pending") {
    return {
      orderReference,
      transactionStatus: order.transaction_status,
      paymentStatus: order.payment_status,
      settlementStatus: order.settlement_status,
      accessStatus: order.access_status,
      recoveryStatus: "already_finalized",
    };
  }

  const recoverableStates = ["initiating", "initiated", "initiation_unknown"];

  if (!recoverableStates.includes(order.transaction_status)) {
    return {
      orderReference,
      transactionStatus: order.transaction_status,
      paymentStatus: order.payment_status,
      recoveryStatus: "not_eligible",
    };
  }

  // if (process.env.PHONEPE_PAYMENT_ENABLED !== "true") {
  if (
    process.env.PHONEPE_PAYMENT_ENABLED !== "true" ||
    process.env.PHONEPE_ENVIRONMENT !== "sandbox"
  ) {
    const error = new Error(
      "PhonePe status verification is currently disabled",
    );
    error.statusCode = 503;
    throw error;
  }

  const phonepeService = require("./phonepeService");

  // Status inquiry only. This does NOT initiate another payment.
  const verification = await phonepeService.verifyPayment({
    orderReference,
  });

  const gatewayState = String(verification.gatewayState || "").toUpperCase();

  if (!["COMPLETED", "FAILED", "PENDING"].includes(gatewayState)) {
    return {
      orderReference,
      transactionStatus: order.transaction_status,
      recoveryStatus: "manual_review",
      message: "Unrecognized gateway payment state",
    };
  }

  // return {
  //   orderReference,
  //   transactionStatus: order.transaction_status,
  //   paymentStatus: order.payment_status,
  //   settlementStatus: order.settlement_status,
  //   accessStatus: order.access_status,
  //   gatewayState,
  //   recoveryStatus:
  //     gatewayState === "PENDING"
  //       ? "awaiting_gateway_result"
  //       : "verification_required",
  //   message:
  //     gatewayState === "PENDING"
  //       ? "Payment is not finalized. Do not initiate again."
  //       : "Gateway returned a terminal state. Reconciliation is required.",
  // };

  if (gatewayState === "COMPLETED" || gatewayState === "FAILED") {
    const result = await reconcilePhonePeCheckout({
      userId,
      tenantId,
      orderReference,
    });

    return {
      ...result,
      transactionStatus: order.transaction_status,
      gatewayState,
      recoveryStatus: result.requiresReview ? "manual_review" : "reconciled",
    };
  }

  return {
    orderReference,
    transactionStatus: order.transaction_status,
    paymentStatus: order.payment_status,
    settlementStatus: order.settlement_status,
    accessStatus: order.access_status,
    gatewayState,
    recoveryStatus: "awaiting_gateway_result",
    message: "Payment is not finalized. Do not initiate again.",
  };
}

module.exports = {
  getAvailableGateways,
  resolveGatewayService,
  getSelectedPaymentGateway,
  updateSelectedPaymentGateway,
  createCheckoutOrder,
  initiatePhonePeCheckout,
  verifyPhonePeCheckout,
  reconcilePhonePeCheckout,
  initiateCommonCheckout,
  recoverPhonePeInitiation,
};
