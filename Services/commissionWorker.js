const pool = require("../DB/db");
const { processOrderCommissions } = require("./settlementService");

const TENANT_ID = 1;
const INTERVAL_MS = 60_000;
const BATCH_SIZE = 20;

let running = false;
let timer = null;

async function runCommissionBatch() {
  if (running) return;
  running = true;

  try {
    // Only new-style paid orders with saved purchase-time snapshots.
    // Never automatically backfill historical NULL-snapshot orders.
    // const [orders] = await pool.execute(
    //   `SELECT DISTINCT o.order_id
    //    FROM orders o
    //    JOIN payments p
    //      ON p.tenant_id = o.tenant_id
    //     AND p.order_id = o.order_id
    //    JOIN order_items oi
    //      ON oi.tenant_id = o.tenant_id
    //     AND oi.order_id = o.order_id
    //    WHERE o.tenant_id = ?
    //      AND o.status = 'paid'
    //      AND o.payment_environment IS NOT NULL
    //      AND p.status = 'success'
    //      AND p.gateway_txn_id IS NOT NULL
    //      AND oi.commission_rules_snapshot IS NOT NULL
    //      AND oi.sponsor_chain_snapshot IS NOT NULL
    //      AND JSON_LENGTH(oi.commission_rules_snapshot) > 0
    //      AND JSON_LENGTH(oi.sponsor_chain_snapshot) > 0

    //      AND EXISTS (
    //       SELECT 1
    //       FROM JSON_TABLE(
    //         oi.commission_rules_snapshot,
    //         '$[*]' COLUMNS (
    //           rule_level INT PATH '$.level'
    //         )
    //       ) AS rules
    //       WHERE rules.rule_level <= JSON_LENGTH(oi.sponsor_chain_snapshot)
    //         AND NOT EXISTS (
    //           SELECT 1
    //           FROM commissions c
    //           WHERE c.tenant_id = oi.tenant_id
    //             AND c.order_item_id = oi.order_item_id
    //             AND c.level = rules.rule_level
    //         )
    //     )
    //    ORDER BY o.order_id
    //    LIMIT ${BATCH_SIZE}`,
    //   [TENANT_ID],
    // );

    const [candidates] = await pool.execute(
      `SELECT
      o.order_id,
      oi.order_item_id,
      oi.commission_rules_snapshot,
      oi.sponsor_chain_snapshot
   FROM orders o
   JOIN payments p
     ON p.tenant_id = o.tenant_id
    AND p.order_id = o.order_id
   JOIN order_items oi
     ON oi.tenant_id = o.tenant_id
    AND oi.order_id = o.order_id
   WHERE o.tenant_id = ?
     AND o.status = 'paid'
     AND o.payment_environment IS NOT NULL
     AND p.status = 'success'
     AND p.gateway_txn_id IS NOT NULL
     AND oi.commission_rules_snapshot IS NOT NULL
     AND oi.sponsor_chain_snapshot IS NOT NULL
   ORDER BY o.order_id ASC, oi.order_item_id ASC`,
      [TENANT_ID],
    );

    const [existingRows] = await pool.execute(
      `SELECT c.order_item_id, c.level
   FROM commissions c
   JOIN order_items oi
     ON oi.tenant_id = c.tenant_id
    AND oi.order_item_id = c.order_item_id
   JOIN orders o
     ON o.tenant_id = oi.tenant_id
    AND o.order_id = oi.order_id
   WHERE o.tenant_id = ?
     AND o.status = 'paid'
     AND oi.commission_rules_snapshot IS NOT NULL`,
      [TENANT_ID],
    );

    const existing = new Set(
      existingRows.map((row) => `${row.order_item_id}:${row.level}`),
    );

    const pendingOrderIds = new Set();

    for (const item of candidates) {
      let rules;
      let chain;

      try {
        rules =
          typeof item.commission_rules_snapshot === "string"
            ? JSON.parse(item.commission_rules_snapshot)
            : item.commission_rules_snapshot;

        chain =
          typeof item.sponsor_chain_snapshot === "string"
            ? JSON.parse(item.sponsor_chain_snapshot)
            : item.sponsor_chain_snapshot;
      } catch {
        console.error("COMMISSION_WORKER_INVALID_SNAPSHOT", {
          orderId: item.order_id,
        });
        continue;
      }

      if (!Array.isArray(rules) || !Array.isArray(chain)) {
        console.error("COMMISSION_WORKER_INVALID_SNAPSHOT", {
          orderId: item.order_id,
        });
        continue;
      }

      const hasMissingLevel = rules.some((rule) => {
        const level = Number(rule.level);

        return (
          Number.isInteger(level) &&
          level >= 1 &&
          level <= chain.length &&
          !existing.has(`${item.order_item_id}:${level}`)
        );
      });

      if (hasMissingLevel) {
        pendingOrderIds.add(item.order_id);
      }
    }

    const orders = [...pendingOrderIds]
      .slice(0, BATCH_SIZE)
      .map((order_id) => ({ order_id }));

    let processed = 0;
    let failed = 0;

    for (const order of orders) {
      try {
        const result = await processOrderCommissions(order.order_id);

        processed++;
        console.log("COMMISSION_WORKER_PROCESSED", {
          orderId: order.order_id,
          created: result.created,
          walletCredits: result.wallet_credits,
        });
      } catch (error) {
        failed++;
        console.error("COMMISSION_WORKER_FAILED", {
          orderId: order.order_id,
          error: error.message,
        });
      }
    }

    if (orders.length > 0) {
      console.log("COMMISSION_WORKER_BATCH", {
        checked: orders.length,
        processed,
        failed,
      });
    }
  } catch (error) {
    console.error("COMMISSION_WORKER_ERROR", error.message);
  } finally {
    running = false;
  }
}

function startCommissionWorker() {
  if (timer) return;

  console.log("Commission worker scheduled");

  // Allow the server to finish startup.
  timer = setInterval(() => {
    void runCommissionBatch();
  }, INTERVAL_MS);

  timer.unref?.();
}

module.exports = {
  startCommissionWorker,
  runCommissionBatch,
};
