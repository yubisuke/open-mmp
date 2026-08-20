export type RouteAuth = "public" | "admin_bearer" | "sdk_hmac" | "dashboard_session";

export type RouteHandler =
  | "health"
  | "max_ingest"
  | "report_metrics"
  | "report_records"
  | "audit_differences"
  | "sdk_enrollment"
  | "sdk_batch"
  | "device_privacy"
  | "admin_apps_list"
  | "admin_apps_create"
  | "admin_tracking_links_list"
  | "admin_tracking_links"
  | "admin_privacy"
  | "dashboard_root"
  | "dashboard_css"
  | "dashboard_login"
  | "dashboard_logout"
  | "dashboard_app"
  | "dashboard_export"
  | "dashboard_differences"
  | "dashboard_tracking_links_list"
  | "dashboard_tracking_links_create"
  | "dashboard_apps_create";

export type RouteDefinition = {
  readonly method: "GET" | "POST";
  readonly pattern: RegExp;
  readonly auth: RouteAuth;
  readonly mutates: boolean;
  readonly handler: RouteHandler;
};

export const routes: readonly RouteDefinition[] = [
  { handler: "health", method: "GET", pattern: /^\/health$/, auth: "public", mutates: false },
  { handler: "max_ingest", method: "GET", pattern: /^\/v1\/ingest\/max\/[^/]+$/, auth: "public", mutates: true },
  { handler: "report_metrics", method: "GET", pattern: /^\/v1\/reports\/metrics$/, auth: "admin_bearer", mutates: false },
  { handler: "report_records", method: "GET", pattern: /^\/v1\/reports\/records$/, auth: "admin_bearer", mutates: false },
  { handler: "audit_differences", method: "GET", pattern: /^\/v1\/audit\/differences$/, auth: "admin_bearer", mutates: false },
  { handler: "sdk_enrollment", method: "POST", pattern: /^\/v1\/installations$/, auth: "sdk_hmac", mutates: true },
  { handler: "sdk_batch", method: "POST", pattern: /^\/v1\/events\/batch$/, auth: "sdk_hmac", mutates: true },
  { handler: "device_privacy", method: "POST", pattern: /^\/v1\/privacy\/on-device$/, auth: "sdk_hmac", mutates: true },
  { handler: "admin_apps_list", method: "GET", pattern: /^\/v1\/admin\/apps$/, auth: "admin_bearer", mutates: false },
  { handler: "admin_apps_create", method: "POST", pattern: /^\/v1\/admin\/apps$/, auth: "admin_bearer", mutates: true },
  { handler: "admin_tracking_links_list", method: "GET", pattern: /^\/v1\/admin\/tracking-links$/, auth: "admin_bearer", mutates: false },
  { handler: "admin_tracking_links", method: "POST", pattern: /^\/v1\/admin\/tracking-links$/, auth: "admin_bearer", mutates: true },
  { handler: "admin_privacy", method: "POST", pattern: /^\/v1\/admin\/privacy-requests$/, auth: "admin_bearer", mutates: true },
  { handler: "dashboard_root", method: "GET", pattern: /^\/dashboard\/?$/, auth: "public", mutates: false },
  { handler: "dashboard_css", method: "GET", pattern: /^\/dashboard\/app\.css$/, auth: "public", mutates: false },
  { handler: "dashboard_login", method: "POST", pattern: /^\/dashboard\/session$/, auth: "public", mutates: true },
  { handler: "dashboard_logout", method: "POST", pattern: /^\/dashboard\/session\/delete$/, auth: "dashboard_session", mutates: true },
  { handler: "dashboard_export", method: "GET", pattern: /^\/dashboard\/apps\/[^/]+\/cohorts\.csv$/, auth: "dashboard_session", mutates: false },
  { handler: "dashboard_differences", method: "GET", pattern: /^\/dashboard\/apps\/[^/]+\/differences$/, auth: "dashboard_session", mutates: false },
  { handler: "dashboard_tracking_links_list", method: "GET", pattern: /^\/dashboard\/apps\/[^/]+\/tracking-links$/, auth: "dashboard_session", mutates: false },
  { handler: "dashboard_tracking_links_create", method: "POST", pattern: /^\/dashboard\/apps\/[^/]+\/tracking-links$/, auth: "dashboard_session", mutates: true },
  { handler: "dashboard_app", method: "GET", pattern: /^\/dashboard\/apps\/[^/]+$/, auth: "dashboard_session", mutates: false },
  { handler: "dashboard_apps_create", method: "POST", pattern: /^\/dashboard\/apps$/, auth: "dashboard_session", mutates: true },
] as const;

export function matchRoute(method: string | undefined, pathname: string): RouteDefinition | undefined {
  return routes.find((route) => route.method === method && route.pattern.test(pathname));
}
