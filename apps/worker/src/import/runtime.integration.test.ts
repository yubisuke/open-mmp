import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createAppPool, createMigrationPool, LocalPayloadStore, withTenant } from "@open-mmp/runtime";
import { runMmpImport } from "./runner.js";
import { persistCostImport } from "./cost.js";
import { expectedMaxTokenAll, receiveMax, type MaxReceiverConfig } from "../../../api/src/max-receiver.js";
import { processMaxInbox } from "./max-worker.js";

const appPool = createAppPool();
const ownerPool = createMigrationPool();
const temporary = mkdtempSync(join(tmpdir(), "openmmp-runtime-test-"));
const mappingPath = "examples/mappings/synthetic-provider-click.json";
const source = readFileSync("examples/synthetic/mmp-raw-events.json", "utf8");

async function reset(): Promise<void> {
  await ownerPool.query("TRUNCATE control.apps CASCADE");
}

before(reset);
after(async () => {
  await appPool.end();
  await ownerPool.end();
  rmSync(temporary, { recursive: true, force: true });
});

describe("M1a import integration", () => {
  it("A4 content-addresses exact retries and appends duplicate deliveries for equivalent files", async () => {
    const firstFile = join(temporary, "first.json");
    const equivalentFile = join(temporary, "equivalent.json");
    writeFileSync(firstFile, source);
    writeFileSync(equivalentFile, `${source.trim()}\n\n`);
    const first = await runMmpImport({ pool: appPool, mappingPath, filePath: firstFile, now: new Date("2026-08-19T10:00:00.000Z") });
    const skipped = await runMmpImport({ pool: appPool, mappingPath, filePath: firstFile, now: new Date("2026-08-19T10:01:00.000Z") });
    const second = await runMmpImport({ pool: appPool, mappingPath, filePath: equivalentFile, now: new Date("2026-08-19T10:02:00.000Z") });
    assert.equal(first.status, "completed");
    assert.equal(skipped.status, "skipped");
    assert.equal(second.status, "completed");
    await withTenant(appPool, "tenant-local", async (client) => {
      const logical = await client.query("SELECT count(*)::int AS count FROM ledger.logical_events");
      const deliveries = await client.query("SELECT duplicate_resolution, count(*)::int AS count FROM ledger.event_deliveries GROUP BY 1 ORDER BY 1");
      assert.equal(logical.rows[0].count, 1);
      assert.deepEqual(deliveries.rows, [
        { duplicate_resolution: "duplicate_delivery", count: 1 },
        { duplicate_resolution: "unique", count: 1 },
      ]);
    });
  });

  it("A5 keeps identical cost snapshots idempotent and appends one restatement", async () => {
    const base = {
      tenant_id: "tenant-local", app_id: "app-local", network: "synthetic-network",
      campaign_id: "campaign-cost-1", ad_group_id: null, country: "US", date: "2026-08-18",
      amount_unscaled: "1000000", amount_scale: 6, currency: "USD",
      source: "imported_reported" as const, as_of: "2026-08-19T11:00:00.000Z",
    };
    const first = await persistCostImport(appPool, "synthetic-cost", [base]);
    const repeated = await persistCostImport(appPool, "synthetic-cost", [base]);
    const restated = await persistCostImport(appPool, "synthetic-cost", [{ ...base, amount_unscaled: "1250000", as_of: "2026-08-19T12:00:00.000Z" }]);
    assert.equal(first.inserted, 1);
    assert.equal(repeated.inserted, 0);
    assert.equal(restated.inserted, 1);
    await withTenant(appPool, "tenant-local", async (client) => {
      const all = await client.query("SELECT count(*)::int AS count FROM ledger.cost_records");
      const current = await client.query("SELECT spend_unscaled FROM ledger.cost_records_current WHERE campaign_id='campaign-cost-1'");
      assert.equal(all.rows[0].count, 2);
      assert.equal(current.rows[0].spend_unscaled, "1250000");
    });
  });

  it("A10 rejects an oversized import before any database insert", async () => {
    const file = join(temporary, "too-many.json");
    writeFileSync(file, source);
    const beforeCount = await ownerPool.query("SELECT count(*)::int AS count FROM control.import_runs");
    await assert.rejects(
      runMmpImport({ pool: appPool, mappingPath, filePath: file, limits: { maxBytes: 1_000_000, maxRows: 0, maxRowBytes: 65_536 } }),
      /exceeds 0 rows/,
    );
    const afterCount = await ownerPool.query("SELECT count(*)::int AS count FROM control.import_runs");
    assert.equal(afterCount.rows[0].count, beforeCount.rows[0].count);
  });
});

describe("MAX receiver integration", () => {
  const config: MaxReceiverConfig = {
    tenantId: "tenant-local", appId: "app-local", pathSecret: "synthetic-path",
    eventKey: "synthetic-event-key", tokenMode: "all_with_event_fallback",
    maxParameters: 40, maxQueryBytes: 8192,
  };
  const payloadStore = new LocalPayloadStore(join(temporary, "payloads"));

  it("A6 verifies, durably enqueues, returns 204, and deduplicates in the worker", async () => {
    const send = async (eventId: string): Promise<{ status: number; elapsed: number }> => {
      const parameters = new URLSearchParams({ event_id: eventId, revenue: "0.123456", ts: "1787097600", ad_unit_id: "synthetic-unit", network: "synthetic-network", cc: "US" });
      parameters.set("event_token_all", expectedMaxTokenAll(parameters, config.eventKey));
      const response = responseCapture();
      const started = performance.now();
      await receiveMax({ url: `/v1/ingest/max/synthetic-path?${parameters}` } as IncomingMessage, response.value, { pool: appPool, payloadStore, config });
      return { status: response.status(), elapsed: (performance.now() - started) / 1000 };
    };
    const first = await send("abcdef0123456789abcdef0123456789abcdef01");
    await processMaxInbox(appPool, payloadStore, "tenant-local");
    const second = await send("abcdef0123456789abcdef0123456789abcdef01");
    await processMaxInbox(appPool, payloadStore, "tenant-local");
    assert.equal(first.status, 204);
    assert.equal(second.status, 204);
    assert.ok(first.elapsed < 1);
    await withTenant(appPool, "tenant-local", async (client) => {
      const all = await client.query("SELECT duplicate_resolution, count(*)::int AS count FROM ledger.event_deliveries GROUP BY 1 ORDER BY 1");
      assert.ok(all.rows.some((row) => row.duplicate_resolution === "duplicate_delivery"));
    });
  });

  it("A6 rejects tampering and denied identifiers without writing a payload", async () => {
    for (const query of [
      "event_id=bad&revenue=1&event_token_all=tampered",
      "event_id=bad&idfa=synthetic-denied-id&event_token_all=tampered",
    ]) {
      const response = responseCapture();
      await receiveMax({ url: `/v1/ingest/max/synthetic-path?${query}` } as IncomingMessage, response.value, { pool: appPool, payloadStore, config });
      assert.ok([400, 401].includes(response.status()));
    }
    await withTenant(appPool, "tenant-local", async (client) => {
      const audit = await client.query("SELECT count(*)::int AS count FROM ledger.audit_logs WHERE outcome='failed'");
      assert.ok(audit.rows[0].count >= 2);
    });
  });
});

function responseCapture(): { value: ServerResponse; status: () => number } {
  let code = 0;
  const value = {
    writeHead(status: number) { code = status; return this; },
    end() { return this; },
  } as unknown as ServerResponse;
  return { value, status: () => code };
}
