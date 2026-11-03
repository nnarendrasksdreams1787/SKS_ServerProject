// const pool = require("../DB/db");
// const paymentRepository = require("./paymentRepository");
// const paymentServices = require("./paymentServices");

// const BATCH_SIZE = 10;
// const INTERVAL_MS = 30000;

// let timer = null;
// let running = false;

// // Extract a candidate order reference.
// // This is NOT proof that a payment succeeded.
// function extractOrderReference(rawPayload) {
//   const event = JSON.parse(rawPayload);

//   const candidates = [
//     event?.payload?.merchantOrderId,
//     event?.payload?.originalMerchantOrderId,
//     event?.payload?.orderId,
//     event?.merchantOrderId,
//   ];

//   return (
//     candidates.find(
//       (value) =>
//         typeof value === "string" &&
//         /^SKS_[a-f0-9]{32}$/.test(value)
//     ) || null
//   );
// }

// async function claimEvent(eventId) {
//   const [result] = await pool.execute(
//     `
//     UPDATE payment_webhook_events
//     SET processing_status = 'processing'
//     WHERE event_id = ?
//       AND provider_code = 'phonepe'
//       AND processing_status = 'pending'
//     `,
//     [eventId]
//   );

//   return result.affectedRows === 1;
// }

// async function setEventStatus(eventId, status) {
//   if (!["pending", "processed", "review"].includes(status)) {
//     throw new Error("Invalid webhook processing status");
//   }

//   await pool.execute(
//     `
//     UPDATE payment_webhook_events
//     SET processing_status = ?
//     WHERE event_id = ?
//       AND provider_code = 'phonepe'
//       AND processing_status = 'processing'
//     `,
//     [status, eventId]
//   );
// }

// async function processEvent(event) {
//   const claimed = await claimEvent(event.event_id);

//   if (!claimed) return;

//   try {
//     const orderReference = extractOrderReference(event.payload);

//     if (!orderReference) {
//       // Do not guess which customer/order the callback belongs to.
//       await setEventStatus(event.event_id, "review");
//       return;
//     }

//     const [orders] = await pool.execute(
//       `
//       SELECT
//         payment_order_id,
//         tenant_id,
//         user_id,
//         provider_code,
//         environment
//       FROM payment_orders
//       WHERE order_reference = ?
//       LIMIT 1
//       `,
//       [orderReference]
//     );

//     if (
//       orders.length !== 1 ||
//       orders[0].provider_code !== "phonepe" ||
//       orders[0].environment !== "test"
//     ) {
//       await setEventStatus(event.event_id, "review");
//       return;
//     }

//     const order = orders[0];

//     // This function must independently query PhonePe.
//     // The webhook payload is never used as payment proof.
//     const result = await paymentServices.reconcilePhonePeCheckout({
//       userId: Number(order.user_id),
//       tenantId: Number(order.tenant_id),
//       orderReference,
//     });

//     if (result.requiresReview) {
//       await setEventStatus(event.event_id, "review");
//       return;
//     }

//     if (
//       result.paymentStatus === "success" ||
//       result.paymentStatus === "failed"
//     ) {
//       await setEventStatus(event.event_id, "processed");
//       return;
//     }

//     // PhonePe still reports a non-terminal state.
//     // Keep event pending for a later verification attempt.
//     await setEventStatus(event.event_id, "pending");
//   } catch (error) {
//     console.error("PhonePe webhook worker error:", {
//       eventId: event.event_id,
//       message: error.message,
//     });

//     // Retry later; do not invent a successful payment.
//     try {
//       await setEventStatus(event.event_id, "pending");
//     } catch (statusError) {
//       console.error(
//         "Unable to reset webhook event:",
//         statusError.message
//       );
//     }
//   }
// }

// async function runPhonePeWebhookWorker() {
//   if (running) return;

//   if (process.env.PHONEPE_PAYMENT_ENABLED !== "true") {
//     return;
//   }

//   running = true;

//   try {
//     const [events] = await pool.execute(
//       `
//       SELECT event_id, payload
//       FROM payment_webhook_events
//       WHERE provider_code = 'phonepe'
//         AND processing_status = 'pending'
//       ORDER BY event_id ASC
//       LIMIT ?
//       `,
//       [BATCH_SIZE]
//     );

//     for (const event of events) {
//       await processEvent(event);
//     }
//   } catch (error) {
//     console.error(
//       "PhonePe webhook worker failed:",
//       error.message
//     );
//   } finally {
//     running = false;
//   }
// }

// function startPhonePeWebhookWorker() {
//   if (timer) return;

//   timer = setInterval(() => {
//     runPhonePeWebhookWorker().catch((error) => {
//       console.error("Webhook worker error:", error.message);
//     });
//   }, INTERVAL_MS);

//   timer.unref?.();

//   console.log("PhonePe webhook worker scheduled");
// }

// function stopPhonePeWebhookWorker() {
//   if (timer) {
//     clearInterval(timer);
//     timer = null;
//   }
// }

// module.exports = {
//   runPhonePeWebhookWorker,
//   startPhonePeWebhookWorker,
//   stopPhonePeWebhookWorker,
// };



const pool = require("../DB/db");
const paymentServices = require("./paymentServices");

const BATCH_SIZE = 10;
const INTERVAL_MS = 30000;
const MAX_ATTEMPTS = 5;
const LEASE_TIMEOUT_MINUTES = 5;

let timer = null;
let running = false;

function extractOrderReference(rawPayload) {
  const event = JSON.parse(rawPayload);

  const candidates = [
    event?.payload?.merchantOrderId,
    event?.payload?.originalMerchantOrderId,
    event?.payload?.orderId,
    event?.merchantOrderId,
  ];

  return (
    candidates.find(
      (value) =>
        typeof value === "string" &&
        /^SKS_[a-f0-9]{32}$/.test(value)
    ) || null
  );
}

// Recover events abandoned by a crashed worker.
async function recoverStuckEvents() {
  await pool.execute(
    `
    UPDATE payment_webhook_events
    SET
      processing_status = CASE
        WHEN attempt_count >= ?
          THEN 'failed'
        ELSE 'pending'
      END,
      processing_started_at = NULL,
      next_attempt_at = CASE
        WHEN attempt_count >= ?
          THEN NULL
        ELSE DATE_ADD(NOW(), INTERVAL 60 SECOND)
      END,
      last_error = 'Worker lease expired'
    WHERE provider_code = 'phonepe'
      AND processing_status = 'processing'
      AND processing_started_at <
          DATE_SUB(NOW(), INTERVAL ? MINUTE)
    `,
    [
      MAX_ATTEMPTS,
      MAX_ATTEMPTS,
      LEASE_TIMEOUT_MINUTES,
    ]
  );
}

// Atomic claim prevents two workers claiming
// the same pending event.
async function claimEvent(eventId) {
  const [result] = await pool.execute(
    `
    UPDATE payment_webhook_events
    SET
      processing_status = 'processing',
      processing_started_at = NOW(),
      attempt_count = attempt_count + 1,
      last_error = NULL
    WHERE event_id = ?
      AND provider_code = 'phonepe'
      AND processing_status = 'pending'
      AND attempt_count < ?
      AND (
        next_attempt_at IS NULL
        OR next_attempt_at <= NOW()
      )
    `,
    [eventId, MAX_ATTEMPTS]
  );

  return result.affectedRows === 1;
}

async function finishEvent(eventId, status, errorMessage = null) {
  if (!["processed", "review"].includes(status)) {
    throw new Error("Invalid final event status");
  }

  await pool.execute(
    `
    UPDATE payment_webhook_events
    SET
      processing_status = ?,
      processing_started_at = NULL,
      next_attempt_at = NULL,
      last_error = ?
    WHERE event_id = ?
      AND provider_code = 'phonepe'
      AND processing_status = 'processing'
    `,
    [status, errorMessage, eventId]
  );
}

async function retryEvent(eventId, errorMessage) {
  const [rows] = await pool.execute(
    `
    SELECT attempt_count
    FROM payment_webhook_events
    WHERE event_id = ?
      AND provider_code = 'phonepe'
      AND processing_status = 'processing'
    LIMIT 1
    `,
    [eventId]
  );

  if (!rows.length) return;

  const attempts = Number(rows[0].attempt_count);

  const nextStatus =
    attempts >= MAX_ATTEMPTS ? "failed" : "pending";

  // Exponential backoff:
  // 60s, 120s, 240s, 480s...
  const delaySeconds = Math.min(
    60 * Math.pow(2, Math.max(0, attempts - 1)),
    3600
  );

  await pool.execute(
    `
    UPDATE payment_webhook_events
    SET
      processing_status = ?,
      processing_started_at = NULL,
      next_attempt_at = CASE
        WHEN ? = 'failed'
          THEN NULL
        ELSE DATE_ADD(NOW(), INTERVAL ? SECOND)
      END,
      last_error = ?
    WHERE event_id = ?
      AND provider_code = 'phonepe'
      AND processing_status = 'processing'
    `,
    [
      nextStatus,
      nextStatus,
      delaySeconds,
      String(errorMessage || "Unknown error").slice(0, 500),
      eventId,
    ]
  );
}

async function processEvent(event) {
  const claimed = await claimEvent(event.event_id);

  if (!claimed) return;

  try {
    const orderReference = extractOrderReference(event.payload);

    if (!orderReference) {
      await finishEvent(
        event.event_id,
        "review",
        "Valid order reference not found"
      );
      return;
    }

    const [orders] = await pool.execute(
      `
      SELECT
        payment_order_id,
        tenant_id,
        user_id,
        provider_code,
        environment
      FROM payment_orders
      WHERE order_reference = ?
      LIMIT 1
      `,
      [orderReference]
    );

    if (
      orders.length !== 1 ||
      orders[0].provider_code !== "phonepe" ||
      orders[0].environment !== "test"
    ) {
      await finishEvent(
        event.event_id,
        "review",
        "Order or gateway environment mismatch"
      );
      return;
    }

    const order = orders[0];

    // Verify directly with PhonePe.
    // Never trust webhook payment state as proof.
    const result =
      await paymentServices.reconcilePhonePeCheckout({
        userId: Number(order.user_id),
        tenantId: Number(order.tenant_id),
        orderReference,
      });

    if (result.requiresReview) {
      await finishEvent(
        event.event_id,
        "review",
        result.message || "Manual review required"
      );
      return;
    }

    if (
      result.paymentStatus === "success" ||
      result.paymentStatus === "failed"
    ) {
      await finishEvent(event.event_id, "processed");
      return;
    }

    await retryEvent(
      event.event_id,
      "Gateway payment status is not final"
    );
  } catch (error) {
    console.error("PhonePe webhook processing error:", {
      eventId: event.event_id,
      message: error.message,
    });

    await retryEvent(event.event_id, error.message);
  }
}

async function runPhonePeWebhookWorker() {
  if (running) return;

  if (process.env.PHONEPE_PAYMENT_ENABLED !== "true") {
    return;
  }

  running = true;

  try {
    await recoverStuckEvents();

    const [events] = await pool.execute(
      `
      SELECT event_id, payload
      FROM payment_webhook_events
      WHERE provider_code = 'phonepe'
        AND processing_status = 'pending'
        AND attempt_count < ?
        AND (
          next_attempt_at IS NULL
          OR next_attempt_at <= NOW()
        )
      ORDER BY event_id ASC
      LIMIT ${BATCH_SIZE}
      `,
      [MAX_ATTEMPTS]
    );

    for (const event of events) {
      await processEvent(event);
    }
  } catch (error) {
    console.error(
      "PhonePe webhook worker failed:",
      error.message
    );
  } finally {
    running = false;
  }
}

function startPhonePeWebhookWorker() {
  if (timer) return;

  timer = setInterval(() => {
    runPhonePeWebhookWorker().catch((error) => {
      console.error(
        "PhonePe worker interval error:",
        error.message
      );
    });
  }, INTERVAL_MS);

  timer.unref?.();

  console.log("PhonePe webhook worker scheduled");
}

function stopPhonePeWebhookWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  runPhonePeWebhookWorker,
  startPhonePeWebhookWorker,
  stopPhonePeWebhookWorker,
};
