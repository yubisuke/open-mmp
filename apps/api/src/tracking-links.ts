import type { Pool } from "pg";
import { assertAllowedDestination, randomSlug } from "@open-mmp/redirector-core";
import { uuidV7, withTenant } from "@open-mmp/runtime";

type Any = Record<string, any>;

export async function createTrackingLink(input: {
  pool: Pool;
  tenantId: string;
  appId: string;
  allowedOrigins: readonly string[];
  body: Any;
  now?: string;
}): Promise<Any> {
  const destinationKind = input.body.destination_kind;
  if (destinationKind !== "play_store" && destinationKind !== "custom_https") throw new Error("destination_kind_invalid");
  const destination = assertAllowedDestination(String(input.body.destination_url ?? ""), input.allowedOrigins);
  if (destinationKind === "play_store"
    && !(destination.protocol === "market:" || (destination.hostname === "play.google.com" && destination.pathname === "/store/apps/details"))) {
    throw new Error("play_destination_required");
  }
  if (destinationKind === "custom_https" && destination.protocol !== "https:") throw new Error("custom_https_required");
  const packageName = destinationKind === "play_store" ? String(input.body.play_package_name ?? "") : undefined;
  if (destinationKind === "play_store" && !/^[A-Za-z][A-Za-z0-9_.]{2,254}$/.test(packageName!)) {
    throw new Error("play_package_name_invalid");
  }
  const now = input.now ?? new Date().toISOString();
  const artifact = {
    tracking_link_id: `tracking-link:${uuidV7()}`,
    tenant_id: input.tenantId,
    app_id: input.appId,
    slug: randomSlug(),
    destination_kind: destinationKind,
    destination_url: destination.toString(),
    ...(packageName ? { play_package_name: packageName } : {}),
    ...(input.body.network ? { network: String(input.body.network) } : {}),
    ...(input.body.site_id ? { site_id: String(input.body.site_id) } : {}),
    ...(input.body.campaign_id ? { campaign_id: String(input.body.campaign_id) } : {}),
    ...(input.body.ad_group_id ? { ad_group_id: String(input.body.ad_group_id) } : {}),
    ...(input.body.creative_id ? { creative_id: String(input.body.creative_id) } : {}),
    created_at: now,
    status: "active",
  };
  await withTenant(input.pool, input.tenantId, async (client) => {
    await client.query(
      `INSERT INTO control.tracking_links (
        tracking_link_id, tenant_id, app_id, slug, destination_kind, destination_url,
        play_package_name, network, site_id, campaign_id, ad_group_id, creative_id,
        created_at, artifact
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
      [artifact.tracking_link_id, input.tenantId, input.appId, artifact.slug,
        destinationKind, artifact.destination_url, packageName ?? null,
        artifact.network ?? null, artifact.site_id ?? null, artifact.campaign_id ?? null,
        artifact.ad_group_id ?? null, artifact.creative_id ?? null, now, JSON.stringify(artifact)],
    );
    await client.query(
      `INSERT INTO control.tracking_link_states (
        tracking_link_id, tenant_id, app_id, status, changed_at, artifact
      ) VALUES ($1,$2,$3,'active',$4,$5::jsonb)`,
      [artifact.tracking_link_id, input.tenantId, input.appId, now,
        JSON.stringify({ tracking_link_id: artifact.tracking_link_id, status: "active", changed_at: now })],
    );
  });
  return artifact;
}
