//Services/getewaySelector.js

// const phonepeService = require("../Services/phonepeService")
// const mswipeService = require("../Services/mswipeService")

const {
  getAvailableGateways,
  createCheckoutOrder,
  initiatePhonePeCheckout,
  verifyPhonePeCheckout,
  reconcilePhonePeCheckout,
  initiateCommonCheckout,
  recoverPhonePeInitiation,
  reconcileCommonCheckout,
  recoverCommonInitiation,
  verifyCommonCheckout,
} = require("../Services/paymentServices");

// const GATEWAYS = Object.freeze({
//   phonepe: phonepeService,
//   mswipe: mswipeService,
// });

// Controller/paymentController.js

// GET /api/payments/health

// const paymentHealth = (req, res) => {
//   return res.status(200).json({
//     success: true,
//     message: "SKS Dream Payment Engine is running",
//     paymentProcessingEnabled: false,
//   });
// };

// function getGeteway(providerCode) {
//   if (typeof providerCode !== "string"){
//     throw new Error("Invalid getway code");
//   }

//   const code = providerCode.trim().toLowerCase();

//   if (!Object.prototype.hasOwnProperty.call(GATEWAYS, code)) {
//     throw new Error("Unsupported payment geteway");
//   }

//   return GATEWAYS[code];
// }

// function getSupportedGateways() {
//   return Object.keys(GATEWAYS);
// }

// Get available payment gateways
// const getPaymentProviders = async (req, res) => {
//   try {
//     const environment = "test";

//     const gateways = await getAvailableGateways(environment);

//     return res.status(200).json({
//       success: true,
//       environment,
//       gateways,
//       paymentProcessingEnabled: false,
//     });

//   } catch (error) {
//     console.error("Payment gateway error:", error.message);

//     return res.status(500).json({
//       success: false,
//       message: "Unable to retrieve payment gateways",
//     });
//   }
// };

// Controller/paymentController.js

// GET /api/payments/health
const paymentHealth = (req, res) => {
  return res.status(200).json({
    success: true,
    message: "SKS Dream Payment Engine is running",
    paymentProcessingEnabled: false,
  });
};

// GET /api/payments/providers
const getPaymentProviders = async (req, res) => {
  try {
    const gateways = await getAvailableGateways("test");

    return res.status(200).json({
      success: true,
      environment: "test",
      gateways,
      paymentProcessingEnabled: false,
    });
  } catch (error) {
    console.error("Payment providers error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve payment gateways",
    });
  }
};

// POST /api/payments/orders
const createPaymentOrder = async (req, res) => {
  try {
    const { productId, idempotencyKey } = req.body || {};

    const parsedProductId = Number(productId);

    if (!Number.isSafeInteger(parsedProductId) || parsedProductId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid productId is required",
      });
    }

    if (
      typeof idempotencyKey !== "string" ||
      !/^[a-zA-Z0-9_-]{16,100}$/.test(idempotencyKey)
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid idempotencyKey is required",
      });
    }

    const result = await createCheckoutOrder({
      userId: Number(req.user.userId),
      tenantId: Number(req.user.tenantId),
      productId: parsedProductId,
      idempotencyKey,
      environment: "test",
    });

    return res.status(result.reused ? 200 : 201).json({
      success: true,
      message: result.reused
        ? "Existing payment order returned"
        : "Payment order created successfully",
      reused: result.reused,
      order: result.order,
      paymentProcessingEnabled: false,
    });
  } catch (error) {
    console.error("Create payment order error:", error);

    if (error.statusCode === 409) {
      return res.status(409).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Unable to create payment order",
    });
  }
};

async function initiatePayment(req, res) {
  try {
    const userId = Number(req.user.userId);
    const tenantId = Number(req.user.tenantId);

    const { orderReference } = req.body || {};

    const result = await initiatePhonePeCheckout({
      userId,
      tenantId,
      orderReference,
    });

    return res.status(200).json({
      success: true,
      message: "PhonePe checkout initiated",
      checkout: result,
    });
  } catch (error) {
    console.error("Payment initiation error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Unable to initiate payment. Check payment status before retrying.",
    });
  }
}

async function verifyPaymentStatus(req, res) {
  try {
    const { orderReference } = req.params;

    // const result = await verifyPhonePeCheckout({
    const result = await verifyCommonCheckout({
      userId: Number(req.user.userId),
      tenantId: Number(req.user.tenantId),
      orderReference,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Payment verification error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Unable to verify payment status",
    });
  }
}

async function reconcilePaymentStatus(req, res) {
  try {
    const { orderReference } = req.params;

    // const result = await reconcilePhonePeCheckout({
    const result = await reconcileCommonCheckout({
      userId: Number(req.user.userId),
      tenantId: Number(req.user.tenantId),
      orderReference,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Payment reconciliation error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Payment reconciliation could not be completed",
    });
  }
}

async function initiateCommonPayment(req, res) {
  try {
    const { orderReference } = req.body;

    const result = await initiateCommonCheckout({
      userId: Number(req.user.userId),
      tenantId: Number(req.user.tenantId),
      orderReference,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("Common checkout error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Unable to initiate payment",
    });
  }
}

async function recoverPaymentInitiation(req, res) {
  try {
    const { orderReference } = req.params;

    // const result = await recoverPhonePeInitiation({
    const result = await recoverCommonInitiation({
      userId: Number(req.user.userId),
      tenantId: Number(req.user.tenantId),
      orderReference,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Payment recovery error:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Unable to check payment recovery status",
    });
  }
}

module.exports = {
  paymentHealth,
  getPaymentProviders,
  createPaymentOrder,
  initiatePayment,
  verifyPaymentStatus,
  reconcilePaymentStatus,
  initiateCommonPayment,
  recoverPaymentInitiation,
};
