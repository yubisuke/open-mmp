import { createAppPool, withTenant } from "@open-mmp/runtime";

const tenantId = process.env.OPENMMP_MAX_TENANT_ID ?? "tenant-local";
const appId = process.env.OPENMMP_MAX_APP_ID ?? "app-local";
const pool = createAppPool();
try {
  const summary = await withTenant(pool, tenantId, async (client) => {
    const result = await client.query(`SELECT
      (SELECT count(*) FROM ledger.raw_records WHERE app_id=$1)::int AS raw_records,
      (SELECT count(*) FROM ledger.logical_events WHERE app_id=$1)::int AS logical_events,
      (SELECT count(*) FROM ledger.attribution_results WHERE app_id=$1)::int AS attributions,
      (SELECT count(*) FROM ledger.metric_runs WHERE app_id=$1)::int AS metric_runs,
      (SELECT count(*) FROM ledger.cost_records_current WHERE app_id=$1)::int AS current_cost_rows`, [appId]);
    return result.rows[0];
  });
  console.log(JSON.stringify({ tenant_id: tenantId, app_id: appId, ...summary }, null, 2));
} finally {
  await pool.end();
}
