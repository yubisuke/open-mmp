export type RouteAuth = "public" | "admin_bearer" | "sdk_hmac" | "dashboard_session";

export type RouteDefinition = {
  readonly id: string;
  readonly method: "GET" | "POST";
  readonly pattern: RegExp;
  readonly auth: RouteAuth;
  readonly mutates: boolean;
};

export const routes: readonly RouteDefinition[] = [
  { id: "health", method: "GET", pattern: /^\/health$/, auth: "public", mutates: false },
  { id: "max_ingest", method: "GET", pattern: /^\/v1\/ingest\/max\/[^/]+$/, auth: "public", mutates: true },
  { id: "report_metrics", method: "GET", pattern: /^\/v1\/reports\/metrics$/, auth: "admin_bearer", mutates: false },
  { id: "report_records", method: "GET", pattern: /^\/v1\/reports\/records$/, auth: "admin_bearer", mutates: false },
  { id: "audit_differences", method: "GET", pattern: /^\/v1\/audit\/differences$/, auth: "admin_bearer", mutates: false },
  { id: "sdk_enrollment", method: "POST", pattern: /^\/v1\/installations$/, auth: "sdk_hmac", mutates: true },
  { id: "sdk_batch", method: "POST", pattern: /^\/v1\/events\/batch$/, auth: "sdk_hmac", mutates: true },
  { id: "device_privacy", method: "POST", pattern: /^\/v1\/privacy\/on-device$/, auth: "sdk_hmac", mutates: true },
  { id: "admin_apps_list", method: "GET", pattern: /^\/v1\/admin\/apps$/, auth: "admin_bearer", mutates: false },
  { id: "admin_apps_create", method: "POST", pattern: /^\/v1\/admin\/apps$/, auth: "admin_bearer", mutates: true },
  { id: "admin_tracking_links", method: "POST", pattern: /^\/v1\/admin\/tracking-links$/, auth: "admin_bearer", mutates: true },
  { id: "admin_privacy", method: "POST", pattern: /^\/v1\/admin\/privacy-requests$/, auth: "admin_bearer", mutates: true },
  { id: "dashboard_root", method: "GET", pattern: /^\/dashboard\/?$/, auth: "public", mutates: false },
  { id: "dashboard_css", method: "GET", pattern: /^\/dashboard\/app\.css$/, auth: "public", mutates: false },
  { id: "dashboard_login", method: "POST", pattern: /^\/dashboard\/session$/, auth: "public", mutates: true },
  { id: "dashboard_logout", method: "POST", pattern: /^\/dashboard\/session\/delete$/, auth: "dashboard_session", mutates: true },
] as const;

export function matchRoute(method: string | undefined, pathname: string): RouteDefinition | undefined {
  return routes.find((route) => route.method === method && route.pattern.test(pathname));
}
