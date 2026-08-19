import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { evaluate, jcs, roundHalfEven, sha256 } from "@open-mmp/attribution-core";
import { createAppPool, createSeedPool, requireEnvironment, withTenant } from "@open-mmp/runtime";
import { Client, type Pool } from "pg";
import { ingestFixture } from "./ingestion.js";
import { computeSqlMetricRuns, computeSqlMetricRunsWithClient } from "./metrics/cohort.js";

type Any = Record<string, any>;
const fixtureName = "33-stage-b-cohort-metrics";
const fixtureDirectory = join(process.cwd(), "fixtures", "v0.2", fixtureName);
const input: Any = JSON.parse(readFileSync(join(fixtureDirectory, "input.json"), "utf8"));
const goldenPath = join(fixtureDirectory, "expected_metric_runs.json");
const goldenBefore = readFileSync(goldenPath);
const oracle = evaluate(input).metric_runs;

let appPool: Pool;
let seedPool: Pool;
let sqlRuns: Any[];
let persistedRuns: Any[];

describe("M1b SQL metric parity", { concurrency: false }, () => {
  before(async () => {
    appPool = createAppPool();
    seedPool = createSeedPool();
    await ingestFixture(fixtureName, input, appPool, seedPool);
    sqlRuns = await computeSqlMetricRuns(appPool, input, true);
    const scope = input.server_context;
    const ids = sqlRuns.map((run) => run.metric_run_id);
    persistedRuns = await withTenant(appPool, scope.tenant_id, async (client) => {
      const result = await client.query<{ artifact: Any }>(
        `SELECT artifact FROM ledger.metric_runs
         WHERE tenant_id=$1 AND app_id=$2 AND metric_run_id = ANY($3::text[])
         ORDER BY metric_run_id`,
        [scope.tenant_id, scope.app_id, ids],
      );
      return result.rows.map((row) => row.artifact);
    });
  });

  after(async () => {
    await appPool?.end();
    await seedPool?.end();
  });

  it("B2 SQL cohort metric_runs are JCS-byte-identical to evaluator", () => {
    assert.equal(sqlRuns.length, 7);
    assert.equal(Buffer.compare(Buffer.from(jcs(sqlRuns)), Buffer.from(jcs(oracle))), 0);
    assert.equal(Buffer.compare(Buffer.from(jcs(persistedRuns)), Buffer.from(jcs(oracle))), 0);
  });

  it("B3 half_even_div matches TypeScript tie vectors", async () => {
    const vectors = [
      { numerator: 1n, denominator: 2n },
      { numerator: 3n, denominator: 2n },
      { numerator: 5n, denominator: 2n },
      { numerator: -1n, denominator: 2n },
      { numerator: -3n, denominator: 2n },
      { numerator: 1n, denominator: 3n },
      { numerator: 2n, denominator: 3n },
    ];
    const actual = await withTenant(appPool, input.server_context.tenant_id, async (client) => {
      const result = await client.query<{ value: string }>(
        `SELECT ledger.half_even_div(item.numerator, item.denominator)::text AS value
         FROM jsonb_to_recordset($1::jsonb) AS item(numerator numeric, denominator numeric)`,
        [JSON.stringify(vectors.map(({ numerator, denominator }) => ({
          numerator: numerator.toString(),
          denominator: denominator.toString(),
        })))],
      );
      return result.rows.map((row) => row.value);
    });
    assert.deepEqual(actual, vectors.map(({ numerator, denominator }) =>
      roundHalfEven(numerator, denominator).toString()));
    assert.deepEqual(actual.slice(0, 3), ["0", "2", "2"]);
  });

  it("B3 half-up mutation fails SQL/evaluator parity and rolls back", async () => {
    const client = new Client({
      connectionString: requireEnvironment(
        "OPENMMP_MIGRATION_DATABASE_URL",
        process.env.OPENMMP_MIGRATION_DATABASE_URL,
      ),
    });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE openmmp_owner");
      await client.query("SELECT set_config('open_mmp.tenant_id', $1, true)", [input.server_context.tenant_id]);
      await client.query(`
        CREATE OR REPLACE FUNCTION ledger.half_even_div(numerator numeric, denominator numeric)
        RETURNS numeric
        LANGUAGE sql
        IMMUTABLE
        STRICT
        PARALLEL SAFE
        AS $$
          SELECT CASE WHEN numerator < 0 THEN -1 ELSE 1 END *
            (trunc(abs(numerator) / denominator) +
             CASE WHEN mod(abs(numerator), denominator) * 2 >= denominator THEN 1 ELSE 0 END)
        $$
      `);
      const halfUpRuns = await computeSqlMetricRunsWithClient(client, input, false);
      assert.notEqual(jcs(halfUpRuns), jcs(oracle));
      const ltv = halfUpRuns.find((run) => run.metric_name === "cohort_ltv_d7_usd");
      assert.equal(ltv?.value_unscaled, "150000003");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }

    const restored = await computeSqlMetricRuns(appPool, input, false);
    assert.equal(jcs(restored), jcs(oracle));
    assert.equal(sha256(readFileSync(goldenPath)), sha256(goldenBefore));
    assert.equal(Buffer.compare(readFileSync(goldenPath), goldenBefore), 0);
  });
});
