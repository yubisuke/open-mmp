import { createHash } from "node:crypto";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import type { Pool } from "pg";
import type { PayloadStore } from "@open-mmp/runtime";
import { AppNotFoundError, listApps, registerApp, requireRegisteredApp } from "./apps-admin.js";
import { verifyAdminKey, type AdminIdentity } from "./admin-auth.js";
import { dashboardCss } from "./dashboard/css.js";
import { escapeHtml, renderDashboard } from "./dashboard/render.js";
import { buildDashboardView } from "./dashboard/view.js";
import { receiveMax, type MaxReceiverConfig } from "./max-receiver.js";
import { executePrivacyRequest, type PrivacyRequestBody } from "./privacy.js";
import {
  differenceAudit,
  encodeDifferenceAudit,
  encodeMetricReport,
  metricReport,
  recordCounts,
  type ReportFormat,
} from "./reporting.js";
import { parseMetricQuery, ReportQueryError } from "./report-query.js";
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
  readonly reportMaximumRows?: number;
  readonly reportMaximumExportRows?: number;
};

function loginPage(error?: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Open MMP login</title><link rel="stylesheet" href="/dashboard/app.css"></head><body><main><h1>Open MMP</h1>${error ? `<p role="alert">${escapeHtml(error)}</p>` : ""}<form method="post" action="/dashboard/session"><label>Admin key <input name="admin_key" type="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form></main></body></html>`;
}

const dashboardCssEtag = `"${createHash("sha256").update(dashboardCss).digest("hex")}"`;

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

function dashboardAppId(pathname: string): string | undefined {
  const match = /^\/dashboard\/apps\/([^/]+)(?:\/(?:cohorts\.csv|differences|tracking-links))?$/.exec(pathname);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

async function rejectDashboardCsrf(
  dependencies: RequestHandlerDependencies,
  response: ServerResponse,
  session: DashboardSession,
  action: string,
  targetScope: "tenant" | "app" | "session" | "tracking_link" | "sdk_key",
  targetRef: string,
): Promise<void> {
  await recordDashboardAudit(dependencies.pool, {
    tenantId: session.tenantId,
    actorRef: `admin_key:${session.adminKeyId}`,
    action,
    targetScope,
    targetRef,
    outcome: "failed",
    reasonCode: "csrf_rejected",
  });
  dashboardHtml(response, 403, "<!doctype html><html lang=\"en\"><body><h1>Forbidden</h1></body></html>");
}

export function createRequestHandler(dependencies: RequestHandlerDependencies): RequestListener {
  assertDashboardBaseUrl(dependencies.dashboard.enabled, dependencies.dashboard.publicBaseUrl);
  return (request, response) => {
    void (async () => {
      const target = new URL(request.url ?? "/", "http://open-mmp.local");
      const route = matchRoute(request.method, target.pathname);
      if (!route || (!dependencies.dashboard.enabled && route.handler.startsWith("dashboard_"))) {
        json(response, 404, { error: "not_found" });
        return;
      }
      const pool = routePool(dependencies, route);

      if (route.handler === "health") {
        json(response, 200, { status: "ok" });
        return;
      }
      if (route.handler === "max_ingest") {
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
      if (route.handler === "sdk_enrollment" && dependencies.sdk) return handleSdkEnrollment(request, response, dependencies.sdk);
      if (route.handler === "sdk_batch" && dependencies.sdk) return handleSdkBatch(request, response, dependencies.sdk);
      if (route.handler === "device_privacy" && dependencies.sdk) return handleDevicePrivacy(request, response, dependencies.sdk);

      if (route.handler === "dashboard_css") {
        if (request.headers["if-none-match"] === dashboardCssEtag) {
          response.writeHead(304, { ...dashboardHeaders, etag: dashboardCssEtag, "cache-control": "no-cache" }).end();
          return;
        }
        response.writeHead(200, {
          ...dashboardHeaders,
          "content-type": "text/css; charset=utf-8",
          "cache-control": "no-cache",
          etag: dashboardCssEtag,
        });
        response.end(dashboardCss);
        return;
      }
      if (route.handler === "dashboard_root") {
        const session = await dashboardSessionFor(dependencies, request);
        if (!session && authorization(request)) {
          dashboardHtml(response, 401, loginPage("Authentication required."));
          return;
        }
        if (!session) {
          dashboardHtml(response, 200, loginPage());
          return;
        }
        const apps = await listApps(dependencies.readerPool, {
          keyId: session.adminKeyId,
          tenantId: session.tenantId,
        });
        dashboardHtml(response, 200, renderDashboard(buildDashboardView({
          apps,
          csrfToken: csrfToken(session.token),
        })));
        return;
      }
      if (route.handler === "dashboard_login") {
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
      if (route.handler === "dashboard_logout") {
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

      if (["dashboard_app", "dashboard_export", "dashboard_differences", "dashboard_tracking_links_create", "dashboard_apps_create"].includes(route.handler)) {
        const session = await dashboardSessionFor(dependencies, request);
        if (!session) {
          dashboardHtml(response, 401, loginPage("Authentication required."));
          return;
        }
        const sessionIdentity: AdminIdentity = { keyId: session.adminKeyId, tenantId: session.tenantId };
        if (route.handler === "dashboard_apps_create") {
          const body = await formBody(request);
          const appId = body.get("app_id") ?? "";
          if (!csrfOriginAccepted(request, dependencies.dashboard.publicBaseUrl)
            || !verifyCsrfToken(session.token, body.get("csrf_token") ?? undefined)) {
            await rejectDashboardCsrf(dependencies, response, session, "dashboard_app_register", "app", appId || "app:unrecognized");
            return;
          }
          try {
            const issued = await registerApp({
              pool: dependencies.pool,
              payloadStore: dependencies.payloadStore,
              identity: sessionIdentity,
              appId,
              publicBaseUrl: dependencies.publicBaseUrl,
              redirectorBaseUrl: dependencies.redirectorBaseUrl,
            });
            dashboardHtml(response, 201, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SDK key issued</title><link rel="stylesheet" href="/dashboard/app.css"></head><body><main><h1>SDK key issued</h1><p>Copy this secret now. It cannot be retrieved again.</p><dl><dt>App</dt><dd>${escapeHtml(issued.app_id)}</dd><dt>SDK key ID</dt><dd>${escapeHtml(issued.sdk_key_id)}</dd><dt>SDK key</dt><dd><code>${escapeHtml(issued.sdk_key)}</code></dd></dl><p><a href="/dashboard/apps/${encodeURIComponent(issued.app_id)}">Continue to the app dashboard</a></p></main></body></html>`);
          } catch (error) {
            const status = error instanceof Error && error.message === "app_already_registered" ? 409 : 400;
            dashboardHtml(response, status, `<!doctype html><html lang="en"><body><h1>App registration failed</h1><p>${escapeHtml(error instanceof Error ? error.message : "invalid_request")}</p></body></html>`);
          }
          return;
        }

        const appId = dashboardAppId(target.pathname) ?? "";
        try {
          const appIdentity = await requireRegisteredApp(dependencies.readerPool, sessionIdentity, appId);
          if (route.handler === "dashboard_tracking_links_create") {
            const body = await formBody(request);
            if (!csrfOriginAccepted(request, dependencies.dashboard.publicBaseUrl)
              || !verifyCsrfToken(session.token, body.get("csrf_token") ?? undefined)) {
              await rejectDashboardCsrf(dependencies, response, session, "dashboard_tracking_link_create", "tracking_link", "tracking_link:unrecognized");
              return;
            }
            try {
              const result = await createTrackingLink({
                pool: dependencies.pool,
                tenantId: appIdentity.tenantId,
                appId: appIdentity.appId,
                actorRef: `admin_key:${session.adminKeyId}`,
                allowedOrigins: dependencies.trackingDestinationAllowlist ?? [],
                body: Object.fromEntries(body),
              });
              const link = `${dependencies.redirectorBaseUrl.replace(/\/$/, "")}/${result.slug}`;
              dashboardHtml(response, 201, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Tracking link created</title><link rel="stylesheet" href="/dashboard/app.css"></head><body><main><h1>Tracking link created</h1><dl><dt>App</dt><dd>${escapeHtml(appIdentity.appId)}</dd><dt>Tracking link</dt><dd><code>${escapeHtml(link)}</code></dd><dt>Destination</dt><dd>${escapeHtml(result.destination_url)}</dd></dl><p><a href="/dashboard/apps/${encodeURIComponent(appIdentity.appId)}">Return to the app dashboard</a></p></main></body></html>`);
            } catch (error) {
              dashboardHtml(response, 400, `<!doctype html><html lang="en"><body><h1>Tracking link creation failed</h1><p>${escapeHtml(error instanceof Error ? error.message : "tracking_link_invalid")}</p></body></html>`);
            }
            return;
          }
          const params = new URLSearchParams(target.searchParams);
          if (route.handler === "dashboard_export") {
            params.set("format", "csv");
            params.set("export", "true");
          }
          const parsed = parseMetricQuery({
            tenantId: appIdentity.tenantId,
            appId: appIdentity.appId,
            searchParams: params,
            maximumRows: dependencies.reportMaximumRows,
            maximumExportRows: dependencies.reportMaximumExportRows,
          });
          if (route.handler === "dashboard_export") {
            const page = await metricReport(dependencies.readerPool, appIdentity, parsed.query);
            if (page.next_cursor) {
              dashboardHtml(response, 400, "<!doctype html><html lang=\"en\"><body><h1>Export limit exceeded</h1></body></html>");
              return;
            }
            const encoded = encodeMetricReport(page, "csv");
            const first = page.data[0];
            const range = `${parsed.query.dateFrom ?? "all"}-${parsed.query.dateTo ?? "all"}`;
            response.writeHead(200, {
              "content-type": encoded.contentType,
              "content-disposition": `attachment; filename="open-mmp-${appIdentity.appId}-${range}-${first?.input_snapshot_id.slice(0, 8) ?? "empty"}.csv"`,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            });
            response.end(encoded.body);
            return;
          }

          const apps = await listApps(dependencies.readerPool, sessionIdentity);
          const metrics = await metricReport(dependencies.readerPool, appIdentity, parsed.query);
          const effectiveWatermark = parsed.query.watermarkAtMost
            ?? metrics.data.map((row) => row.input_received_at_watermark).sort().at(-1);
          const effectiveQuery = effectiveWatermark
            ? { ...parsed.query, watermarkAtMost: effectiveWatermark }
            : parsed.query;
          const records = effectiveWatermark
            ? await recordCounts(dependencies.readerPool, appIdentity, effectiveQuery)
            : [];
          const storedDifferences = await differenceAudit(dependencies.readerPool, appIdentity, effectiveQuery);
          dashboardHtml(response, 200, renderDashboard(buildDashboardView({
            apps,
            selectedAppId: appIdentity.appId,
            query: effectiveQuery,
            metrics: route.handler === "dashboard_differences" ? { data: [] } : metrics,
            records: route.handler === "dashboard_differences" ? [] : records,
            differences: storedDifferences,
            csrfToken: csrfToken(session.token),
          })));
        } catch (error) {
          if (error instanceof AppNotFoundError) {
            dashboardHtml(response, 404, "<!doctype html><html lang=\"en\"><body><h1>App not found</h1></body></html>");
          } else if (error instanceof ReportQueryError || (error instanceof Error && error.message === "watermark_required")) {
            dashboardHtml(response, 400, `<!doctype html><html lang="en"><body><h1>Invalid filter</h1><p>${escapeHtml(error.message)}</p></body></html>`);
          } else {
            throw error;
          }
        }
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
        if (route.handler === "admin_apps_list") {
          json(response, 200, { data: await listApps(pool, identity) });
          return;
        }
        if (route.handler === "admin_apps_create") {
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
        if (route.handler === "report_metrics" || route.handler === "audit_differences" || route.handler === "report_records") {
          const appId = target.searchParams.get("app_id") ?? "";
          try {
            const appIdentity = await requireRegisteredApp(pool, identity, appId);
            const parsed = parseMetricQuery({
              tenantId: appIdentity.tenantId,
              appId: appIdentity.appId,
              searchParams: target.searchParams,
              maximumRows: dependencies.reportMaximumRows,
              maximumExportRows: dependencies.reportMaximumExportRows,
            });
            if (route.handler === "report_records") {
              const data = await recordCounts(pool, appIdentity, parsed.query);
              json(response, 200, { data });
              return;
            }
            const format = parsed.format as ReportFormat;
            let encoded: { contentType: string; body: string };
            let first: { input_snapshot_id?: string } | undefined;
            if (route.handler === "report_metrics") {
              const page = await metricReport(pool, appIdentity, parsed.query);
              if (parsed.export && page.next_cursor) {
                json(response, 400, { error: "export_limit_exceeded" });
                return;
              }
              encoded = encodeMetricReport(page, format);
              first = page.data[0];
            } else {
              const page = await differenceAudit(pool, appIdentity, parsed.query);
              encoded = encodeDifferenceAudit(page, format);
              first = page.data[0] as { input_snapshot_id?: string } | undefined;
            }
            const range = `${parsed.query.dateFrom ?? "all"}-${parsed.query.dateTo ?? "all"}`;
            response.writeHead(200, {
              "content-type": encoded.contentType,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
              ...(format === "csv" ? {
                "content-disposition": `attachment; filename="open-mmp-${appIdentity.appId}-${range}-${first?.input_snapshot_id?.slice(0, 8) ?? "empty"}.csv"`,
              } : {}),
            });
            response.end(encoded.body);
          } catch (error) {
            if (error instanceof AppNotFoundError) {
              json(response, 404, { error: "app_not_found" });
            } else if (error instanceof ReportQueryError || (error instanceof Error && error.message === "watermark_required")) {
              json(response, 400, { error: error.message });
            } else {
              throw error;
            }
          }
          return;
        }
        if (route.handler === "admin_tracking_links") {
          try {
            const body = await jsonBody(request);
            const appIdentity = await requireRegisteredApp(dependencies.pool, identity, String(body.app_id ?? ""));
            const result = await createTrackingLink({
              pool: dependencies.pool,
              tenantId: appIdentity.tenantId,
              appId: appIdentity.appId,
              actorRef: `admin_key:${identity.keyId}`,
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
        if (route.handler === "admin_privacy") {
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
