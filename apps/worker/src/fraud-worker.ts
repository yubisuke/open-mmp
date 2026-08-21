import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";
import { evaluateSourceDay, fraudBundleHash, sha256Jcs, type FraudBundle } from "@openmasu/fraud-rules";
import { uuidV7, withTenant } from "@openmasu/runtime";

type SourceAggregate = {
  metric_date: string;
  campaign_id: string;
  network: string;
  site_id: string;
  clicks: string;
  installs: string;
  ctit_p50_ms: string | null;
  ctit_p95_ms: string | null;
  median_cvr: string;
};

export async function loadFraudBundle(path = "config/fraud-bundles/conservative-v1.json"): Promise<FraudBundle> {
  const bundle = JSON.parse(await readFile(path, "utf8")) as FraudBundle;
  fraudBundleHash(bundle);
  return bundle;
}

function sourceRef(tenantId: string, appId: string, row: SourceAggregate): string {
  return `source:${tenantId}:${appId}:${row.metric_date}:${row.campaign_id}:${row.network}:${row.site_id}`;
}

async function persistAggregate(client: PoolClient, tenantId: string, appId: string, row: SourceAggregate, now: string): Promise<void> {
  const artifact = {
    metric_date: row.metric_date,
    campaign_id: row.campaign_id,
    network: row.network,
    site_id: row.site_id,
    clicks: Number(row.clicks),
    installs: Number(row.installs),
    ctit_p50_ms: row.ctit_p50_ms === null ? null : Number(row.ctit_p50_ms),
    ctit_p95_ms: row.ctit_p95_ms === null ? null : Number(row.ctit_p95_ms),
  };
  const snapshot = sha256Jcs(artifact);
  await client.query(
    `INSERT INTO ledger.source_day_aggregates (
      tenant_id,app_id,metric_date,campaign_id,network,site_id,clicks,installs,
      ctit_p50_ms,ctit_p95_ms,input_snapshot_id,computed_at,artifact
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
    ON CONFLICT DO NOTHING`,
    [tenantId, appId, row.metric_date, row.campaign_id, row.network, row.site_id,
      row.clicks, row.installs, row.ctit_p50_ms, row.ctit_p95_ms, snapshot, now,
      JSON.stringify(artifact)],
  );
}

async function persistSourceDecision(
  client: PoolClient,
  tenantId: string,
  appId: string,
  row: SourceAggregate,
  bundle: FraudBundle,
  now: string,
): Promise<void> {
  const hit = evaluateSourceDay({
    clicks: Number(row.clicks),
    installs: Number(row.installs),
    medianCvr: Number(row.median_cvr),
    ...(row.ctit_p50_ms === null ? {} : { ctitP50Ms: Number(row.ctit_p50_ms) }),
    ...(row.ctit_p95_ms === null ? {} : { ctitP95Ms: Number(row.ctit_p95_ms) }),
  });
  if (!hit) return;
  const subject = sourceRef(tenantId, appId, row);
  const evidenceDigest = sha256Jcs({ subject, row });
  const artifact = {
    fraud_decision_id: `fraud:${sha256Jcs({ subject, evidenceDigest, bundle: fraudBundleHash(bundle) })}`,
    subject_scope: "source",
    subject_ref: subject,
    decision: hit.decision,
    action: hit.action,
    reason_code: hit.reasonCode,
    reason_code_version: "0.4.0",
    evidence: [{ type: hit.evidenceType, captured_at: now, digest: evidenceDigest, access_class: "protected" }],
    rule_bundle_id: bundle.id,
    rule_bundle_version: bundle.version,
    rule_bundle_hash: fraudBundleHash(bundle),
    rule_id: hit.ruleId,
    evaluated_at: now,
  };
  await client.query(
    `INSERT INTO ledger.fraud_decisions (
      fraud_decision_id,tenant_id,app_id,subject_ref,subject_scope,rule_id,
      decision,action,reason_code,evaluated_at,artifact
    ) VALUES ($1,$2,$3,$4,'source',$5,$6,$7,$8,$9,$10::jsonb)
    ON CONFLICT (fraud_decision_id) DO NOTHING`,
    [artifact.fraud_decision_id, tenantId, appId, subject, hit.ruleId, hit.decision,
      hit.action, hit.reasonCode, now, JSON.stringify(artifact)],
  );
}

export async function aggregateSourceDay(
  pool: Pool,
  tenantId: string,
  metricDate: string,
  bundle: FraudBundle,
  now = new Date().toISOString(),
): Promise<number> {
  return withTenant(pool, tenantId, async (client) => {
    const apps = await client.query<{ app_id: string }>(
      "SELECT app_id::text FROM control.apps WHERE tenant_id=$1 ORDER BY app_id",
      [tenantId],
    );
    let written = 0;
    for (const { app_id: appId } of apps.rows) {
      const result = await client.query<SourceAggregate>(
        `WITH source AS (
           SELECT $3::date::text AS metric_date,
             coalesce(click.campaign_id,'unattributed') AS campaign_id,
             coalesce(click.network,'unattributed') AS network,
             coalesce(click.site_id,'unattributed') AS site_id,
             count(DISTINCT click.logical_event_id)::text AS clicks,
             count(DISTINCT install.logical_event_id)::text AS installs,
             (percentile_cont(0.5) WITHIN GROUP (ORDER BY
               extract(epoch FROM (control.canonical_timestamp_value(install.install_begin_at_server)-control.canonical_timestamp_value(click.redirector_click_at)))*1000)
               FILTER (WHERE control.canonical_timestamp_value(install.install_begin_at_server) >= control.canonical_timestamp_value(click.redirector_click_at)))::bigint::text AS ctit_p50_ms,
             (percentile_cont(0.95) WITHIN GROUP (ORDER BY
               extract(epoch FROM (control.canonical_timestamp_value(install.install_begin_at_server)-control.canonical_timestamp_value(click.redirector_click_at)))*1000)
               FILTER (WHERE control.canonical_timestamp_value(install.install_begin_at_server) >= control.canonical_timestamp_value(click.redirector_click_at)))::bigint::text AS ctit_p95_ms
           FROM ledger.click_facts click
           LEFT JOIN ledger.install_facts install
             ON install.tenant_id=click.tenant_id AND install.app_id=click.app_id AND install.click_id=click.click_id
           WHERE click.tenant_id=$1 AND click.app_id=$2
             AND timezone('UTC',control.canonical_timestamp_value(click.redirector_click_at))::date=$3::date
           GROUP BY click.campaign_id,click.network,click.site_id
         )
         SELECT source.*,
           coalesce((SELECT percentile_cont(0.5) WITHIN GROUP
             (ORDER BY installs::numeric / nullif(clicks::numeric,0)) FROM source),0)::text AS median_cvr
         FROM source ORDER BY campaign_id,network,site_id`,
        [tenantId, appId, metricDate],
      );
      for (const row of result.rows) {
        await persistAggregate(client, tenantId, appId, row, now);
        await persistSourceDecision(client, tenantId, appId, row, bundle, now);
        written += 1;
      }
    }
    return written;
  });
}

export async function resolveExpiredQuarantines(pool: Pool, tenantId: string, now = new Date()): Promise<number> {
  return withTenant(pool, tenantId, async (client) => {
    const due = await client.query<{ fraud_decision_id: string; tenant_id: string; app_id: string; artifact: Record<string, unknown> }>(
        `SELECT quarantine.fraud_decision_id,quarantine.tenant_id,quarantine.app_id,decision.artifact
         FROM ephemeral.fraud_quarantines quarantine
         JOIN ledger.fraud_decisions decision USING (fraud_decision_id,tenant_id,app_id)
         WHERE quarantine.tenant_id=$1 AND quarantine.resolve_after <= $2
         ORDER BY quarantine.resolve_after,quarantine.fraud_decision_id FOR UPDATE SKIP LOCKED`,
        [tenantId, now.toISOString()],
      );
    for (const row of due.rows) {
        const prior = row.artifact;
        const decisionId = `fraud:${uuidV7(now.getTime())}`;
        const artifact = {
          ...prior,
          fraud_decision_id: decisionId,
          decision: "clear",
          action: "allow",
          evaluated_at: now.toISOString(),
          supersedes_fraud_decision_id: row.fraud_decision_id,
        };
        delete (artifact as Record<string, unknown>).resolution_deadline_at;
        await client.query(
          `INSERT INTO ledger.fraud_decisions (
            fraud_decision_id,tenant_id,app_id,subject_ref,subject_scope,rule_id,
            decision,action,reason_code,evaluated_at,supersedes_fraud_decision_id,artifact
          ) VALUES ($1,$2,$3,$4,$5,$6,'clear','allow',$7,$8,$9,$10::jsonb)`,
          [decisionId, row.tenant_id, row.app_id, prior.subject_ref,
            prior.subject_scope ?? "record", prior.rule_id ?? null, prior.reason_code,
            now.toISOString(), row.fraud_decision_id, JSON.stringify(artifact)],
        );
        await client.query("DELETE FROM ephemeral.fraud_quarantines WHERE fraud_decision_id=$1", [row.fraud_decision_id]);
    }
    return due.rowCount ?? 0;
  });
}
