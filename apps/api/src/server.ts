import { createServer } from "node:http";
import { createAppPool, EnvironmentSecretStore, LocalPayloadStore } from "@open-mmp/runtime";
import { assertSafeMaxTemplate, receiveMax, type MaxReceiverConfig } from "./max-receiver.js";

const port = Number(process.env.OPENMMP_API_PORT ?? "8080");
const baseUrl = process.env.OPENMMP_PUBLIC_BASE_URL ?? `http://localhost:${port}`;
const secrets = new EnvironmentSecretStore({
  OPENMMP_ADMIN_KEY: { value: process.env.OPENMMP_ADMIN_KEY, file: process.env.OPENMMP_ADMIN_KEY_FILE },
  OPENMMP_MAX_PATH_SECRET: { value: process.env.OPENMMP_MAX_PATH_SECRET, file: process.env.OPENMMP_MAX_PATH_SECRET_FILE },
  OPENMMP_MAX_EVENT_KEY: { value: process.env.OPENMMP_MAX_EVENT_KEY, file: process.env.OPENMMP_MAX_EVENT_KEY_FILE },
});
const adminKey = secrets.require("OPENMMP_ADMIN_KEY");
const maxPathSecret = secrets.require("OPENMMP_MAX_PATH_SECRET");
const maxEventKey = secrets.require("OPENMMP_MAX_EVENT_KEY");
const pool = createAppPool();
const payloadStore = new LocalPayloadStore(process.env.OPENMMP_PAYLOAD_STORE_DIR ?? ".openmmp/payloads");
const maxConfig: MaxReceiverConfig = {
  tenantId: process.env.OPENMMP_MAX_TENANT_ID ?? "tenant-local",
  appId: process.env.OPENMMP_MAX_APP_ID ?? "app-local",
  pathSecret: maxPathSecret,
  eventKey: maxEventKey,
  tokenMode: (process.env.OPENMMP_MAX_TOKEN_MODE as MaxReceiverConfig["tokenMode"] | undefined) ?? "all_with_event_fallback",
  maxParameters: Number(process.env.OPENMMP_MAX_PARAMETER_LIMIT ?? "40"),
  maxQueryBytes: Number(process.env.OPENMMP_MAX_QUERY_BYTES ?? "8192"),
};
const maxTemplate = `${baseUrl}/v1/ingest/max/${maxPathSecret}?event_token_all={EVENT_TOKEN_ALL}&event_id={EVENT_ID}&revenue={REVENUE}&ts={TS}`;
assertSafeMaxTemplate(maxTemplate);

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"ok"}\n');
    return;
  }
  if (request.method === "GET" && request.url?.startsWith(`/v1/ingest/max/${maxPathSecret}?`)) {
    await receiveMax(request, response, { pool, payloadStore, config: maxConfig });
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end('{"error":"not_found"}\n');
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Open MMP API listening on ${port}`);
  console.log(`Open MMP admin key: ${adminKey}`);
  console.log(`Open MMP MAX postback URL template: ${maxTemplate}`);
});
