# Contract v0.2 Migration Guide

Contract v0.2 is an in-place contract migration from the immutable `contract-v0.1` Git tag. It is not wire-compatible with v0.1. Consumers must select a complete contract version and must not mix v0.1 schemas, registries, fixtures, or golden outputs with v0.2 artifacts.

## Version and path migration

| v0.1 | v0.2 | Reason |
| --- | --- | --- |
| Schema `$id` suffix `:v0.1` | `:v0.2` | The required fields, enums, types, and artifact set contain breaking changes. |
| `contract_version` and event `schema_version` `0.1.0` | `0.2.0` | Object versions identify the matching in-place schema set. |
| `registries/*-v0.1.json` | `registries/*-v0.2.json` | Registry values and compatibility rules are versioned with the contract. |
| `fixtures/v0.1/` | `fixtures/v0.2/` | Reviewed fixture inputs and outputs are a versioned set. |
| 11 expected output classes | 12 expected output classes | `expected_metric_definitions.json` makes versioned metric definitions reviewable outputs. |

The `contract-v0.1` tag points to the pre-migration `main` commit. The versioning rules are in [schema-versioning.md](schema-versioning.md).

## Contract field migration

| Artifact or field | v0.2 change | Reason / work-order authority |
| --- | --- | --- |
| Logical event `lifecycle` | Renamed to `record_lifecycle`; values remain `active | retracted`. | Separates record state from payload availability (A-02, R-2). |
| Raw `payload_lifecycle_status` and evidence `lifecycle_status` | Values are `available | redacted | purged`; state-transition axes match schema enums. | Payload availability is orthogonal to logical-record lifecycle (A-02, R-2). |
| Money `amount_unscaled` | All event money is nonnegative and uses `common#/$defs/money`; direction comes from event type and `financial_status`. | Removes contradictory signed/unsigned definitions (A-03, A-07, R-3). |
| Reason fields | Attribution, rejection, correction, consent decision, and public fraud values are schema enums equal to their registry sets. | Closes free-text and dual-source drift (A-04, F-06, R-4). |
| Evidence reference | `access_class` is required; the unused standalone evidence-reference schema is removed. | One canonical evidence type and explicit disclosure class (A-06, F-04). |
| Identifier fields | Click, tracking-link, campaign, installation, and session identifiers use common types; `click_id` requires at least 22 base64url-compatible characters. | Type consistency and secure redirector identifiers (A-15, A-18, F-08). |
| Attribution `subject_ref` | `installation_level` requires `installation:`; `aggregate` requires `aggregate:`. | Prevents namespace confusion structurally (F-09). |
| `canonical_record_id` | Points to the first accepted record for duplicate/conflict delivery; absent on `record_id_collision`. | Defines previously emitted but undocumented identity (A-08). |
| Metric-run FX | `fx_rate` becomes `fx_rate_unscaled` plus `fx_rate_scale`. | Makes integer FX representation typed and reproducible (A-09). |
| Privacy request completion | `deletion_subject_ref` is forbidden and `deletion_subject_digest` is required. | Removes the subject reference while preserving deployment-private HMAC correlation (F-01, R-5). |
| Privacy tombstone | `reason_digest` and `policy_digest` become plaintext `reason_code` and `policy_version`; `provenance_digest` has an exact JCS input. | Digests are not secrecy controls (F-05, R-6). |
| Invalid calendar timestamp | Emits `timestamp_invalid` delivery and rejection with discarded payload. | Formalizes the former evaluator exception path (B-01, R-8). |
| Public fraud reason | Adds `replay_suspected`. | Keeps replay suspicion separate from delivery idempotency (A-12). |
| Metric reproducibility | Retention expiry can produce `retention_affected` replacement runs without a privacy request. | Makes lawful retention effects auditable (A-14). |

## Existing fixture input migration

Every input in fixtures 01 through 19 changes `contract_version` and event `schema_version` to `0.2.0`. Fixture identifiers that populate `click_id` or provider-click matching keys are lengthened to the v0.2 secure-ID shape; the affected protected payload digests consequently change. Fixture 12 now contains a lexically shaped but calendrically invalid authoritative timestamp to distinguish `authoritative_time_invalid` from missing authority. Fixture 17 replaces the completed deletion subject reference with the reviewed synthetic HMAC digest. No real or provider-derived data is introduced.

## Existing golden-output ledger

The following table is exhaustive for content changes to the golden files inherited from fixtures 01 through 19. All 19 fixtures also add `expected_metric_definitions.json` containing the three definitions at `metric_definition_version=0.2.0` and `rule_bundle_version=0.2.0`. Any other inherited `expected_*.json` file is byte-for-byte unchanged apart from its Git move from `fixtures/v0.1/` to `fixtures/v0.2/`.

Abbreviations in the field column are exact field names: `cv=contract_version`, `sv=schema_version`, `rcv=reason_code_version`, `rbv=rule_bundle_version`, `drv=difference_reason_version`.

| Fixture | Golden file | Fields changed | Reason |
| --- | --- | --- | --- |
| 01 | `expected_attributions.json` | `rcv`, `rbv` -> `0.2.0` | Versioned attribution contract. |
| 01 | `expected_deliveries.json` | `cv` -> `0.2.0` | Versioned delivery contract. |
| 01 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | v0.2 version and lifecycle split. |
| 01 | `expected_raw_records.json` | `cv`, `sv`; `payload_sha256` | v0.2 versions and secure click-ID payload. |
| 01 | `expected_reconciliation.json` | `drv` -> `0.2.0` | Versioned reconciliation reason. |
| 02 | `expected_attributions.json` | `rcv`, `rbv` | Versioned attribution contract. |
| 02 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 02 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 02 | `expected_raw_records.json` | `cv`, `sv`, `payload_sha256` | Versions and secure click-ID-shaped evidence. |
| 03 | `expected_attributions.json` | `rcv`, `rbv` | Versioned attribution contract. |
| 03 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 03 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 03 | `expected_raw_records.json` | `cv`, `sv`, `payload_sha256` | Versions and secure click-ID-shaped evidence. |
| 03 | `expected_reconciliation.json` | `drv`; matching-key `value` | v0.2 reason version and secure provider-click key shape. |
| 04 | `expected_attributions.json` | `rcv`, `rbv` | Versioned attribution contract. |
| 04 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 04 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 04 | `expected_raw_records.json` | `cv`, `sv`, `payload_sha256` | Versions and secure click-ID payloads. |
| 05 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 05 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 05 | `expected_raw_records.json` | `cv`, `sv`, `payload_sha256` | Versions and secure click-ID payloads. |
| 06 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 06 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 06 | `expected_raw_records.json` | `cv`, `sv`, `payload_sha256` | Versions and secure click-ID payloads. |
| 06 | `expected_rejections.json` | `reason_code_version` -> `0.2.0` | Versioned rejection registry. |
| 07 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 07 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 07 | `expected_raw_records.json` | `cv`, `sv`, `payload_sha256` | Versions and secure click-ID payloads. |
| 07 | `expected_rejections.json` | `reason_code_version` | Versioned rejection registry. |
| 08 | `expected_attributions.json` | `rcv`, `rbv` | Versioned attribution contract. |
| 08 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 08 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 08 | `expected_metric_runs.json` | `metric_definition_version`, `rbv`; `fx_rate` -> `fx_rate_unscaled` + `fx_rate_scale` | Versioned definitions and structured FX. |
| 08 | `expected_raw_records.json` | `cv`, `sv`, `payload_sha256` | Versioned raw records and changed install payload digest. |
| 09 | `expected_attributions.json` | `rcv`, `rbv` | Versioned attribution contract. |
| 09 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 09 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 09 | `expected_metric_runs.json` | `metric_definition_version`, `rbv`; structured FX fields | Versioned definitions and structured FX. |
| 09 | `expected_raw_records.json` | `cv`, `sv`, `payload_sha256` | Versioned raw records and changed payload digest. |
| 10 | `expected_attributions.json` | `rcv`, `rbv` | Versioned attribution contract. |
| 10 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 10 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 10 | `expected_raw_records.json` | `cv`, `sv`, `payload_sha256` | Versions and secure click-ID payloads. |
| 11 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 11 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 11 | `expected_raw_records.json` | `cv`, `sv` | Versioned raw records. |
| 12 | `expected_attributions.json` | `rcv`, `rbv` | Versioned attribution contract. |
| 12 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 12 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 12 | `expected_raw_records.json` | `cv`, `sv`, `payload_sha256` | Versions, secure IDs, and explicit invalid-authority evidence. |
| 13 | `expected_attributions.json` | `rcv`, `rbv` | Versioned attribution contract. |
| 13 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 13 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 13 | `expected_raw_records.json` | `cv`, `sv`, `payload_sha256` | Versions and secure click-ID payloads. |
| 14 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 14 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 14 | `expected_raw_records.json` | `cv`, `sv` | Versioned raw records. |
| 14 | `expected_rejections.json` | `reason_code_version` | Versioned rejection registry. |
| 15 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 15 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 15 | `expected_raw_records.json` | `cv`, `sv` | Versioned raw records. |
| 15 | `expected_rejections.json` | `reason_code_version` | Versioned rejection registry. |
| 16 | `expected_corrections.json` | `cv` | Versioned correction contract. |
| 16 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 16 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 16 | `expected_raw_records.json` | `cv`, `sv` | Versioned raw records. |
| 17 | `expected_attributions.json` | `rcv`, `rbv` | Versioned attribution contract. |
| 17 | `expected_corrections.json` | `cv` | Versioned correction contract. |
| 17 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 17 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 17 | `expected_metric_runs.json` | `metric_definition_version`, `rbv`; structured FX fields | Versioned definitions and structured FX. |
| 17 | `expected_privacy_requests.json` | `cv`; remove `deletion_subject_ref`; add `deletion_subject_digest`; completed-state ordering | Completed-request identifier removal (F-01, R-5). |
| 17 | `expected_privacy_tombstones.json` | `cv`; `reason_digest` -> `reason_code`; `policy_digest` -> `policy_version`; recompute `provenance_digest` | Transparent tombstone provenance (F-05, R-6). |
| 17 | `expected_raw_records.json` | `cv`, `sv`, `payload_sha256` | Versioned raw records and secure ID payload. |
| 17 | `expected_reconciliation.json` | `drv`, matching-key `value` | v0.2 reason version and secure provider-click key. |
| 18 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 18 | `expected_rejections.json` | `reason_code_version` | Versioned rejection registry. |
| 19 | `expected_attributions.json` | `rcv`, `rbv` | Versioned attribution contract. |
| 19 | `expected_deliveries.json` | `cv` | Versioned delivery contract. |
| 19 | `expected_fraud_decisions.json` | `reason_code_version`, `rbv` | Versioned public fraud contract. |
| 19 | `expected_logical_events.json` | `cv`; `lifecycle` -> `record_lifecycle` | Lifecycle split. |
| 19 | `expected_raw_records.json` | `cv`, `sv`, `payload_sha256` | Versions and secure click-ID payload. |
| 19 | `expected_reconciliation.json` | `drv`, matching-key `value`, join text | v0.2 reason version and secure click-ID join. |

## New fixture and golden ledger

Each row below adds `input.json` and all 12 reviewed golden files: `expected_raw_records.json`, `expected_deliveries.json`, `expected_logical_events.json`, `expected_corrections.json`, `expected_privacy_requests.json`, `expected_privacy_tombstones.json`, `expected_attributions.json`, `expected_metric_definitions.json`, `expected_metric_runs.json`, `expected_fraud_decisions.json`, `expected_rejections.json`, and `expected_reconciliation.json`. Empty arrays are explicit expected results.

| Fixture | Meaningful non-empty golden fields | Authority |
| --- | --- | --- |
| 20 `timestamp-invalid` | Delivery/rejection `reason_code=timestamp_invalid`, `payload_disposition=discarded`, retained non-identifying metadata; all evidence/derived arrays empty. | B-01, R-8. |
| 21 `reconciliation-window-mismatch` | Accepted organic install plus reconciliation `difference_reason_code=window_mismatch`, typed key, candidate, join, out-of-window state, current freshness. | A-11. |
| 22 `reconciliation-join-key-missing` | Accepted organic install plus reconciliation `difference_reason_code=join_key_missing` with empty key/candidate/join sets. | A-11. |
| 23 `reconciliation-freshness-mismatch` | Accepted organic install plus reconciliation `difference_reason_code=freshness_mismatch`, joined in-window candidate, stale freshness. | A-11. |
| 24 `attribution-supersession` | Redaction correction/tombstone and replacement attribution with `supersedes_attribution_id` and `finality=superseded`. | A-10. |
| 25 `replay-suspected` | Unique accepted click plus public fraud `reason_code=replay_suspected`, protected categorical evidence, and exclude action. | A-12. |
| 26 `retention-affected` | Retention tombstone, no privacy request, and three immutable replacement metric runs with `retention_affected`, zero value, purged revenue evidence, and supersession IDs. | A-14. |
| 27 `ad-impression-revenue-link` | Accepted install/impression/revenue evidence and three metric runs of `3000000` scale-6 USD citing the shared impression evidence. | A-19. |

## Inventory reconciliation

The v0.2 fixture tree contains 27 `input.json` files and `27 * 12 = 324` golden output files, plus this README: 352 paths in the resulting tree. The migration changes every fixture-tree path because the version directory moves from v0.1 to v0.2; Git may display unchanged files as renames. Because this README was rewritten beyond Git's rename-similarity threshold, `git diff --stat contract-v0.1..HEAD -- fixtures/` reports its old deletion and new addition separately, for 353 changed paths. Use:

```bash
git diff --name-status --find-renames contract-v0.1..HEAD -- fixtures/
git diff --stat contract-v0.1..HEAD -- fixtures/
```

The expected new-side inventory is 27 inputs, 324 golden files, and one README. The tables above account for every content-changed inherited golden and every new golden; all remaining inherited goldens are path-only moves.

## Consumer migration

1. Pin the v0.1 implementation to the `contract-v0.1` tag while preparing the migration.
2. Upgrade schemas, registries, evaluator behavior, and fixture expectations as one v0.2 unit.
3. Recompute protected payload digests only when the underlying synthetic or deployment-private payload changes; never translate a v0.1 digest by string substitution.
4. Reject mixed-version artifacts and validate the complete v0.2 suite before accepting production-like inputs outside this public repository.
