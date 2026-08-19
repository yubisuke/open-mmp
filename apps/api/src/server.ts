import { createServer } from "node:http";

const port = Number(process.env.OPENMMP_API_PORT ?? "8080");
const adminKey = process.env.OPENMMP_ADMIN_KEY;
const baseUrl = process.env.OPENMMP_PUBLIC_BASE_URL ?? `http://localhost:${port}`;
const maxPathSecret = process.env.OPENMMP_MAX_PATH_SECRET;
const maxEventToken = process.env.OPENMMP_MAX_EVENT_TOKEN_ALL;

if (!adminKey || !maxPathSecret || !maxEventToken) {
  throw new Error("bootstrap secrets are missing; run npm run bootstrap");
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"ok"}\n');
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end('{"error":"not_found"}\n');
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Open MMP API listening on ${port}`);
  console.log(`Open MMP admin key: ${adminKey}`);
  console.log(`Open MMP MAX postback URL template: ${baseUrl}/v1/ingest/max/${maxPathSecret}?event_token_all=${maxEventToken}&event_id={EVENT_ID}`);
});
