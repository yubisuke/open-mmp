import type { IncomingMessage, RequestListener } from "node:http";
import type { Pool } from "pg";
import type { PayloadStore } from "@open-mmp/runtime";
import { verifyAdminKey } from "./admin-auth.js";
import { receiveMax, type MaxReceiverConfig } from "./max-receiver.js";
import { executePrivacyRequest, type PrivacyRequestBody } from "./privacy.js";
import {
  differenceAudit,
  encodeDifferenceAudit,
  encodeMetricReport,
  metricReport,
  type ReportFormat,
} from "./reporting.js";
import type { TokenBucket } from "./rate-limit.js";
import type { SdkRouteDependencies } from "./sdk-routes.js";
import { handleDevicePrivacy, handleSdkBatch, handleSdkEnrollment } from "./sdk-routes.js";
import { createTrackingLink } from "./tracking-links.js";

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 32 * 1024) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createRequestHandler(dependencies: {
  pool: Pool;
  payloadStore: PayloadStore;
  maxConfig: MaxReceiverConfig;
  maxBucket?: TokenBucket;
  adminBucket?: TokenBucket;
  sdk?: SdkRouteDependencies;
  trackingDestinationAllowlist?: readonly string[];
}): RequestListener {
  return (request, response) => {
    void (async () => {
      if (request.method === "GET" && request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"status":"ok"}\n');
        return;
      }
      if (request.method === "GET" && request.url?.startsWith(`/v1/ingest/max/${dependencies.maxConfig.pathSecret}?`)) {
        if (dependencies.maxBucket && !dependencies.maxBucket.allow()) {
          response.writeHead(429, { "retry-after": "1" });
          response.end();
          return;
        }
        await receiveMax(request, response, {
          pool: dependencies.pool,
          payloadStore: dependencies.payloadStore,
          config: dependencies.maxConfig,
        });
        return;
      }
      if (request.method === "GET" && request.url?.startsWith("/v1/")) {
        const target = new URL(request.url, "http://open-mmp.local");
        const isMetrics = target.pathname === "/v1/reports/metrics";
        const isDifferences = target.pathname === "/v1/audit/differences";
        if (isMetrics || isDifferences) {
          if (dependencies.adminBucket && !dependencies.adminBucket.allow()) {
            response.writeHead(429, { "retry-after": "1" });
            response.end();
            return;
          }
          const identity = await verifyAdminKey(
            dependencies.pool,
            { tenantId: dependencies.maxConfig.tenantId, appId: dependencies.maxConfig.appId },
            typeof request.headers.authorization === "string" ? request.headers.authorization : undefined,
          );
          if (!identity) {
            response.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
            response.end('{"error":"unauthorized"}\n');
            return;
          }
          const requestedFormat = target.searchParams.get("format") ?? "json";
          if (requestedFormat !== "json" && requestedFormat !== "csv") {
            response.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" });
            response.end('{"error":"unsupported_format"}\n');
            return;
          }
          const format = requestedFormat as ReportFormat;
          const encoded = isMetrics
            ? encodeMetricReport(await metricReport(dependencies.pool, identity), format)
            : encodeDifferenceAudit(await differenceAudit(dependencies.pool, identity), format);
          response.writeHead(200, { "content-type": encoded.contentType, "cache-control": "no-store" });
          response.end(encoded.body);
          return;
        }
      }
      if (request.method === "POST" && request.url === "/v1/installations" && dependencies.sdk) {
        await handleSdkEnrollment(request, response, dependencies.sdk);
        return;
      }
      if (request.method === "POST" && request.url === "/v1/events/batch" && dependencies.sdk) {
        await handleSdkBatch(request, response, dependencies.sdk);
        return;
      }
      if (request.method === "POST" && request.url === "/v1/privacy/on-device" && dependencies.sdk) {
        await handleDevicePrivacy(request, response, dependencies.sdk);
        return;
      }
      if (request.method === "POST" && request.url === "/v1/admin/tracking-links") {
        if (dependencies.adminBucket && !dependencies.adminBucket.allow()) {
          response.writeHead(429, { "retry-after": "1" });
          response.end();
          return;
        }
        const identity = await verifyAdminKey(
          dependencies.pool,
          { tenantId: dependencies.maxConfig.tenantId, appId: dependencies.maxConfig.appId },
          typeof request.headers.authorization === "string" ? request.headers.authorization : undefined,
        );
        if (!identity) {
          response.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
          response.end('{"error":"unauthorized"}\n');
          return;
        }
        try {
          const result = await createTrackingLink({
            pool: dependencies.pool,
            tenantId: identity.tenantId,
            appId: identity.appId,
            allowedOrigins: dependencies.trackingDestinationAllowlist ?? [],
            body: await jsonBody(request) as Record<string, unknown>,
          });
          response.writeHead(201, { "content-type": "application/json", "cache-control": "no-store" });
          response.end(`${JSON.stringify(result)}\n`);
        } catch (error) {
          response.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" });
          response.end(`${JSON.stringify({ error: error instanceof Error ? error.message : "tracking_link_invalid" })}\n`);
        }
        return;
      }
      if (request.method === "POST" && request.url === "/v1/admin/privacy-requests") {
        if (dependencies.adminBucket && !dependencies.adminBucket.allow()) {
          response.writeHead(429, { "retry-after": "1" });
          response.end();
          return;
        }
        const identity = await verifyAdminKey(
          dependencies.pool,
          { tenantId: dependencies.maxConfig.tenantId, appId: dependencies.maxConfig.appId },
          typeof request.headers.authorization === "string" ? request.headers.authorization : undefined,
        );
        if (!identity) {
          response.writeHead(401, { "content-type": "application/json" });
          response.end('{"error":"unauthorized"}\n');
          return;
        }
        try {
          const result = await executePrivacyRequest(
            dependencies.pool,
            identity,
            await jsonBody(request) as PrivacyRequestBody,
            dependencies.payloadStore,
          );
          response.writeHead(201, { "content-type": "application/json", "cache-control": "no-store" });
          response.end(`${JSON.stringify(result)}\n`);
        } catch (error) {
          const status = Number((error as { statusCode?: number }).statusCode ?? (error instanceof SyntaxError ? 400 : 500));
          const code = error instanceof Error ? error.message : "privacy_request_failed";
          response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
          response.end(`${JSON.stringify({ error: code })}\n`);
        }
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"error":"not_found"}\n');
    })().catch((error) => {
      console.error(`Request failed: ${error instanceof Error ? error.message : "unknown error"}`);
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
      response.end('{"error":"internal_error"}\n');
    });
  };
}
