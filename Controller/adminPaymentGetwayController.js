const pool = require("../DB/db");

const {
  getSelectedPaymentGateway,
  updateSelectedPaymentGateway,
} = require("../Services/paymentServices");

const mswipeService = require("../Services/mswipeService");
const phonepeService = require("../Services/phonepeService");

const { getGatewayReadiness } = require("../Services/paymentGatewayReadiness");

const TENANT_ID = 1;

// GET /api/admin/payment-gateways
exports.getPaymentGateways = async (req, res) => {
  try {
    const [providers] = await pool.execute(
      `SELECT
          p.provider_id,
          p.provider_code, 
          p.provider_name,
          p.status AS provider_status,
          p.is_default,
          c.gateway_config_id,
          c.environment,
          c.merchant_id,
          c.is_enabled,
          c.config_json,
          CASE
            WHEN p.provider_code = 'cod' THEN 1
            WHEN c.merchant_id IS NOT NULL
                 AND c.credential_ciphertext IS NOT NULL
                 AND c.webhook_secret_ciphertext IS NOT NULL
              THEN 1
            ELSE 0
          END AS is_configured
       FROM payment_gateway_providers p
       LEFT JOIN payment_gateway_configs c
         ON c.provider_id = p.provider_id
        AND c.tenant_id = p.tenant_id
       WHERE p.tenant_id = ?
       ORDER BY p.provider_id ASC, c.environment ASC`,
      [TENANT_ID],
    );

    const [summaryRows] = await pool.execute(
      `SELECT
          COUNT(DISTINCT p.provider_id) AS total_gateways,
          COUNT(DISTINCT CASE
            WHEN c.is_enabled = 1 AND p.status = 'active'
            THEN p.provider_id
          END) AS enabled_gateways,
          COUNT(DISTINCT CASE
            WHEN p.provider_code = 'cod'
              OR (
                c.merchant_id IS NOT NULL
                AND c.credential_ciphertext IS NOT NULL
                AND c.webhook_secret_ciphertext IS NOT NULL
              )
            THEN p.provider_id
          END) AS configured_gateways
       FROM payment_gateway_providers p
       LEFT JOIN payment_gateway_configs c
         ON c.provider_id = p.provider_id
        AND c.tenant_id = p.tenant_id
       WHERE p.tenant_id = ?`,
      [TENANT_ID],
    );

    const summary = summaryRows[0];

    return res.json({
      summary: {
        totalGateways: Number(summary.total_gateways),
        enabledGateways: Number(summary.enabled_gateways),
        configuredGateways: Number(summary.configured_gateways),
      },
      // gateways: providers.map((provider) => ({
      //   ...provider,
      //   is_default: Boolean(provider.is_default),
      //   is_enabled: Boolean(provider.is_enabled),
      //   is_configured: Boolean(provider.is_configured),
      //   config_json: provider.config_json
      //     ? JSON.parse(provider.config_json)
      //     : {},
      // })),

      gateways: providers.map((provider) => {
        const readiness = getGatewayReadiness(
          provider.provider_code,
          provider.environment,
        );

        return {
          provider_id: provider.provider_id,
          provider_code: provider.provider_code,
          provider_name: provider.provider_name,
          provider_status: provider.provider_status,
          is_default: Boolean(provider.is_default),
          gateway_config_id: provider.gateway_config_id,
          environment: provider.environment,
          is_enabled: Boolean(provider.is_enabled),
          is_configured: readiness.configured,
          payment_ready: readiness.ready,
        };
      }),
    });
  } catch (error) {
    console.error("Payment Gateway API error:", error.message);
    return res.status(500).json({
      message: "Unable to load payment gateway settings.",
    });
  }
};

const ALLOWED_PROVIDER_STATUSES = ["active", "inactive", "maintenance"];

// PATCH /api/admin/payment-gateways/:providerId/status
exports.updateProviderStatus = async (req, res) => {
  const providerId = Number(req.params.providerId);
  const { status } = req.body;

  if (!Number.isSafeInteger(providerId) || providerId < 1) {
    return res.status(400).json({
      message: "Invalid provider ID.",
    });
  }

  if (!ALLOWED_PROVIDER_STATUSES.includes(status)) {
    return res.status(400).json({
      message: "Status must be active, inactive, or maintenance.",
    });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE payment_gateway_providers
       SET status = ?
       WHERE tenant_id = ? AND provider_id = ?`,
      [status, TENANT_ID, providerId],
    );

    if (result.affectedRows === 0) {
      const [rows] = await pool.execute(
        `SELECT provider_id, status
         FROM payment_gateway_providers
         WHERE tenant_id = ? AND provider_id = ?`,
        [TENANT_ID, providerId],
      );

      if (!rows.length) {
        return res.status(404).json({
          message: "Payment provider not found.",
        });
      }
    }

    const [rows] = await pool.execute(
      `SELECT provider_id, provider_code, provider_name, status
       FROM payment_gateway_providers
       WHERE tenant_id = ? AND provider_id = ?`,
      [TENANT_ID, providerId],
    );

    return res.json({
      message: "Provider status updated successfully.",
      provider: rows[0],
    });
  } catch (error) {
    console.error("Provider status update error:", error.message);

    return res.status(500).json({
      message: "Unable to update provider status.",
    });
  }
};

// PATCH /api/admin/payment-gateways/:providerId/enabled
exports.updateGatewayEnabled = async (req, res) => {
  const providerId = Number(req.params.providerId);
  const { enabled, environment = "test" } = req.body;

  if (!Number.isSafeInteger(providerId) || providerId < 1) {
    return res.status(400).json({
      message: "Invalid provider ID.",
    });
  }

  if (typeof enabled !== "boolean") {
    return res.status(400).json({
      message: "Enabled must be true or false.",
    });
  }

  if (!["test", "live"].includes(environment)) {
    return res.status(400).json({
      message: "Environment must be test or live.",
    });
  }

  try {
    const [providers] = await pool.execute(
      `SELECT provider_id, provider_code, status
       FROM payment_gateway_providers
       WHERE tenant_id = ? AND provider_id = ?`,
      [TENANT_ID, providerId],
    );

    if (!providers.length) {
      return res.status(404).json({
        message: "Payment provider not found.",
      });
    }

    const provider = providers[0];

    if (enabled && provider.status !== "active") {
      return res.status(409).json({
        message: "Activate the provider before enabling its configuration.",
      });
    }

    // COD does not require online gateway credentials.
    // Other providers must be configured securely before enabling.
    // if (enabled && provider.provider_code !== "cod") {
    //   return res.status(409).json({
    //     message:
    //       "This provider cannot be enabled until secure credential configuration and validation are implemented.",
    //   });
    // }

    if (enabled) {
      const readiness = getGatewayReadiness(
        provider.provider_code,
        environment,
      );

      if (!readiness.configured) {
        return res.status(409).json({
          success: false,
          message: readiness.reason || "Gateway configuration incomplete",
        });
      }

      if (provider.provider_code === "mswipe" && !readiness.ready) {
        return res.status(409).json({
          success: false,
          message: "Mswipe payment processing is disabled pending UAT",
        });
      }
    }

    const [existing] = await pool.execute(
      `SELECT gateway_config_id
       FROM payment_gateway_configs
       WHERE tenant_id = ? AND provider_id = ? AND environment = ?`,
      [TENANT_ID, providerId, environment],
    );

    if (!existing.length) {
      if (!enabled) {
        return res.json({
          message: "Provider is already disabled for this environment.",
          provider_id: providerId,
          environment,
          is_enabled: false,
        });
      }

      await pool.execute(
        `INSERT INTO payment_gateway_configs
          (tenant_id, provider_id, environment, is_enabled)
         VALUES (?, ?, ?, 1)`,
        [TENANT_ID, providerId, environment],
      );
    } else {
      await pool.execute(
        `UPDATE payment_gateway_configs
         SET is_enabled = ?
         WHERE tenant_id = ? AND provider_id = ?
           AND environment = ?`,
        [enabled ? 1 : 0, TENANT_ID, providerId, environment],
      );
    }

    return res.json({
      message: "Payment configuration status updated successfully.",
      provider_id: providerId,
      environment,
      is_enabled: enabled,
    });
  } catch (error) {
    console.error("Gateway enable update error:", error.message);

    return res.status(500).json({
      message: "Unable to update payment configuration status.",
    });
  }
};

// GET /api/admin/payment-getways/seleced

// exports.getSelectedGateway = async (req, res) => {
//   try {

//     const environment = req.query.environment || "test";

//     const seleced = await getSelectedPaymentGateway(environment);

//     return res.status(200).json({
//       success: true,
//       selectedGetway: seleced,
//     })
//   } catch (error) {
//     console.error("Get selected getway error: ", error.message);

//     return res.status(500).json({
//       success: false,
//       message: "Unable to retrieve selected geteway",
//     })
//   }
// }

// GET /api/admin/payment-gateways/selected

exports.getSelectedGateway = async (req, res) => {
  try {
    const environment = req.query.environment || "test";

    if (!["test", "live"].includes(environment)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment environment",
      });
    }

    const selected = await getSelectedPaymentGateway(environment);

    return res.status(200).json({
      success: true,
      selectedGateway: selected,
    });
  } catch (error) {
    console.error("Get selected gateway error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve selected gateway",
    });
  }
};

// PATHC /api/admin/payment-getways/selected

// exports.updateSelectedGateway = async (req, res) => {
//   try {
//     const { providerCode, environment = "test" } = req.body;

//     if (!["phonepe", "mswipe"].includes(providerCode)) {
//       return res.status(400).json({
//         success: false,
//         message: "Selected phonepe or mswipe",
//       });
//     }

//     if (!["test", "live"].includes(environment)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid payment environment",
//       });
//     }

//     const result = await updateSelectedPaymentGetway(providerCode, environment);

//     return res.status(200).json(result);
//   } catch (error) {
//     console.error("Update selected getways error: ", error.message);

//     return res.status(409).json({
//       success: false,
//       message: "Update to select payment geteway",
//     });
//   }
// };

// PATCH /api/admin/payment-gateways/selected

exports.updateSelectedGateway = async (req, res) => {
  try {
    const { providerCode, environment = "test" } = req.body;

    if (!["phonepe", "mswipe"].includes(providerCode)) {
      return res.status(400).json({
        success: false,
        message: "Select phonepe or mswipe",
      });
    }

    if (!["test", "live"].includes(environment)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment environment",
      });
    }

    const result = await updateSelectedPaymentGateway(
      providerCode,
      environment,
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error("Update selected gateway error:", error.message);

    return res.status(409).json({
      success: false,
      message: "Unable to select payment gateway",
    });
  }
};
