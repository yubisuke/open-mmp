import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import type { Pool } from "pg";
import {
  fallbackResponse,
  prefetchEvidence,
  resolveRedirect,
  type RedirectResolution,
  type TrackingLink,
} from "@openmasu/redirector-core";
import { appendDurableBatch, uuidV7, withTenant, type PayloadStore } from "@openmasu/runtime";

export type RedirectRateLimiter = {
  allow(key: string): boolean;
  classify?(key: string): "normal" | "elevated" | "saturated";
};

export type RedirectorDependencies = {
  pool: Pool;
  payloadStore: PayloadStore;
  tenantId: string;
  fallbackUrl: string;
  geoMode: "off" | "country";
  limiter: RedirectRateLimiter;
  clock?: () => Date;
};

async function loadLink(pool: Pool, tenantId: string, slug: string): Promise<TrackingLink | undefined> {
  return withTenant(pool, tenantId, async (client) => {
    const result = await client.query<TrackingLink>(
      `SELECT tracking_link_id, tenant_id, app_id, slug, destination_kind,
              destination_url, play_package_name, network, site_id,
              campaign_id, ad_group_id, creative_id, status
       FROM control.tracking_links_current
       WHERE tenant_id=$1 AND slug=$2`,
      [tenantId, slug],
    );
    return result.rows[0];
  });
}

function send(response: ServerResponse, result: RedirectResolution): void {
  response.writeHead(result.status, result.headers);
  response.end(result.body);
}

async function persistClick(dependencies: RedirectorDependencies, result: RedirectResolution): Promise<void> {
  const click = result.click ?? result.prefetch;
  if (!click) return;
  const record = {
    contract_version: "0.4.0",
    record_id: `record:${uuidV7()}`,
    delivery_id: `delivery:${uuidV7()}`,
    tenant_id: click.tenant_id,
    app_id: click.app_id,
    producer: "redirector",
    producer_version: "0.1.0",
    event_id: result.click ? `event:click:${result.click.click_id}` : `event:prefetch:${uuidV7()}`,
    event_name: "click",
    schema_version: "0.4.0",
    occurred_at: click.redirector_click_at,
    occurred_at_source: "server",
    received_at: click.redirector_click_at,
    processing_purpose_id: "analytics",
    processing_sequence: 1,
    payload: {
      ...(result.click ? { click_id: result.click.click_id } : {}),
      tracking_link_id: click.tracking_link_id,
      redirector_click_at: click.redirector_click_at,
      redirector_time_status: "available",
      ...(click.campaign_id ? { campaign_id: click.campaign_id } : {}),
      ...(click.ad_group_id ? { ad_group_id: click.ad_group_id } : {}),
      ...(click.creative_id ? { creative_id: click.creative_id } : {}),
      ...(click.network ? { network: click.network } : {}),
      ...(click.site_id ? { site_id: click.site_id } : {}),
      ...(click.remote_click_ref ? { remote_click_ref: click.remote_click_ref } : {}),
      ...(click.source_rate_class ? { source_rate_class: click.source_rate_class } : {}),
      ...(click.client_class ? { client_class: click.client_class } : {}),
      ...(result.prefetch ? { bot_prefetch: true } : {}),
    },
  };
  await appendDurableBatch(dependencies.pool, dependencies.payloadStore, {
    tenantId: click.tenant_id,
    appId: click.app_id,
    producer: "redirector",
    body: Buffer.from(JSON.stringify({ records: [record] }), "utf8"),
    eventCount: 1,
    receivedAt: click.redirector_click_at,
  });
}

export function createRedirectorHandler(dependencies: RedirectorDependencies): RequestListener {
  const fallback = fallbackResponse(dependencies.fallbackUrl);
  return (request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const target = new URL(request.url ?? "/", "http://openmasu.local");
      const match = request.method === "GET" ? /^\/r\/([A-Za-z0-9_-]{12,64})$/.exec(target.pathname) : null;
      if (!match) return send(response, fallback);
      const remoteAddress = request.socket.remoteAddress ?? "unknown";
      if (!dependencies.limiter.allow(remoteAddress)) {
        response.writeHead(429, { "cache-control": "no-store", "retry-after": "1" });
        response.end();
        return;
      }
      let link: TrackingLink | undefined;
      try { link = await loadLink(dependencies.pool, dependencies.tenantId, match[1]); }
      catch { return send(response, fallback); }
      if (!link || link.status !== "active") return send(response, fallback);
      const remoteClickRef = target.searchParams.get("remote_click_ref") ?? undefined;
      if (remoteClickRef && !/^[A-Za-z0-9._~-]{1,128}$/.test(remoteClickRef)) return send(response, fallback);
      const sourceRateClass = dependencies.limiter.classify?.(remoteAddress) ?? "normal";
      const purpose = `${request.headers.purpose ?? ""} ${request.headers["sec-purpose"] ?? ""}`;
      if (/prefetch/i.test(purpose)) {
        const result = prefetchEvidence({
          link,
          fallbackDestination: dependencies.fallbackUrl,
          now: (dependencies.clock ?? (() => new Date()))().toISOString(),
          ...(remoteClickRef ? { remoteClickRef } : {}),
          sourceRateClass,
        });
        await persistClick(dependencies, result);
        return send(response, result);
      }
      if (link.destination_kind === "play_store" && !/Android/i.test(request.headers["user-agent"] ?? "")) {
        return send(response, fallback);
      }
      try {
        const userAgent = String(request.headers["user-agent"] ?? "");
        const clientClass = /Android|iPhone|iPad/i.test(userAgent) ? "mobile_app_eligible" : "other";
        const result = resolveRedirect({
          link,
          fallbackDestination: dependencies.fallbackUrl,
          now: (dependencies.clock ?? (() => new Date()))().toISOString(),
          ...(remoteClickRef ? { remoteClickRef } : {}),
          sourceRateClass,
          clientClass,
        });
        await persistClick(dependencies, result);
        send(response, result);
      } catch {
        send(response, fallback);
      }
    })();
  };
}
