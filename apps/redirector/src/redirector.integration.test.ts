import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  createAppPool,
  EncryptedFilePayloadStore,
  withTenant,
  type PayloadStore,
} from "@openmasu/runtime";
import { decodeInstallReferrer } from "@openmasu/redirector-core";
import { createTrackingLink } from "../../api/src/tracking-links.js";
import { registerAppLinkIdentity, registerLinkDomain } from "../../api/src/link-domains.js";
import { createRedirectorHandler } from "./handler.js";

const suffix = randomBytes(6).toString("hex");
const tenantId = `tenant-redirect-${suffix}`;
const appId = `app-redirect-${suffix}`;
const root = mkdtempSync(join(tmpdir(), "openmasu-redirect-"));
const pool = createAppPool();
const payloadStore = new EncryptedFilePayloadStore(root, `master-${randomBytes(32).toString("base64url")}`);
const fallback = "https://safe.example/fallback";
let baseUrl = "";
let server: ReturnType<typeof createServer>;
let slug = "";
const linkHost = `links-${suffix}.synthetic.example`;

describe("M2a redirector HTTP shell", () => {
  before(async () => {
    await withTenant(pool, tenantId, (client) => client.query(
      `INSERT INTO control.apps (tenant_id, app_id, created_at)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [tenantId, appId, new Date().toISOString()],
    ).then(() => undefined));
    const link = await createTrackingLink({
      pool, tenantId, appId, actorRef: "admin_key:synthetic-redirector-test", allowedOrigins: [],
      body: {
        destination_kind: "play_store",
        destination_url: "https://play.google.com/store/apps/details?id=invalid.placeholder",
        play_package_name: "dev.openmasu.synthetic",
        campaign_id: `campaign-${suffix}`,
      },
    });
    slug = link.slug;
    await registerLinkDomain({
      pool,
      identity: { keyId: "synthetic-admin", tenantId, role: "admin" },
      host: linkHost,
      now: "2026-08-19T01:59:00.000Z",
    });
    const fingerprint = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, "0").toUpperCase()).join(":");
    await registerAppLinkIdentity({
      pool,
      identity: { keyId: "synthetic-admin", tenantId, appId, role: "admin" },
      body: {
        android_package_name: `dev.openmasu.synthetic.${suffix}`,
        android_sha256_fingerprints: [fingerprint],
        apple_team_id: "ABCDE12345",
        apple_bundle_id: `dev.openmasu.synthetic.${suffix}`,
      },
      now: "2026-08-19T01:59:01.000Z",
    });
    server = createServer(createRedirectorHandler({
      pool, payloadStore, tenantId, fallbackUrl: fallback, geoMode: "off",
      limiter: { allow: () => true },
      clock: () => new Date("2026-08-19T02:00:00.000Z"),
    }));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    await once(server, "close");
    await pool.end();
    rmSync(root, { recursive: true, force: true });
  });

  it("uses only the stored destination and round-trips one short referrer", async () => {
    const response = await fetch(`${baseUrl}/r/${slug}?destination=https://attacker.invalid&next=https://attacker.invalid`, {
      redirect: "manual",
      headers: { "user-agent": "Synthetic Android", location: "https://attacker.invalid" },
    });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.hostname, "play.google.com");
    assert.equal(location.searchParams.get("id"), "dev.openmasu.synthetic");
    const referrer = location.searchParams.get("referrer")!;
    assert.ok(Buffer.byteLength(referrer, "utf8") < 64);
    assert.match(decodeInstallReferrer(referrer).cid, /^[A-Za-z0-9_-]{22,128}$/);
  });

  it("DL-A-08 through DL-A-10 resolves tenant hosts and serves byte-stable public association files", async () => {
    const hosted = createServer(createRedirectorHandler({
      pool, payloadStore, tenantId: "unused-fixed-tenant", hostMode: "host_header",
      fallbackUrl: fallback, geoMode: "off", limiter: { allow: () => true },
      wellKnownLimiter: { allow: () => true },
    }));
    hosted.listen(0, "127.0.0.1");
    await once(hosted, "listening");
    const hostedBase = `http://127.0.0.1:${(hosted.address() as AddressInfo).port}`;
    const get = (path: string, host = linkHost) => fetch(`${hostedBase}${path}`, {
      redirect: "manual", headers: { host, "user-agent": "Synthetic Android" },
    });
    const assetlinks = await get("/.well-known/assetlinks.json");
    const assetBytes = Buffer.from(await assetlinks.arrayBuffer());
    const dotted = await get("/.well-known/assetlinks.json", `${linkHost}.`);
    assert.equal(assetlinks.status, 200);
    assert.equal(assetlinks.headers.get("set-cookie"), null);
    assert.equal(assetlinks.headers.get("location"), null);
    assert.deepEqual(Buffer.from(await dotted.arrayBuffer()), assetBytes);
    assert.equal((JSON.parse(assetBytes.toString("utf8")) as any[])[0].target.namespace, "android_app");
    const aasa = await get("/.well-known/apple-app-site-association");
    assert.deepEqual((await aasa.json() as any).applinks.details[0].components, [{ "/": "/r/*" }]);
    assert.equal((await get("/.well-known/assetlinks.json", "unknown.synthetic.example")).status, 404);
    assert.equal((await get(`/r/${slug}/shop/item/53?dlp_code=abc`)).status, 302);
    hosted.close();
    await once(hosted, "close");
  });

  it("returns byte-identical fallbacks for unknown, paused, archived, and internal-error paths", async () => {
    const request = async (path: string) => {
      const response = await fetch(`${baseUrl}${path}`, { redirect: "manual", headers: { "user-agent": "Synthetic Android" } });
      return { status: response.status, headers: [...response.headers.entries()].sort(), body: await response.text() };
    };
    const unknown = await request("/r/UnknownSlug0_");
    await withTenant(pool, tenantId, (client) => client.query(
      `INSERT INTO control.tracking_link_states (
        tracking_link_id, tenant_id, app_id, status, changed_at, artifact
      ) SELECT tracking_link_id, tenant_id, app_id, 'paused', $3, $4::jsonb
        FROM control.tracking_links WHERE tenant_id=$1 AND slug=$2`,
      [tenantId, slug, new Date().toISOString(), JSON.stringify({ status: "paused" })],
    ).then(() => undefined));
    assert.deepEqual(await request(`/r/${slug}`), unknown);
    await withTenant(pool, tenantId, (client) => client.query(
      `INSERT INTO control.tracking_link_states (
        tracking_link_id, tenant_id, app_id, status, changed_at, artifact
      ) SELECT tracking_link_id, tenant_id, app_id, 'archived', $3, $4::jsonb
        FROM control.tracking_links WHERE tenant_id=$1 AND slug=$2`,
      [tenantId, slug, new Date().toISOString(), JSON.stringify({ status: "archived" })],
    ).then(() => undefined));
    assert.deepEqual(await request(`/r/${slug}`), unknown);

    const failingStore: PayloadStore = {
      ...payloadStore,
      write: async () => { throw new Error("synthetic persistence failure"); },
      read: (reference) => payloadStore.read(reference),
      purge: (reference) => payloadStore.purge(reference),
      scanFor: (value) => payloadStore.scanFor(value),
    };
    await withTenant(pool, tenantId, (client) => client.query(
      `INSERT INTO control.tracking_link_states (
        tracking_link_id, tenant_id, app_id, status, changed_at, artifact
      ) SELECT tracking_link_id, tenant_id, app_id, 'active', $3, $4::jsonb
        FROM control.tracking_links WHERE tenant_id=$1 AND slug=$2`,
      [tenantId, slug, new Date().toISOString(), JSON.stringify({ status: "active" })],
    ).then(() => undefined));
    const errorServer = createServer(createRedirectorHandler({
      pool, payloadStore: failingStore, tenantId, fallbackUrl: fallback, geoMode: "off",
      limiter: { allow: () => true },
    }));
    errorServer.listen(0, "127.0.0.1");
    await once(errorServer, "listening");
    const errorBase = `http://127.0.0.1:${(errorServer.address() as AddressInfo).port}`;
    const response = await fetch(`${errorBase}/r/${slug}`, { redirect: "manual", headers: { "user-agent": "Synthetic Android" } });
    const internal = { status: response.status, headers: [...response.headers.entries()].sort(), body: await response.text() };
    errorServer.close();
    await once(errorServer, "close");
    assert.deepEqual(internal, unknown);
  });

  it("fails closed at link creation and never persists the source IP", async () => {
    await assert.rejects(createTrackingLink({
      pool, tenantId, appId, actorRef: "admin_key:synthetic-redirector-test", allowedOrigins: [],
      body: { destination_kind: "custom_https", destination_url: "https://attacker.invalid/" },
    }), /destination_origin_not_allowed/);
    const databaseContainsIp = await withTenant(pool, tenantId, async (client) => {
      const columns = await client.query<{ table_schema: string; table_name: string; column_name: string }>(
        `SELECT table_schema, table_name, column_name
         FROM information_schema.columns
         WHERE table_schema IN ('control','ledger','ephemeral')
           AND data_type IN ('text','character varying','json','jsonb')
           AND has_table_privilege(
             quote_ident(table_schema) || '.' || quote_ident(table_name),
             'SELECT'
           )
         ORDER BY table_schema, table_name, ordinal_position`,
      );
      const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
      for (const column of columns.rows) {
        const result = await client.query<{ found: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM ${identifier(column.table_schema)}.${identifier(column.table_name)}
             WHERE ${identifier(column.column_name)}::text LIKE $1
           ) AS found`, ["%127.0.0.1%"],
        );
        if (result.rows[0].found) return true;
      }
      return false;
    });
    assert.equal(databaseContainsIp, false);
    assert.equal(await payloadStore.scanFor("127.0.0.1"), false);
    const bodyRef = await withTenant(pool, tenantId, async (client) => (await client.query<{ body_ref: string }>(
      `SELECT body_ref FROM ledger.ingest_batches
       WHERE tenant_id=$1 AND app_id=$2 AND producer='redirector'
       ORDER BY inbox_seq DESC LIMIT 1`, [tenantId, appId],
    )).rows[0].body_ref);
    const stored = JSON.parse((await payloadStore.read(bodyRef)).toString("utf8")) as { records: Array<{ payload: Record<string, unknown> }> };
    assert.equal(stored.records[0].payload.country, undefined);

    const limited = createServer(createRedirectorHandler({
      pool, payloadStore, tenantId, fallbackUrl: fallback, geoMode: "off", limiter: { allow: () => false },
    }));
    limited.listen(0, "127.0.0.1");
    await once(limited, "listening");
    const limitedBase = `http://127.0.0.1:${(limited.address() as AddressInfo).port}`;
    assert.equal((await fetch(`${limitedBase}/r/${slug}`, { redirect: "manual", headers: { "user-agent": "Synthetic Android" } })).status, 429);
    limited.close();
    await once(limited, "close");
  });
});
