import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { PayloadStore } from "@open-mmp/runtime";
import { listApps, registerApp, requireRegisteredApp } from "./apps-admin.js";
import { verifyAdminKey, type AdminIdentity } from "./admin-auth.js";
import { receiveMax, type MaxReceiverConfig } from "./max-receiver.js";
import { executePrivacyRequest, type PrivacyRequestBody } from "./privacy.js";
import {
  differenceAudit,
  encodeDifferenceAudit,
  encodeMetricReport,
  metricReport,
  type ReportFormat,
} from "./reporting.js";
import type { KeyedTokenBucket, TokenBucket } from "./rate-limit.js";
import { matchRoute, type RouteDefinition } from "./routes.js";
import type { SdkRouteDependencies } from "./sdk-routes.js";
import { handleDevicePrivacy, handleSdkBatch, handleSdkEnrollment } from "./sdk-routes.js";
import {
  assertDashboardBaseUrl,
  clearDashboardSessionCookie,
  csrfToken,
  dashboardSessionCookie,
  issueDashboardSession,
  recordDashboardAudit,
  revokeDashboardSession,
  verifyCsrfToken,
  verifyDashboardSession,
  type DashboardSession,
} from "./session.js";
import { createTrackingLink } from "./tracking-links.js";

export const dashboardHeaders = {
  "content-security-policy": "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
} as const;

export type DashboardConfig = {
  readonly enabled: boolean;
  readonly publicBaseUrl: string;
  readonly tenantId: string;
  readonly sessionTtlSeconds: number;
};

export type RequestHandlerDependencies = {
  readonly pool: Pool;
  readonly readerPool: Pool;
  readonly payloadStore: PayloadStore;
  readonly maxConfig: MaxReceiverConfig;
  readonly publicBaseUrl: string;
  readonly redirectorBaseUrl: string;
  readonly dashboard: DashboardConfig;
  readonly maxBucket?: TokenBucket;
  readonly adminBucket?: TokenBucket;
  readonly dashboardLoginBucket?: KeyedTokenBucket;
  readonly dashboardLoginGlobalBucket?: TokenBucket;
  readonly sdk?: SdkRouteDependencies;
  readonly trackingDestinationAllowlist?: readonly string[];
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function loginPage(error?: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Open MMP login</title><link rel="stylesheet" href="/dashboard/app.css"></head><body><main><h1>Open MMP</h1>${error ? `<p role="alert">${escapeHtml(error)}</p>` : ""}<form method="post" action="/dashboard/session"><label>Admin key <input name="admin_key" type="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form></main></body></html>`;
}

function dashboardPage(session: DashboardSession): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Open MMP dashboard</title><link rel="stylesheet" href="/dashboard/app.css"></head><body><main><h1>Open MMP dashboard</h1><p>No data yet; run <code>npm run seed</code>.</p><form method="post" action="/dashboard/session/delete"><input type="hidden" name="csrf_token" value="${csrfToken(session.token)}"><button type="submit">Sign out</button></form></main></body></html>`;
}

const dashboardCss = `:root{font-family:system-ui,sans-serif;color-scheme:light dark}body{margin:0;padding:2rem;background:Canvas;color:CanvasText}main{max-width:72rem;margin:auto}form{display:grid;gap:1rem;max-width:32rem}input,button{font:inherit;padding:.65rem}table{border-collapse:collapse;width:100%}th,td{padding:.5rem;border:1px solid GrayText;text-align:left}@media(prefers-color-scheme:dark){:root{color-scheme:dark}}\n`;

async function rawBody(request: IncomingMessage, maximumBytes = 32 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maximumBytes) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return JSON.parse((await rawBody(request)).toString("utf8")) as Record<string, unknown>;
}

async function formBody(request: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams((await rawBody(request)).toString("utf8"));
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(`${JSON.stringify(value)}\n`);
}

function dashboardHtml(response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, { ...dashboardHeaders, "content-type": "text/html; charset=utf-8", ...headers });
  response.end(body);
}

function sourceKey(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? "unknown";
}

function authorization(request: IncomingMessage): string | undefined {
  return typeof request.headers.authorization === "string" ? request.headers.authorization : undefined;
}

async function adminIdentity(
  dependencies: RequestHandlerDependencies,
  request: IncomingMessage,
  pool: Pool,
): Promise<AdminIdentity | undefined> {
  return verifyAdminKey(pool, dependencies.dashboard.tenantId, authorization(request));
}

function routePool(dependencies: RequestHandlerDependencies, route: RouteDefinition): Pool {
  return route.mutates ? dependencies.pool : dependencies.readerPool;
}

function csrfOriginAccepted(request: IncomingMessage, publicBaseUrl: string): boolean {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
  return !origin || origin === new URL(publicBaseUrl).origin;
}

async function dashboardSessionFor(
  dependencies: RequestHandlerDependencies,
  request: IncomingMessage,
): Promise<DashboardSession | undefined> {
  return verifyDashboardSession(
    dependencies.readerPool,
    dependencies.dashboard.tenantId,
    request.headers.cookie,
    dependencies.dashboard.publicBaseUrl,
  );
}

export function createRequestHandler(dependencies: RequestHandlerDependencies): RequestListener {
  assertDashboardBaseUrl(dependencies.dashboard.enabled, dependencies.dashboard.publicBaseUrl);
  return (request, response) => {
    void (async () => {
      const target = new URL(request.url ?? "/", "http://open-mmp.local");
      const route = matchRoute(request.method, target.pathname);
      if (!route || (!dependencies.dashboard.enabled && route.id.startsWith("dashboard_"))) {
        json(response, 404, { error: "not_found" });
        return;
      }
      const pool = routePool(dependencies, route);

      if (route.id === "health") {
        json(response, 200, { status: "ok" });
        return;
      }
      if (route.id === "max_ingest") {
        if (!request.url?.startsWith(`/v1/ingest/max/${dependencies.maxConfig.pathSecret}?`)) {
          json(response, 404, { error: "not_found" });
          return;
        }
        if (dependencies.maxBucket && !dependencies.maxBucket.allow()) {
          response.writeHead(429, { "retry-after": "1" }).end();
          return;
        }
        await receiveMax(request, response, {
          pool: dependencies.pool,
          payloadStore: dependencies.payloadStore,
          config: dependencies.maxConfig,
        });
        return;
      }
      if (route.id === "sdk_enrollment" && dependencies.sdk) return handleSdkEnrollment(request, response, dependencies.sdk);
      if (route.id === "sdk_batch" && dependencies.sdk) return handleSdkBatch(request, response, dependencies.sdk);
      if (route.id === "device_privacy" && dependencies.sdk) return handleDevicePrivacy(request, response, dependencies.sdk);

      if (route.id === "dashboard_css") {
        response.writeHead(200, { ...dashboardHeaders, "content-type": "text/css; charset=utf-8", "cache-control": "no-cache" });
        response.end(dashboardCss);
        return;
      }
      if (route.id === "dashboard_root") {
        const session = await dashboardSessionFor(dependencies, request);
        if (!session && authorization(request)) {
          dashboardHtml(response, 401, loginPage("Authentication required."));
          return;
        }
        dashboardHtml(response, 200, session ? dashboardPage(session) : loginPage());
        return;
      }
      if (route.id === "dashboard_login") {
        const allowed = (!dependencies.dashboardLoginBucket || dependencies.dashboardLoginBucket.allow(sourceKey(request)))
          && (!dependencies.dashboardLoginGlobalBucket || dependencies.dashboardLoginGlobalBucket.allow());
        if (!allowed) {
          response.writeHead(429, { ...dashboardHeaders, "retry-after": "60" }).end();
          return;
        }
        const body = await formBody(request);
        const key = body.get("admin_key") ?? "";
        const identity = await verifyAdminKey(dependencies.pool, dependencies.dashboard.tenantId, `Bearer ${key}`);
        if (!identity) {
          await recordDashboardAudit(dependencies.pool, {
            tenantId: dependencies.dashboard.tenantId,
            actorRef: "admin_key:unrecognized",
            action: "dashboard_login",
            targetScope: "session",
            targetRef: "session:unrecognized",
            outcome: "failed",
            reasonCode: "authentication_failed",
          });
          dashboardHtml(response, 401, loginPage("Authentication failed."));
          return;
        }
        const session = await issueDashboardSession(
          dependencies.pool,
          identity.tenantId,
          identity.keyId,
          dependencies.dashboard.sessionTtlSeconds,
        );
        await recordDashboardAudit(dependencies.pool, {
          tenantId: identity.tenantId,
          actorRef: `admin_key:${identity.keyId}`,
          action: "dashboard_login",
          targetScope: "session",
          targetRef: session.sessionId,
          outcome: "succeeded",
        });
        response.writeHead(303, {
          ...dashboardHeaders,
          location: "/dashboard",
          "set-cookie": dashboardSessionCookie(
            session.token,
            dependencies.dashboard.publicBaseUrl,
            dependencies.dashboard.sessionTtlSeconds,
          ),
        }).end();
        return;
      }
      if (route.id === "dashboard_logout") {
        const session = await dashboardSessionFor(dependencies, request);
        if (!session) {
          dashboardHtml(response, 401, loginPage("Authentication required."));
          return;
        }
        const body = await formBody(request);
        if (!csrfOriginAccepted(request, dependencies.dashboard.publicBaseUrl)
          || !verifyCsrfToken(session.token, body.get("csrf_token") ?? undefined)) {
          await recordDashboardAudit(dependencies.pool, {
            tenantId: session.tenantId,
            actorRef: `admin_key:${session.adminKeyId}`,
            action: "dashboard_logout",
            targetScope: "session",
            targetRef: session.sessionId,
            outcome: "failed",
            reasonCode: "csrf_rejected",
          });
          dashboardHtml(response, 403, "<!doctype html><html lang=\"en\"><body><h1>Forbidden</h1></body></html>");
          return;
        }
        await revokeDashboardSession(dependencies.pool, session);
        await recordDashboardAudit(dependencies.pool, {
          tenantId: session.tenantId,
          actorRef: `admin_key:${session.adminKeyId}`,
          action: "dashboard_logout",
          targetScope: "session",
          targetRef: session.sessionId,
          outcome: "succeeded",
        });
        response.writeHead(303, {
          ...dashboardHeaders,
          location: "/dashboard",
          "set-cookie": clearDashboardSessionCookie(dependencies.dashboard.publicBaseUrl),
        }).end();
        return;
      }

      if (route.auth === "admin_bearer") {
        if (dependencies.adminBucket && !dependencies.adminBucket.allow()) {
          response.writeHead(429, { "retry-after": "1", "cache-control": "no-store" }).end();
          return;
        }
        const identity = await adminIdentity(dependencies, request, pool);
        if (!identity) {
          json(response, 401, { error: "unauthorized" });
          return;
        }
        if (route.id === "admin_apps_list") {
          json(response, 200, { data: await listApps(pool, identity) });
          return;
        }
        if (route.id === "admin_apps_create") {
          try {
            const body = await jsonBody(request);
            const result = await registerApp({
              pool: dependencies.pool,
              payloadStore: dependencies.payloadStore,
              identity,
              appId: String(body.app_id ?? ""),
              publicBaseUrl: dependencies.publicBaseUrl,
              redirectorBaseUrl: dependencies.redirectorBaseUrl,
            });
            json(response, 201, result);
          } catch (error) {
            json(response, error instanceof Error && error.message === "app_already_registered" ? 409 : 400, {
              error: error instanceof Error ? error.message : "app_registration_failed",
            });
          }
          return;
        }
        if (route.id === "report_metrics" || route.id === "audit_differences" || route.id === "report_records") {
          const appId = target.searchParams.get("app_id") ?? "";
          try {
            const appIdentity = await requireRegisteredApp(pool, identity, appId);
            if (route.id === "report_records") {
              json(response, 501, { error: "record_counts_not_implemented" });
              return;
            }
            const requestedFormat = target.searchParams.get("format") ?? "json";
            if (requestedFormat !== "json" && requestedFormat !== "csv") {
              json(response, 400, { error: "unsupported_format" });
              return;
            }
            const format = requestedFormat as ReportFormat;
            const encoded = route.id === "report_metrics"
              ? encodeMetricReport(await metricReport(pool, appIdentity), format)
              : encodeDifferenceAudit(await differenceAudit(pool, appIdentity), format);
            response.writeHead(200, { "content-type": encoded.contentType, "cache-control": "no-store" });
            response.end(encoded.body);
          } catch {
            json(response, 404, { error: "app_not_found" });
          }
          return;
        }
        if (route.id === "admin_tracking_links") {
          try {
            const body = await jsonBody(request);
            const appIdentity = await requireRegisteredApp(dependencies.pool, identity, String(body.app_id ?? ""));
            const result = await createTrackingLink({
              pool: dependencies.pool,
              tenantId: appIdentity.tenantId,
              appId: appIdentity.appId,
              allowedOrigins: dependencies.trackingDestinationAllowlist ?? [],
              body,
            });
            json(response, 201, result);
          } catch (error) {
            const status = error instanceof Error && error.message === "app_not_found" ? 404 : 400;
            json(response, status, { error: status === 404 ? "app_not_found" : error instanceof Error ? error.message : "tracking_link_invalid" });
          }
          return;
        }
        if (route.id === "admin_privacy") {
          try {
            const body = await jsonBody(request) as PrivacyRequestBody;
            const appIdentity = await requireRegisteredApp(dependencies.pool, identity, String(body.app_id ?? ""));
            const result = await executePrivacyRequest(dependencies.pool, appIdentity, body, dependencies.payloadStore);
            json(response, 201, result);
          } catch (error) {
            const status = Number((error as { statusCode?: number }).statusCode ?? (error instanceof SyntaxError ? 400 : 500));
            json(response, status, { error: error instanceof Error ? error.message : "privacy_request_failed" });
          }
          return;
        }
      }

      json(response, 404, { error: "not_found" });
    })().catch((error) => {
      console.error(`Request failed: ${error instanceof Error ? error.message : "unknown error"}`);
      if (!response.headersSent) json(response, 500, { error: "internal_error" });
      else response.end();
    });
  };
}
