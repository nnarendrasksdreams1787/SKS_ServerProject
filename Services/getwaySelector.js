const phonepeService = require("./phonepeService");

const mswipeService = require("./mswipeService");

const GATEWAYS = Object.freeze({
  phonepe: phonepeService,
  mswipe: mswipeService,
});

// Get getway service

function getGateway(providerCode) {
  if (typeof providerCode !== "string") {
    throw new Error("Invalid payment gateway.");
  }

  const code = providerCode.trim().toLowerCase();

  if (!Object.prototype.hasOwnProperty.call(GATEWAYS, code)) {
    throw new Error("Unsupported payment gateway.");
  }

  return GATEWAYS[code];
}

// Temporary development configuration.
// Production mein database repository se replace hoga.

// const paymentSettings = {
//   selectedGateway: "phonepe",

//   gateways: {
//     phonepe: {
//       enabled: true,
//       configured: false,
//     },

//     mswipe: {
//       enabled: true,
//       configured: false,
//     },
//   },
// };

// // Get current gateway configuration
// function getPaymentSettings() {
//   return {
//     selectedGateway: paymentSettings.selectedGateway,

//     gateways: Object.fromEntries(
//       Object.entries(paymentSettings.gateways).map(([code, settings]) => [
//         code,
//         { ...settings },
//       ]),
//     ),
//   };
// }

// // Select gateway (internal use only)
// function selectPaymentGateway(providerCode) {
//   const code = String(providerCode || "")
//     .trim()
//     .toLowerCase();

//   if (!getSupportedGateways().includes(code)) {
//     throw new Error("Unsupported payment gateway");
//   }

//   if (!paymentSettings.gateways[code].enabled) {
//     throw new Error("Payment gateway is disabled");
//   }

//   paymentSettings.selectedGateway = code;

//   return getPaymentSettings();
// }

// // Get selected gateway service
// function getSelectedGatewayService() {
//   const code = paymentSettings.selectedGateway;

//   const settings = paymentSettings.gateways[code];

//   if (!settings || !settings.enabled) {
//     throw new Error("Selected gateway is unavailable");
//   }

//   if (!settings.configured) {
//     throw new Error("Selected payment gateway is not configured");
//   }

//   return getGateway(code);
// }

function getSupportedGateways() {
  return Object.keys(GATEWAYS);
}

module.exports = {
  getGateway,
  getSupportedGateways,
};
