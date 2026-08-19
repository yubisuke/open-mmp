import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { sha256, type CandidateAttempt } from "@open-mmp/attribution-core";
import { withTenant, type PayloadStore } from "@open-mmp/runtime";
import { ingestRuntimeBatch } from "./ingestion.js";

type Any = Record<string, any>;
type InboxRow = {
  ingest_batch_id: string;
  tenant_id: string;
  app_id: string;
  producer: string;
  received_at: string;
  body_ref: string;
  body_digest: string;
  status: "pending" | "processed" | "failed";
};

function serverContext(row: InboxRow, record: Any): Any {
  return {
    tenant_id: row.tenant_id,
    app_id: row.app_id,
    received_at: row.received_at,
    policy_digest: "sdk-runtime-policy-v0.3",
    processing_purposes: [{
      processing_purpose_id: record.processing_purpose_id ?? "analytics",
      consent_required: false,
      policy_version: "sdk-runtime-consent-v0.3",
    }],
    withdrawals: [],
    alternative_legal_bases: [],
    click_injection_threshold_ms: 2_000,
  };
}

async function attemptsFor(row: InboxRow, payloadStore: PayloadStore): Promise<CandidateAttempt[]> {
  const body = await payloadStore.read(row.body_ref);
  if (createHash("sha256").update(body).digest("hex") !== row.body_digest) throw new Error("ingest_batch_digest_mismatch");
  const parsed = JSON.parse(body.toString("utf8")) as Any;
  if (!Array.isArray(parsed.records) || parsed.records.length < 1) throw new Error("ingest_batch_records_invalid");
  return parsed.records.map((record: Any) => {
    if (record.tenant_id !== row.tenant_id || record.app_id !== row.app_id || record.producer !== row.producer) {
      throw new Error("ingest_batch_scope_mismatch");
    }
    return { server: serverContext(row, record), record, batch_id: row.ingest_batch_id };
  });
}

async function appendState(pool: Pool, row: InboxRow, status: "processed" | "failed", reasonCode?: string): Promise<void> {
  const changedAt = new Date().toISOString();
  await withTenant(pool, row.tenant_id, (client) => client.query(
    `INSERT INTO ledger.ingest_batch_states (
      ingest_batch_id, tenant_id, app_id, status, changed_at, reason_code, artifact
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [row.ingest_batch_id, row.tenant_id, row.app_id, status, changedAt, reasonCode ?? null,
      JSON.stringify({ ingest_batch_id: row.ingest_batch_id, status, changed_at: changedAt, ...(reasonCode ? { reason_code: reasonCode } : {}) })],
  ).then(() => undefined));
}

async function persistLateAttribution(pool: Pool, attribution: Any): Promise<void> {
  await withTenant(pool, attribution.tenant_id, async (client) => {
    const previous = await client.query<{ artifact: Any }>(
      `SELECT artifact FROM ledger.attribution_results
       WHERE tenant_id=$1 AND app_id=$2 AND attribution_id=$3`,
      [attribution.tenant_id, attribution.app_id, attribution.attribution_id],
    );
    const prior = previous.rows[0]?.artifact;
    if (!prior || prior.reason_code === attribution.reason_code || attribution.reason_code !== "valid_install_referrer") return;
    const replacement: Any = {
      ...attribution,
      attribution_id: `${attribution.attribution_id}:late-${sha256(attribution.evidence_refs).slice(0, 12)}`,
      finality: "superseded",
      supersedes_attribution_id: attribution.attribution_id,
    };
    await client.query(
      `INSERT INTO ledger.attribution_results (
        attribution_id, tenant_id, app_id, subject_scope, subject_ref, effective_at,
        decided_at, status, method, model, reason_code, artifact
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
      ON CONFLICT (attribution_id) DO NOTHING`,
      [replacement.attribution_id, replacement.tenant_id, replacement.app_id,
        replacement.subject_scope, replacement.subject_ref, replacement.effective_at,
        replacement.decided_at, replacement.status, replacement.method, replacement.model,
        replacement.reason_code, JSON.stringify(replacement)],
    );
  });
}

export async function processSdkInbox(pool: Pool, payloadStore: PayloadStore, tenantId: string): Promise<number> {
  const rows = await withTenant(pool, tenantId, (client) => client.query<InboxRow>(
    `SELECT ingest_batch_id::text, tenant_id, app_id, producer, received_at,
            body_ref, body_digest, status
     FROM ledger.ingest_batches_current
     WHERE tenant_id=$1 AND status IN ('pending','processed')
     ORDER BY received_at, inbox_seq`,
    [tenantId],
  ));
  const historical: CandidateAttempt[] = [];
  const pending: CandidateAttempt[] = [];
  const validPendingRows: InboxRow[] = [];
  for (const row of rows.rows) {
    try {
      const attempts = await attemptsFor(row, payloadStore);
      if (row.status === "processed") historical.push(...attempts);
      else { pending.push(...attempts); validPendingRows.push(row); }
    } catch (error) {
      if (row.status === "pending") await appendState(pool, row, "failed", error instanceof Error ? error.message : "batch_invalid");
    }
  }
  if (pending.length === 0) return 0;
  try {
    const output = await ingestRuntimeBatch(pending, pool, historical);
    for (const attribution of output.attributions) await persistLateAttribution(pool, attribution);
    const recordsByBatch = new Map<string, string[]>();
    for (const attempt of pending) {
      const list = recordsByBatch.get(attempt.batch_id) ?? [];
      list.push(attempt.record.record_id);
      recordsByBatch.set(attempt.batch_id, list);
    }
    for (const row of validPendingRows) {
      await withTenant(pool, row.tenant_id, async (client) => {
        for (const recordId of recordsByBatch.get(row.ingest_batch_id) ?? []) {
          await client.query(
            `INSERT INTO ledger.ingest_batch_records (
              ingest_batch_id, tenant_id, app_id, record_id, created_at
            ) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
            [row.ingest_batch_id, row.tenant_id, row.app_id, recordId, new Date().toISOString()],
          );
        }
      });
      await appendState(pool, row, "processed");
    }
    return validPendingRows.length;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "evaluation_failed";
    for (const row of validPendingRows) await appendState(pool, row, "failed", reason);
    throw error;
  }
}
