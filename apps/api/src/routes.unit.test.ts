import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchRoute, routes } from "./routes.js";

describe("declarative API route security", () => {
  it("C04 keeps cookie and bearer credentials in disjoint namespaces", () => {
    for (const route of routes) {
      if (route.pattern.test("/v1/probe")) assert.notEqual(route.auth, "dashboard_session");
      if (route.pattern.test("/dashboard/probe")) assert.notEqual(route.auth, "admin_bearer");
      if (route.handler.startsWith("dashboard_")) assert.notEqual(route.auth, "admin_bearer");
      if (route.handler !== "max_ingest" && route.pattern.source.startsWith("^\\/v1")) {
        assert.notEqual(route.auth, "dashboard_session");
      }
    }
  });

  it("C03 declares every read-only route without mutation authority", () => {
    assert.equal(routes.filter((route) => !route.mutates).every((route) => route.method === "GET"), true);
    assert.equal(routes.find((route) => route.handler === "max_ingest")?.mutates, true);
  });

  it("matches exact route methods and paths", () => {
    assert.equal(matchRoute("GET", "/v1/reports/metrics")?.handler, "report_metrics");
    assert.equal(matchRoute("POST", "/v1/reports/metrics"), undefined);
    assert.equal(matchRoute("GET", "/dashboard/app.css")?.handler, "dashboard_css");
    assert.equal(matchRoute("GET", "/v1/admin/tracking-links")?.handler, "admin_tracking_links_list");
    assert.equal(matchRoute("POST", "/v1/admin/tracking-links")?.handler, "admin_tracking_links");
    assert.equal(matchRoute("GET", "/dashboard/apps/app-a/tracking-links")?.handler, "dashboard_tracking_links_list");
    assert.equal(matchRoute("POST", "/dashboard/apps/app-a/tracking-links")?.handler, "dashboard_tracking_links_create");
    assert.equal(matchRoute("POST", "/.well-known/skadnetwork/report-attribution/")?.handler, "apple_skan_postback");
    assert.equal(matchRoute("POST", "/.well-known/appattribution/report-attribution/")?.handler, "apple_aak_postback");
    assert.equal(matchRoute("GET", "/.well-known/skadnetwork/report-attribution/"), undefined);
    assert.equal(matchRoute("POST", "/.well-known/skadnetwork/report-attribution"), undefined);
    assert.equal(matchRoute("POST", "/v1/admin/apps/app-a/apple-registration")?.handler, "admin_apple_registration");
    assert.equal(matchRoute("POST", "/v1/admin/apps/app-a/conversion-schemas")?.handler, "admin_conversion_schema");
  });
});
