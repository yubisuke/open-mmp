import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { describe, it } from "node:test";
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { canonicalize } from "json-canonicalize";
import { evaluate, sha256, TimestampInvalidError } from "./evaluator.js";

type Any = Record<string, any>;
const root = process.cwd();
const DRAFT = "https://json-schema.org/draft/2020-12/schema";

function fail(message: string): never {
  throw new Error(message);
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function json(path: string): Any {
  return JSON.parse(readFileSync(path, "utf8"));
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

function equal(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}

function unique(values: string[], label: string): void {
  check(new Set(values).size === values.length, `duplicate ${label}`);
}

function fixRefs(value: Any): Any {
  if (Array.isArray(value)) return value.map(fixRefs);
  if (!value || typeof value !== "object") return value;
  const output: Any = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = key === "$ref" && typeof child === "string"
      ? child
        .replace("../common.schema.json", "urn:open-mmp:schema:common:v0.1")
        .replace("common.schema.json", "urn:open-mmp:schema:common:v0.1")
      : fixRefs(child as Any);
  }
  return output;
}

function assertClosedObjects(value: Any, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertClosedObjects(child, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (value.type === "object" && value.additionalProperties === undefined) {
    fail(`open object without an explicit policy: ${path}`);
  }
  for (const [key, child] of Object.entries(value)) {
    if (key !== "extensions") assertClosedObjects(child as Any, `${path}.${key}`);
  }
}

const schemaPaths = files(join(root, "schemas")).filter((path) => path.endsWith(".json")).sort();
const schemaValues = schemaPaths.map((path) => ({ path, value: json(path) }));
const schemaIds = schemaValues.map(({ value }) => value.$id as string);
unique(schemaIds, "schema $id");
for (const { path, value } of schemaValues) {
  check(value.$schema === DRAFT, `wrong schema dialect: ${relative(root, path)}`);
  check(/^urn:open-mmp:schema:[a-z0-9-]+:v0\.1$/.test(value.$id), `unstable schema id: ${relative(root, path)}`);
  assertClosedObjects(value, relative(root, path));
}

const Ajv2020 = Ajv2020Module as unknown as new (options: Any) => {
  addSchema(schema: unknown): void;
  getSchema(id: string): (((value: unknown) => boolean) & { errors?: unknown }) | undefined;
  errorsText(errors: unknown): string;
};
const ajv = new Ajv2020({ allErrors: true, strict: false });
const addFormats = addFormatsModule as unknown as (instance: unknown) => void;
addFormats(ajv);
for (const { value } of schemaValues) ajv.addSchema(fixRefs(value));
for (const id of schemaIds) check(ajv.getSchema(id), `schema did not compile: ${id}`);

const registries = {
  events: json(join(root, "registries", "event-names-v0.1.json")),
  reasons: json(join(root, "registries", "reason-codes-v0.1.json")),
  producers: json(join(root, "registries", "producer-values-v0.1.json")),
  differences: json(join(root, "registries", "difference-reasons-v0.1.json")),
  states: json(join(root, "registries", "state-transitions-v0.1.json")),
  compatibility: json(join(root, "registries", "compatibility-v0.1.json")),
  matchingKeys: json(join(root, "registries", "matching-key-types-v0.1.json")),
};
for (const [name, value] of Object.entries(registries)) {
  check(value.contract_version === "0.1.0", `registry version: ${name}`);
}
const eventNames: string[] = registries.events.event_names;
unique(eventNames, "event name");
check(eventNames.length === 8, "event-name registry must contain the eight v0.1 events");
const attributionReasons = new Set<string>(registries.reasons.attribution);
const rejectionReasons = new Set<string>(registries.reasons.rejection);
const consentReasons = new Set<string>(registries.reasons.consent_decision);
const correctionReasons = new Set<string>(registries.reasons.correction);
const fraudReasons = new Set<string>(registries.reasons.fraud_public_categories);
const differenceReasons = new Set<string>(registries.differences.reasons);
for (const [name, values] of Object.entries(registries.reasons).filter(([name]) => name !== "contract_version")) {
  if (Array.isArray(values)) unique(values, `reason code in ${name}`);
}
unique(registries.differences.reasons, "difference reason");
const producerValues: string[] = registries.producers.values.map((entry: Any) => entry.value);
unique(producerValues, "producer");
const producerAllowed = (value: string) =>
  producerValues.includes(value) || (/^import:[a-z0-9-]+$/.test(value) && producerValues.includes("import:<provider>"));
const matchingDefinitions = new Map<string, Any>(registries.matchingKeys.types.map((entry: Any) => [entry.type, entry]));
unique([...matchingDefinitions.keys()], "matching-key type");
const stateAxes = registries.states.axes;
for (const axis of ["ingestion", "duplicate_resolution", "timeliness", "lifecycle", "attribution_finality", "privacy_request"]) {
  check(stateAxes[axis], `missing state axis: ${axis}`);
  unique(stateAxes[axis].states, `state in ${axis}`);
  const states = new Set<string>(stateAxes[axis].states);
  const edges = stateAxes[axis].transitions.map((edge: string[]) => edge.join("->"));
  unique(edges, `transition in ${axis}`);
  for (const edge of stateAxes[axis].transitions) {
    check(edge.length === 2 && states.has(edge[0]) && states.has(edge[1]), `invalid transition endpoint in ${axis}`);
  }
  for (const terminal of stateAxes[axis].terminal) check(states.has(terminal), `invalid terminal state in ${axis}`);
}
const compatibility = registries.compatibility.attribution;
unique(compatibility.map((entry: Any) => `${entry.subject_scope}|${entry.method}|${entry.model}`), "attribution compatibility row");

const outputSchemaIds: Record<string, string> = {
  raw_records: "urn:open-mmp:schema:raw-record:v0.1",
  deliveries: "urn:open-mmp:schema:event-delivery:v0.1",
  logical_events: "urn:open-mmp:schema:logical-event:v0.1",
  corrections: "urn:open-mmp:schema:correction:v0.1",
  privacy_requests: "urn:open-mmp:schema:privacy-request:v0.1",
  privacy_tombstones: "urn:open-mmp:schema:privacy-tombstone:v0.1",
  attributions: "urn:open-mmp:schema:attribution-result:v0.1",
  metric_runs: "urn:open-mmp:schema:metric-run:v0.1",
  fraud_decisions: "urn:open-mmp:schema:fraud-decision:v0.1",
  rejections: "urn:open-mmp:schema:rejection:v0.1",
  reconciliation: "urn:open-mmp:schema:reconciliation-result:v0.1",
};
const expectedFiles: Record<string, string> = Object.fromEntries(
  Object.keys(outputSchemaIds).map((name) => [name, `expected_${name}.json`]),
);
const fixtureValidator = ajv.getSchema("urn:open-mmp:schema:fixture-input:v0.1");
check(fixtureValidator, "fixture schema missing");

function fixtureAttempts(input: Any): Any[] {
  if (input.batches) {
    return input.batches.flatMap((batch: Any) =>
      batch.records.map((record: Any) => ({ server: batch.server_context, record })),
    );
  }
  return input.records.map((record: Any) => ({ server: input.server_context, record }));
}

function reorderedInput(input: Any): Any {
  const reordered = structuredClone(input);
  if (reordered.records) reordered.records.reverse();
  if (reordered.batches) {
    reordered.batches.reverse();
    for (const batch of reordered.batches) batch.records.reverse();
  }
  return reordered;
}

type PythonBatchResult =
  | { ok: true; output: Any }
  | { ok: false; error: { name: string; message: string; exit_code: number } };

function pythonBatch(inputs: Any[]): PythonBatchResult[] {
  return JSON.parse(execFileSync("python", [join(root, "tools", "python_evaluator.py"), "--batch"], {
    input: JSON.stringify(inputs),
    encoding: "utf8",
  }));
}

function pythonOutputs(inputs: Any[]): Any[] {
  return pythonBatch(inputs).map((result, index) => {
    if (!result.ok) fail(`Python batch item ${index} failed: ${result.error.message}`);
    return result.output;
  });
}

function validateMatchingKey(value: Any, label: string): void {
  const definition = matchingDefinitions.get(value.type);
  check(definition, `unknown matching key in ${label}: ${value.type}`);
  for (const field of ["scope", "normalization", "cardinality", "protected"]) {
    check(value[field] === definition[field], `matching-key metadata mismatch in ${label}: ${value.type}.${field}`);
  }
}

function validateRegistryReferences(output: Any, label: string): void {
  for (const record of output.raw_records) {
    check(eventNames.includes(record.event_name), `unknown raw event_name in ${label}`);
    check(producerAllowed(record.producer), `unknown producer in ${label}`);
    check(consentReasons.has(record.consent_decision_reason_code), `unknown raw consent reason in ${label}`);
  }
  for (const delivery of output.deliveries) {
    check(consentReasons.has(delivery.consent_decision_reason_code), `unknown delivery consent reason in ${label}`);
    if (delivery.reason_code) check(rejectionReasons.has(delivery.reason_code), `unknown delivery reason in ${label}`);
  }
  for (const event of output.logical_events) check(eventNames.includes(event.event_name), `unknown logical event in ${label}`);
  for (const correction of output.corrections) check(correctionReasons.has(correction.correction_reason), `unknown correction reason in ${label}`);
  for (const attribution of output.attributions) {
    check(attributionReasons.has(attribution.reason_code), `unknown attribution reason in ${label}`);
    const compatible = compatibility.some((row: Any) =>
      row.subject_scope === attribution.subject_scope && row.method === attribution.method &&
      row.model === attribution.model && row.statuses.includes(attribution.status),
    );
    check(compatible, `incompatible attribution tuple in ${label}`);
    for (const evidence of attribution.evidence_refs) {
      check(evidence.tenant_id === attribution.tenant_id && evidence.app_id === attribution.app_id, `cross-scope attribution evidence in ${label}`);
    }
  }
  for (const run of output.metric_runs) {
    for (const evidence of run.evidence_refs) {
      check(typeof evidence.tenant_id === "string" && typeof evidence.app_id === "string", `unqualified metric evidence in ${label}`);
    }
  }
  for (const rejection of output.rejections) {
    check(rejectionReasons.has(rejection.reason_code), `unknown rejection reason in ${label}`);
    check(consentReasons.has(rejection.consent_decision_reason_code), `unknown rejection consent reason in ${label}`);
  }
  for (const fraud of output.fraud_decisions) check(fraudReasons.has(fraud.reason_code), `unknown fraud reason in ${label}`);
  for (const result of output.reconciliation) {
    check(differenceReasons.has(result.difference_reason_code), `unknown difference reason in ${label}`);
    result.matching_keys.forEach((entry: Any) => validateMatchingKey(entry, label));
  }
}

const fixtureRoot = join(root, "fixtures", "v0.1");
const fixtureDirs = readdirSync(fixtureRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(fixtureRoot, entry.name))
  .sort();
check(fixtureDirs.length === 19, `expected 19 fixture directories, found ${fixtureDirs.length}`);
const results = new Map<string, { input: Any; output: Any; python: Any }>();
let outputArtifactCount = 0;
const fixtureInputs = fixtureDirs.map((dir) => json(join(dir, "input.json")));
const fixturePythonOutputs = pythonOutputs(fixtureInputs);
for (const [index, dir] of fixtureDirs.entries()) {
  const name = basename(dir);
  const input = fixtureInputs[index];
  check(fixtureValidator(input), `fixture schema failure: ${name}: ${ajv.errorsText(fixtureValidator.errors)}`);
  for (const attempt of fixtureAttempts(input)) {
    const record = attempt.record;
    check(eventNames.includes(record.event_name), `unknown fixture event_name: ${name}`);
    check(producerAllowed(record.producer), `unknown fixture producer: ${name}`);
    const eventId = `urn:open-mmp:schema:event-${record.event_name.replaceAll("_", "-")}:v0.1`;
    const validator = ajv.getSchema(eventId);
    check(validator, `missing event schema: ${eventId}`);
    const event = { ...record.payload, event_name: record.event_name };
    check(validator(event), `event schema failure: ${name}/${record.record_id}: ${ajv.errorsText(validator.errors)}`);
  }
  for (const item of input.reconciliation_inputs) {
    item.matching_keys.forEach((entry: Any) => validateMatchingKey(entry, name));
    item.candidates.flatMap((candidate: Any) => candidate.matching_keys).forEach((entry: Any) => validateMatchingKey(entry, name));
  }
  const expected: Any = {};
  for (const [kind, fileName] of Object.entries(expectedFiles)) {
    const path = join(dir, fileName);
    expected[kind] = json(path);
    outputArtifactCount += 1;
    const validator = ajv.getSchema(outputSchemaIds[kind]);
    check(validator, `missing output schema for ${kind}`);
    for (const item of expected[kind]) {
      check(validator(item), `${kind} schema failure: ${name}: ${ajv.errorsText(validator.errors)}`);
    }
  }
  validateRegistryReferences(expected, name);
  const first = evaluate(input);
  const second = evaluate(JSON.parse(JSON.stringify(input)));
  check(equal(first, second), `nondeterministic TypeScript output: ${name}`);
  check(equal(first, evaluate(reorderedInput(input))), `input reorder changed semantic output: ${name}`);
  check(equal(first, expected), `reviewed golden mismatch: ${name}`);
  const python = fixturePythonOutputs[index];
  check(equal(first, python), `cross-language mismatch: ${name}`);
  results.set(name, { input, output: first, python });
}

function fixture(name: string): { input: Any; output: Any; python: Any } {
  const value = results.get(name);
  check(value, `missing fixture result: ${name}`);
  return value;
}

const scenarios: Array<[string, () => void]> = [
  ["01 valid Install Referrer", () => {
    const value = fixture("01-valid-install-referrer").output;
    check(value.attributions[0].status === "non_organic" && value.reconciliation[0].difference_reason_code === "matched", "scenario 01");
  }],
  ["02 organic no referrer", () => {
    const attr = fixture("02-organic-no-referrer").output.attributions[0];
    check(attr.status === "organic" && attr.reason_code === "no_referrer", "scenario 02");
  }],
  ["03 unknown click", () => {
    const value = fixture("03-unknown-click").output;
    check(value.attributions[0].status === "unattributed" && value.attributions[0].reason_code === "unknown_click_id", "scenario 03 attribution");
    check(value.reconciliation[0].difference_reason_code === "external_row_unmatched", "scenario 03 reconciliation");
  }],
  ["04 seven-day half-open boundary", () => {
    const attrs = Object.fromEntries(fixture("04-seven-day-boundaries").output.attributions.map((item: Any) => [item.attribution_id, item]));
    check(attrs["attr:install-before"].reason_code === "valid_install_referrer", "scenario 04 before");
    check(attrs["attr:install-exact"].reason_code === "window_expired", "scenario 04 exact");
    check(attrs["attr:install-after"].reason_code === "window_expired", "scenario 04 after");
  }],
  ["05 duplicate delivery", () => {
    const value = fixture("05-duplicate-delivery").output;
    check(value.raw_records.length === 1 && value.logical_events.length === 1 && value.deliveries.length === 2, "scenario 05 artifact counts");
    check(value.deliveries.some((item: Any) => item.duplicate_resolution === "duplicate_delivery"), "scenario 05 duplicate state");
  }],
  ["06 event-ID conflict", () => {
    const value = fixture("06-event-id-conflict").output;
    check(value.raw_records.length === 2 && value.logical_events.length === 1 && value.rejections.some((item: Any) => item.reason_code === "event_id_conflict" && item.retained === "protected_conflict_evidence"), "scenario 06");
  }],
  ["07 same ID across tenants", () => {
    const value = fixture("07-same-id-across-tenants").output;
    const shared = value.raw_records.filter((item: Any) => item.event_id === "shared-event-id");
    check(shared.length === 2 && new Set(shared.map((item: Any) => item.tenant_id)).size === 2, "scenario 07 independent tenants");
    check(value.rejections.some((item: Any) => item.record_id === "tenant-mismatch" && item.reason_code === "client_scope_mismatch"), "scenario 07 mismatch");
  }],
  ["08 late revenue and recalculation", () => {
    const { input, output } = fixture("08-late-ad-revenue");
    const initial = output.metric_runs.filter((item: Any) => item.metric_run_id.startsWith("run-08-initial"));
    const recalculated = output.metric_runs.filter((item: Any) => item.metric_run_id.startsWith("run-08-recalculated"));
    check(initial.length === 3 && initial.every((item: Any) => item.value_unscaled === "0"), "scenario 08 initial");
    check(recalculated.length === 3 && recalculated.every((item: Any) => item.supersedes_metric_run_id && item.value_unscaled !== "0"), "scenario 08 recalculation");
    check(input.records[1].payload.amount_unscaled === "123456789012345678" && input.records[1].payload.amount_scale === 18, "scenario 08 precision");
  }],
  ["09 UTC and JST calendar boundaries", () => {
    const metrics = fixture("09-utc-jst-calendar").output.metric_runs;
    check(metrics.find((item: Any) => item.metric_name.includes("_utc_")).value_unscaled === "0", "scenario 09 UTC");
    check(metrics.find((item: Any) => item.metric_name.includes("_jst_")).value_unscaled === "1000000", "scenario 09 JST");
    check(metrics.find((item: Any) => item.metric_name.includes("_24h_")).value_unscaled === "1000000", "scenario 09 24h");
  }],
  ["10 reinstall classification", () => {
    const attrs = Object.fromEntries(fixture("10-reinstall-redownload").output.attributions.map((item: Any) => [item.attribution_id, item]));
    check(attrs["attr:install-10b"].status === "non_organic" && attrs["attr:install-10b"].reason_code === "valid_install_referrer", "scenario 10 paid reinstall");
    check(attrs["attr:install-10c"].status === "organic" && attrs["attr:install-10c"].reason_code === "no_referrer", "scenario 10 no-referrer redownload");
  }],
  ["11 client clock skew", () => {
    const deliveries = Object.fromEntries(fixture("11-clock-skew").output.deliveries.map((item: Any) => [item.record_id, item]));
    check(deliveries["skew-exact"].clock_skew_suspected === false && deliveries["skew-over"].clock_skew_suspected === true, "scenario 11");
  }],
  ["12 authoritative server time", () => {
    const attrs = Object.fromEntries(fixture("12-authoritative-time").output.attributions.map((item: Any) => [item.attribution_id, item]));
    check(attrs["attr:install-device-cross"].reason_code === "valid_install_referrer", "scenario 12 device evidence");
    check(attrs["attr:install-missing-authority"].reason_code === "authoritative_time_missing", "scenario 12 missing");
    check(attrs["attr:install-invalid-authority"].reason_code === "authoritative_time_invalid", "scenario 12 invalid");
  }],
  ["13 unsupported referrer", () => {
    const reasons = new Set(fixture("13-referrer-unsupported").output.attributions.map((item: Any) => item.reason_code));
    check(reasons.has("install_referrer_unsupported") && reasons.has("install_referrer_unavailable"), "scenario 13");
  }],
  ["14 queued event after withdrawal", () => {
    const value = fixture("14-withdrawal-after-occurrence").output;
    check(value.rejections.some((item: Any) => item.record_id === "queued-before-withdrawal" && item.withdrawal_recognized_at), "scenario 14 default reject");
    check(value.raw_records.some((item: Any) => item.record_id === "queued-explicit-basis" && item.alternative_legal_basis_id === "basis-queued"), "scenario 14 configured basis");
    check(!value.raw_records.some((item: Any) => item.record_id === "queued-before-withdrawal"), "scenario 14 payload discard");
  }],
  ["15 post-withdrawal event and control", () => {
    const value = fixture("15-event-after-withdrawal").output;
    check(value.rejections.some((item: Any) => item.record_id === "event-after-withdrawal"), "scenario 15 reject");
    check(value.raw_records.some((item: Any) => item.record_id === "consent-control-after-withdrawal"), "scenario 15 control");
  }],
  ["16 out-of-order refund correction", () => {
    const corrections = fixture("16-correction-refund").output.corrections;
    check(corrections.some((item: Any) => item.corrects_record_id === "purchase-16" && item.correction_reason === "refund"), "scenario 16 refund");
    check(corrections.some((item: Any) => item.corrects_record_id === "purchase-16" && item.correction_type === "retraction"), "scenario 16 retraction");
  }],
  ["17 redaction and recalculation", () => {
    const value = fixture("17-redaction-recalculation").output;
    check(value.privacy_tombstones.length === 2 && value.corrections.length === 2, "scenario 17 causal artifacts");
    check(!value.raw_records.some((item: Any) => ["revenue-17", "session-purge-17"].includes(item.record_id)) && !value.logical_events.some((item: Any) => ["revenue-17", "session-purge-17"].includes(item.record_id)), "scenario 17 retained evidence removal");
    const after = value.metric_runs.filter((item: Any) => item.metric_run_id.startsWith("run-17-after"));
    check(after.length === 3 && after.every((item: Any) => item.supersedes_metric_run_id && item.reproducibility_status === "redaction_affected"), "scenario 17 replacement runs");
    check(after.some((item: Any) => item.evidence_refs.some((ref: Any) => ref.lifecycle_status === "redacted")) && after.some((item: Any) => item.evidence_refs.some((ref: Any) => ref.lifecycle_status === "purged")), "scenario 17 evidence lifecycle");
    check(value.reconciliation[0].difference_reason_code === "redaction_caused_recalculation", "scenario 17 reconciliation");
  }],
  ["18 aggregate-installation rejection", () => {
    const value = fixture("18-aggregate-installation-rejection").output;
    check(value.rejections[0].reason_code === "aggregate_installation_join_forbidden" && value.raw_records.length === 0, "scenario 18");
  }],
  ["19 bot-prefetch public category", () => {
    const value = fixture("19-bot-prefetch").output;
    check(value.attributions[0].reason_code === "bot_prefetch" && value.fraud_decisions[0].reason_code === "bot_prefetch", "scenario 19 classification");
    check(value.reconciliation[0].difference_reason_code === "candidate_excluded", "scenario 19 reconciliation");
  }],
];
describe("reviewed scenarios", () => {
  for (const [name, assertion] of scenarios) it(name, assertion);
  it("contains 19 scenario assertions", () => {
    check(scenarios.length === 19, "scenario assertion inventory must contain 19 entries");
  });
});

const rawSchema = schemaValues.find(({ value }) => value.$id === outputSchemaIds.raw_records)!.value;
const eventEnum = rawSchema.properties.event_name.enum;
const contractText = readFileSync(join(root, "spec", "event-metric-contract-v0.1.md"), "utf8");
const fraudSchemaText = readFileSync(join(root, "schemas", "fraud-decision.schema.json"), "utf8");
const acceptance: Array<[string, () => void]> = [
  ["AC01 Draft 2020-12 schemas have stable IDs and versions", () => check(schemaPaths.length === 23 && schemaIds.every(Boolean), "AC01")],
  ["AC02 canonical event names agree across registry and schemas", () => {
    check(equal(eventEnum, eventNames), "AC02 raw registry mismatch");
    for (const name of eventNames) check(ajv.getSchema(`urn:open-mmp:schema:event-${name.replaceAll("_", "-")}:v0.1`), `AC02 missing event schema: ${name}`);
  }],
  ["AC03 raw delivery logical correction and derived artifacts are separate", () => {
    check(Object.keys(outputSchemaIds).length === 11 && Object.values(expectedFiles).every((name) => name.startsWith("expected_")), "AC03");
  }],
  ["AC04 tenant-scoped idempotency duplicate and conflict fixtures pass", () => {
    check(fixture("05-duplicate-delivery").output.deliveries.some((item: Any) => item.duplicate_resolution === "duplicate_delivery"), "AC04 duplicate");
    check(fixture("06-event-id-conflict").output.rejections.some((item: Any) => item.reason_code === "event_id_conflict"), "AC04 conflict");
    check(fixture("07-same-id-across-tenants").output.raw_records.filter((item: Any) => item.event_id === "shared-event-id").length === 2, "AC04 tenant");
  }],
  ["AC05 server-auth scope rejects client mismatch", () => check(fixture("07-same-id-across-tenants").output.rejections.some((item: Any) => item.reason_code === "client_scope_mismatch"), "AC05")],
  ["AC06 orthogonal state axes and transitions are machine readable", () => check(Object.keys(stateAxes).length === 6 && stateAxes.privacy_request.states.includes("completed") && stateAxes.lifecycle.states.includes("purged"), "AC06")],
  ["AC07 attribution includes policy scope method model reason and cutoff", () => {
    for (const { output } of results.values()) for (const item of output.attributions) {
      for (const field of ["subject_scope", "method", "model", "reason_code", "reason_code_version", "input_cutoff_at", "rule_bundle_version", "rule_bundle_hash"]) check(item[field] !== undefined, `AC07 ${field}`);
    }
  }],
  ["AC08 organic and unattributed are distinct", () => check(fixture("02-organic-no-referrer").output.attributions[0].status === "organic" && fixture("03-unknown-click").output.attributions[0].status === "unattributed", "AC08")],
  ["AC09 aggregate result cannot carry installation identity", () => {
    const validator = ajv.getSchema(outputSchemaIds.attributions)!;
    const aggregate = { ...fixture("02-organic-no-referrer").output.attributions[0], subject_scope: "aggregate", installation_id: "forbidden" };
    check(!validator(aggregate), "AC09 schema must reject aggregate installation identity");
  }],
  ["AC10 subject scope uses installation_level and never user_level", () => {
    check(compatibility.every((row: Any) => row.subject_scope !== "user_level"), "AC10 registry");
    for (const { output } of results.values()) check(output.attributions.every((item: Any) => item.subject_scope !== "user_level"), "AC10 output");
  }],
  ["AC11 three D0 definitions recalculate independently", () => {
    const metrics = fixture("09-utc-jst-calendar").output.metric_runs;
    check(new Set(metrics.map((item: Any) => item.metric_name)).size === 3 && new Set(metrics.map((item: Any) => item.value_unscaled)).size > 1, "AC11");
  }],
  ["AC12 currency FX rounding and watermark are reproducible", () => {
    const runs = fixture("08-late-ad-revenue").output.metric_runs;
    check(runs.every((item: Any) => item.fx_rate && item.fx_rate_source && item.fx_rate_as_of && item.fx_rate_snapshot_id && item.fx_policy_version === "fx-v0.1" && item.rounding_mode === "half_even" && item.input_received_at_watermark), "AC12");
    const tie = structuredClone(fixture("08-late-ad-revenue").input);
    tie.fx_policy = {
      policy_version: "fx-half-even-test", target_currency: "USD", target_scale: 0,
      rounding_mode: "half_even",
      rates: [{ currency: "USD", rate_unscaled: "1", rate_scale: 0, source: "synthetic-tie", as_of: "2026-08-12T00:00:00.000Z" }],
    };
    tie.records[1].payload.currency = "USD";
    tie.records[1].payload.amount_scale = 1;
    tie.records[1].payload.amount_unscaled = "5";
    const evenDown = evaluate(tie).metric_runs.find((item: Any) => item.metric_run_id.startsWith("run-08-recalculated") && item.metric_name.includes("_24h_"));
    check(evenDown.value_unscaled === "0", "AC12 half-even tie to even zero");
    tie.records[1].payload.amount_unscaled = "15";
    const evenUp = evaluate(tie).metric_runs.find((item: Any) => item.metric_run_id.startsWith("run-08-recalculated") && item.metric_name.includes("_24h_"));
    check(evenUp.value_unscaled === "2", "AC12 half-even tie to even two");
  }],
  ["AC13 high-precision source amount survives ingestion", () => {
    const { input, output } = fixture("08-late-ad-revenue");
    const source = input.records.find((item: Any) => item.record_id === "revenue-late");
    const raw = output.raw_records.find((item: Any) => item.record_id === "revenue-late");
    check(source.payload.amount_unscaled === "123456789012345678" && raw.payload_sha256 === sha256(source.payload), "AC13");
  }],
  ["AC14 immutable snapshot fixes ordered received evidence", () => {
    const { input, output } = fixture("08-late-ad-revenue");
    const initial = output.metric_runs.find((item: Any) => item.metric_run_id.startsWith("run-08-initial"));
    const recalculated = output.metric_runs.find((item: Any) => item.metric_run_id.startsWith("run-08-recalculated"));
    check(initial.input_snapshot_id !== recalculated.input_snapshot_id, "AC14 cutoff snapshots");
    const reordered = structuredClone(input);
    reordered.records.reverse();
    check(equal(evaluate(reordered).metric_runs, output.metric_runs), "AC14 input ordering");
    const changed = structuredClone(input);
    changed.records[1].received_at = "2026-08-13T00:00:00.001Z";
    check(evaluate(changed).metric_runs.find((item: Any) => item.metric_run_id.startsWith("run-08-recalculated")).input_snapshot_id !== recalculated.input_snapshot_id, "AC14 received_at binding");
  }],
  ["AC15 correction retraction redaction and post-deletion recalculation are causal", () => {
    const corrections = fixture("16-correction-refund").output.corrections;
    check(corrections.some((item: Any) => item.correction_reason === "refund" && item.corrects_record_id === "purchase-16"), "AC15 correction");
    check(corrections.some((item: Any) => item.correction_type === "retraction"), "AC15 retraction");
    check(fixture("17-redaction-recalculation").output.metric_runs.some((item: Any) => item.supersedes_metric_run_id), "AC15 redaction");
  }],
  ["AC16 clock referrer prefetch and withdrawal fixtures pass", () => check(scenarios.length === 19 && fixture("11-clock-skew").output.deliveries.some((item: Any) => item.clock_skew_suspected) && fixture("13-referrer-unsupported").output.attributions.length === 2 && fixture("19-bot-prefetch").output.fraud_decisions.length === 1, "AC16")],
  ["AC17 server-recognized withdrawal rejects and redacts payload", () => {
    for (const name of ["14-withdrawal-after-occurrence", "15-event-after-withdrawal"]) {
      const value = fixture(name).output;
      check(value.rejections.some((item: Any) => item.reason_code === "consent_withdrawn" && item.withdrawal_recognized_at && item.payload_disposition === "discarded"), `AC17 ${name}`);
    }
  }],
  ["AC18 lawful redaction marks evidence and supersedes runs", () => {
    const value = fixture("17-redaction-recalculation").output;
    check(value.privacy_tombstones.length === 2 && value.metric_runs.filter((item: Any) => item.metric_run_id.startsWith("run-17-after")).every((item: Any) => item.reproducibility_status === "redaction_affected" && item.supersedes_metric_run_id), "AC18");
  }],
  ["AC19 reconciliation derives deterministic neutral reasons", () => {
    const base = fixture("01-valid-install-referrer");
    check(base.output.reconciliation[0].difference_reason_code === "matched", "AC19 matched");
    const mutated = structuredClone(base.input);
    mutated.reconciliation_inputs[0].matching_keys[0].value = "not-present";
    check(evaluate(mutated).reconciliation[0].difference_reason_code === "external_row_unmatched", "AC19 derived mutation");
    const normalized = structuredClone(base.input);
    const composite = {
      type: "tenant_app_composite", value: "TENANT-A|APP-A", scope: "tenant_app",
      normalization: "lowercase_ascii", cardinality: "one_to_many", protected: true,
    };
    normalized.reconciliation_inputs[0].matching_keys = [composite];
    normalized.reconciliation_inputs[0].candidates[0].matching_keys = [{ ...composite, value: "tenant-a|app-a" }];
    check(evaluate(normalized).reconciliation[0].difference_reason_code === "matched", "AC19 normalization");
    normalized.reconciliation_inputs[0].candidates[0].app_id = "app-b";
    check(evaluate(normalized).reconciliation[0].difference_reason_code === "external_row_unmatched", "AC19 tenant-app scope");
    const ambiguous = structuredClone(base.input);
    ambiguous.reconciliation_inputs[0].candidates.push({
      ...ambiguous.reconciliation_inputs[0].candidates[0],
      candidate_id: "install-1-duplicate",
    });
    check(evaluate(ambiguous).reconciliation[0].difference_reason_code === "join_key_ambiguous", "AC19 cardinality");
  }],
  ["AC20 public fraud envelope excludes live defenses", () => {
    for (const forbidden of ["threshold", "model_weight", "watchlist", "ip_address", "user_agent", "response_timing"]) check(!fraudSchemaText.includes(forbidden), `AC20 ${forbidden}`);
    check(contractText.includes("remain private"), "AC20 private boundary");
  }],
  ["AC21 one command validates every schema registry fixture and golden", () => check(schemaPaths.length === 23 && Object.keys(registries).length === 7 && fixtureDirs.length === 19 && outputArtifactCount === 19 * 11, "AC21")],
  ["AC22 repeated and independent evaluators produce identical JCS", () => {
    for (const { output, python } of results.values()) check(equal(output, python), "AC22 evaluator mismatch");
    const vector = { numbers: [333333333.33333329, 1e30, 4.50, 2e-3, 1e-27, -0], string: "€$\u000f\nA'B\"\\\"/" };
    const python = execFileSync("python", [join(root, "tools", "python_evaluator.py"), "--conformance"], { encoding: "utf8" }).trim();
    check(canonicalize(vector) === python, "AC22 RFC 8785 conformance vector");
  }],
  ["AC23 paid evidence dominates reinstall lifecycle classification", () => {
    const base = fixture("10-reinstall-redownload");
    const changed = structuredClone(base.input);
    changed.records.find((item: Any) => item.record_id === "install-10b").payload.install_type = "redownload";
    const attr = evaluate(changed).attributions.find((item: Any) => item.attribution_id === "attr:install-10b");
    check(attr.status === "non_organic" && attr.reason_code === "valid_install_referrer", "AC23 paid redownload");
  }],
  ["AC24 record ID collisions reject every colliding delivery", () => {
    const collision = structuredClone(fixture("01-valid-install-referrer").input);
    const source = collision.records[0];
    collision.records.push({ ...source, delivery_id: "delivery:record-id-collision", event_id: "event:record-id-collision" });
    const output = evaluate(collision);
    const colliding = output.deliveries.filter((item: Any) => item.record_id === source.record_id);
    check(colliding.length === 2 && colliding.every((item: Any) => item.ingestion_status === "rejected" && item.duplicate_resolution === "record_id_collision"), "AC24 delivery collision");
    check(output.rejections.filter((item: Any) => item.record_id === source.record_id && item.reason_code === "record_id_collision").length === 2, "AC24 rejection collision");
    check(!output.raw_records.some((item: Any) => item.record_id === source.record_id), "AC24 collision evidence rejected");
    const scoped = structuredClone(fixture("01-valid-install-referrer").input);
    const scopedSource = scoped.records.find((item: Any) => item.event_name === "click");
    const record = {
      ...scopedSource,
      record_id: "cross-scope-same-context",
      delivery_id: "delivery:cross-scope-same-context",
      event_id: "event:cross-scope-same-context",
    };
    scoped.batches = [
      { batch_id: "batch-cross-scope", server_context: { ...scoped.server_context }, records: [{ ...record }] },
      {
        batch_id: "batch-cross-scope",
        server_context: { ...scoped.server_context, tenant_id: "tenant-b", app_id: "app-b" },
        records: [{ ...record, tenant_id: "tenant-b", app_id: "app-b" }],
      },
    ];
    delete scoped.server_context;
    delete scoped.records;
    const scopedOutput = evaluate(scoped);
    const scopedReordered = reorderedInput(scoped);
    const scopedReorderedOutput = evaluate(scopedReordered);
    const [scopedPython, scopedReorderedPython] = pythonOutputs([scoped, scopedReordered]);
    check(equal(scopedOutput, scopedReorderedOutput), "AC24 cross-scope same-context reorder");
    check(equal(scopedOutput, scopedPython) && equal(scopedReorderedOutput, scopedReorderedPython), "AC24 cross-scope Python agreement");
    check(scopedOutput.deliveries.length === 2 && scopedOutput.deliveries.every((item: Any) => item.reason_code === "record_id_collision"), "AC24 cross-scope collision deliveries");
    check(scopedOutput.raw_records.length === 0 && scopedOutput.logical_events.length === 0 && scopedOutput.attributions.length === 0, "AC24 cross-scope collision no derived leakage");
  }],
  ["AC25 click ambiguity never selects the first candidate", () => {
    const ambiguous = structuredClone(fixture("01-valid-install-referrer").input);
    const source = ambiguous.records.find((item: Any) => item.event_name === "click");
    ambiguous.records.push({ ...source, record_id: "click-ambiguous", delivery_id: "delivery:click-ambiguous", event_id: "event:click-ambiguous" });
    const output = evaluate(ambiguous);
    check(output.attributions[0].status === "unattributed" && output.attributions[0].reason_code === "ambiguous_click_id", "AC25 ambiguous click");
    check(equal(output, evaluate(reorderedInput(ambiguous))), "AC25 ambiguous click reorder");
  }],
  ["AC26 installation anchors are explicit and unambiguous", () => {
    const invalid = structuredClone(fixture("10-reinstall-redownload").input);
    const install = invalid.records.find((item: Any) => item.record_id === "install-10c");
    install.payload.prior_installation_id = install.payload.installation_id;
    let rejected = false;
    try { evaluate(invalid); } catch { rejected = true; }
    check(rejected, "AC26 self-referential reinstall anchor");
  }],
];
describe("acceptance criteria", () => {
  for (const [name, assertion] of acceptance) it(name, assertion);
  it("contains 26 acceptance criteria", () => {
    check(acceptance.length === 26, "acceptance inventory must contain 26 entries");
  });
});

// Deliberate in-memory mutations prove that the validator is not a count-only
// or self-generated-golden check.
const adValidator = ajv.getSchema("urn:open-mmp:schema:event-ad-revenue:v0.1")!;
const validRevenue = {
  event_name: "ad_revenue", installation_id: "installation-test", impression_id: "impression-test",
  ad_unit_id: "unit-test", ad_network: "synthetic", amount_unscaled: "1", amount_scale: 18,
  currency: "USD", revenue_source: "server_verified",
};
const rawValidator = ajv.getSchema(outputSchemaIds.raw_records)!;
const rawBaseline = fixture("01-valid-install-referrer").output.raw_records[0];
describe("semantic mutations", () => {
  it("accepts the baseline revenue event", () => {
    check(adValidator(validRevenue), "mutation baseline event invalid");
  });
  it("rejects negative ad revenue", () => {
    check(!adValidator({ ...validRevenue, amount_unscaled: "-1" }), "mutation negative ad revenue was accepted");
  });
  it("rejects timestamp precision drift", () => {
    check(!rawValidator({ ...rawBaseline, occurred_at: "2026-08-12T00:00:00Z" }), "mutation timestamp precision was accepted");
  });
  it("detects golden output removal", () => {
    check(!equal(fixture("01-valid-install-referrer").output, { ...fixture("01-valid-install-referrer").output, raw_records: [] }), "mutation golden comparison did not fail");
  });
  it("keeps unknown events out of the registry", () => {
    check(!eventNames.includes("unknown_event"), "mutation unknown event entered registry");
  });
  it("rejects cross-tenant privacy references", () => {
    const crossTenantPrivacy = structuredClone(fixture("07-same-id-across-tenants").input);
    crossTenantPrivacy.privacy_requests.push({
      contract_version: "0.1.0",
      tenant_id: "tenant-a",
      app_id: "app-a",
      privacy_request_id: "cross-tenant-privacy",
      deletion_subject_ref: "synthetic-subject",
      deletion_scope: "installation",
      requested_at: "2026-08-12T00:00:00.000Z",
      completed_at: "2026-08-12T00:01:00.000Z",
      status: "completed",
      reason_code: "privacy_deletion",
      policy_version: "privacy-v1",
      affected_records: [{ record_id: "tenant-b-record", lifecycle_status: "redacted" }],
    });
    let rejected = false;
    try { evaluate(crossTenantPrivacy); } catch { rejected = true; }
    check(rejected, "mutation cross-tenant privacy reference was accepted");
  });
  it("rejects cross-tenant correction references", () => {
    const crossTenantCorrection = structuredClone(fixture("16-correction-refund").input);
    crossTenantCorrection.correction_inputs[0].tenant_id = "tenant-b";
    let rejected = false;
    try { evaluate(crossTenantCorrection); } catch { rejected = true; }
    check(rejected, "mutation cross-tenant correction reference was accepted");
  });
});

type TimestampCase = { name: string; field: string; value: string; input: Any };
const invalidTimestamps = [
  "2026-02-30T00:00:00.000Z",
  "2026-08-12T24:00:00.000Z",
  "not-a-timestamp",
];
const timestampCases: TimestampCase[] = [];
for (const field of ["occurred_at", "redirector_click_at", "install_begin_at_server"]) {
  for (const value of invalidTimestamps) {
    const input = structuredClone(fixture("01-valid-install-referrer").input);
    if (field === "occurred_at") input.records[0].occurred_at = value;
    if (field === "redirector_click_at") input.records.find((record: Any) => record.event_name === "click").payload.redirector_click_at = value;
    if (field === "install_begin_at_server") input.records.find((record: Any) => record.event_name === "install").payload.install_begin_at_server = value;
    timestampCases.push({ name: `${field} rejects ${value}`, field, value, input });
  }
}
const pythonTimestampResults = pythonBatch(timestampCases.map((entry) => entry.input));
describe("timestamp validation", () => {
  for (const [index, entry] of timestampCases.entries()) {
    it(entry.name, () => {
      const schemaRejected = entry.field === "occurred_at"
        ? !fixtureValidator(entry.input)
        : (() => {
            const eventName = entry.field === "redirector_click_at" ? "click" : "install";
            const record = entry.input.records.find((candidate: Any) => candidate.event_name === eventName);
            const validator = ajv.getSchema(`urn:open-mmp:schema:event-${eventName}:v0.1`)!;
            return !validator({ ...record.payload, event_name: eventName });
          })();
      check(schemaRejected, `schema accepted invalid ${entry.field}`);
      let failure: { name: string; message: string; exit_code: number } | undefined;
      try {
        evaluate(entry.input);
      } catch (error) {
        check(error instanceof TimestampInvalidError, `unexpected TypeScript error for ${entry.field}`);
        failure = { name: error.name, message: error.message, exit_code: error.exitCode };
      }
      check(failure, `TypeScript accepted invalid ${entry.field}`);
      const python = pythonTimestampResults[index];
      check(!python.ok, `Python accepted invalid ${entry.field}`);
      check(equal(failure, python.error), `timestamp rejection mismatch for ${entry.field}`);
    });
  }
});

const unicodeInput = structuredClone(fixture("01-valid-install-referrer").input);
const unicodeReconciliation = unicodeInput.reconciliation_inputs[0];
const unicodeKey = unicodeReconciliation.matching_keys[0];
const unicodeValues = ["\u{10000}campaign", "campaign", "\uE000campaign"];
unicodeReconciliation.matching_keys = unicodeValues.map((value) => ({ ...unicodeKey, value }));
unicodeReconciliation.candidates[0].matching_keys = unicodeValues.map((value) => ({ ...unicodeKey, value }));
const unicodeTypeScript = evaluate(unicodeInput);
const [unicodePython] = pythonOutputs([unicodeInput]);
describe("UTF-16 output ordering", () => {
  it("matches the independent Python evaluator for astral text", () => {
    check(equal(unicodeTypeScript, unicodePython), "UTF-16 cross-language mismatch");
    check(equal(
      unicodeTypeScript.reconciliation[0].matching_keys.map((entry: Any) => entry.value),
      ["campaign", "\u{10000}campaign", "\uE000campaign"],
    ), "UTF-16 matching-key order");
  });
});

function shuffled<T>(values: T[], seed: number): T[] {
  const output = [...values];
  let state = seed >>> 0;
  for (let index = output.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const selected = state % (index + 1);
    [output[index], output[selected]] = [output[selected], output[index]];
  }
  return output;
}

function permutedInput(input: Any, seed: number): Any {
  const output = structuredClone(input);
  if (output.records) output.records = shuffled(output.records, seed);
  if (output.batches) {
    output.batches = shuffled(output.batches, seed);
    output.batches.forEach((batch: Any, index: number) => {
      batch.records = shuffled(batch.records, seed + index + 1);
    });
  }
  return output;
}

const permutationCases = fixtureDirs.flatMap((dir, fixtureIndex) =>
  Array.from({ length: 5 }, (_, permutationIndex) => {
    const name = basename(dir);
    return {
      name: `${name} permutation ${permutationIndex + 1}`,
      expected: fixture(name).output,
      input: permutedInput(fixture(name).input, (fixtureIndex + 1) * 1_000 + permutationIndex + 1),
    };
  }),
);
const permutationPython = pythonOutputs(permutationCases.map((entry) => entry.input));
describe("input permutations", () => {
  for (const [index, entry] of permutationCases.entries()) {
    it(entry.name, () => {
      const output = evaluate(entry.input);
      check(equal(output, entry.expected), `TypeScript permutation changed output: ${entry.name}`);
      check(equal(output, permutationPython[index]), `Python permutation mismatch: ${entry.name}`);
    });
  }
});
