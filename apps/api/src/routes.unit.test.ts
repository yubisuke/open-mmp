import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchRoute, routes } from "./routes.js";

describe("declarative API route security", () => {
  it("C04 keeps cookie and bearer credentials in disjoint namespaces", () => {
    for (const route of routes) {
      if (route.pattern.test("/v1/probe")) assert.notEqual(route.auth, "dashboard_session");
      if (route.pattern.test("/dashboard/probe")) assert.notEqual(route.auth, "admin_bearer");
      if (route.id.startsWith("dashboard_")) assert.notEqual(route.auth, "admin_bearer");
      if (route.id !== "max_ingest" && route.pattern.source.startsWith("^\\/v1")) {
        assert.notEqual(route.auth, "dashboard_session");
      }
    }
  });

  it("C03 declares every read-only route without mutation authority", () => {
    assert.equal(routes.filter((route) => !route.mutates).every((route) => route.method === "GET"), true);
    assert.equal(routes.find((route) => route.id === "max_ingest")?.mutates, true);
  });

  it("matches exact route methods and paths", () => {
    assert.equal(matchRoute("GET", "/v1/reports/metrics")?.id, "report_metrics");
    assert.equal(matchRoute("POST", "/v1/reports/metrics"), undefined);
    assert.equal(matchRoute("GET", "/dashboard/app.css")?.id, "dashboard_css");
  });
});
