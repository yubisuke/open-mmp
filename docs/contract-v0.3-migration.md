# Contract v0.3 Migration Guide

Contract v0.3 is an in-place migration from the immutable `contract-v0.2.1` Git tag. It is not wire-compatible with v0.2.1. Consumers must select one complete contract version and must not mix v0.2 schemas, registries, fixtures, evaluator behavior, or golden outputs with v0.3 artifacts.

## Version and path migration

| v0.2.1 | v0.3.0 | Reason |
| --- | --- | --- |
| Schema `$id` suffix `:v0.2` | `:v0.3` | WO-5.5 changes closed attribution, event, fraud, and metric semantics. |
| Contract and event schema versions `0.2.0` or patch result versions `0.2.1` | `0.3.0` | One exact SemVer identifies the complete v0.3 contract set. |
| `registries/*-v0.2.json` | `registries/*-v0.3.json` | Registry values and compatibility rules are versioned with the minor line. |
| `fixtures/v0.2/` | `fixtures/v0.3/` | Reviewed inputs and golden outputs are a versioned set. |
| `spec/event-metric-contract-v0.2.md` | `spec/event-metric-contract-v0.3.md` | The normative specification follows the active minor line. |

The `contract-v0.2.1` tag points to the pre-migration `main` commit. Versioning rules are defined in [schema-versioning.md](schema-versioning.md).

## Version-only golden migration

The base in-place move preserves each v0.2.1 scenario and meaningful value. Empty golden arrays change path only. Non-empty artifacts change only the version fields applicable to their artifact class before the semantic changes listed below:

- `contract_version`, event `schema_version`, attribution/rejection/fraud `reason_code_version`, reconciliation `difference_reason_version`, metric `metric_definition_version`, and the fixture metric `rule_bundle_version` advance to `0.3.0`;
- derived identifiers, payload digests, snapshot digests, metric values, evidence references, and policy versions do not change solely because of the minor-line move;
- every semantic or digest change beyond these version fields is listed by fixture and file in the completed golden ledger below.

## Contract field migration

| Handoff | v0.3 contract change | Exercised by |
| --- | --- | --- |
| H-1 | `install.meta_referrer_context` adds typed campaign/account/objective/platform identifiers and classifications; outer `is_ct` and `actual_timestamp` preserve documented source evidence. Free-form `*_name` fields remain excluded. | Fixture 34. |
| H-2 | `referrer_status=third_party` plus `third_party_referrer_classification=play_organic_marker | foreign` separates a deployment-confirmed organic marker from unresolved foreign evidence. | Fixtures 02 and 39. |
| H-3 | Adds the closed `custom_event` envelope with a catalog-shaped key, optional money, and bounded typed scalar attributes. | Fixture 40. |
| H-4 | Replaces the former three-state Meta status with six explicit coverage/decryption states. Only `decrypted` creates Meta attribution. | Fixture 34. |
| H-5 | Adds evidence-only `referrer_client_response`; Android-documented response states plus the defensive `permission_error` value do not decide attribution. | Validator response-matrix mutation over fixture 13. |
| H-6 | Adds public `click_injection_suspected`; CTIT is computed only from canonical `redirector_click_at` (the work-order's `referrer_click_at_server`) and `install_begin_at_server`, with the threshold policy in server context. | Fixture 41 and the 9.999/10.000-second mutation. |
| H-7 | Adds optional `install_origin=play_first_launch | identifier_reset`; omission means first Play launch and does not change attribution. | Fixture 10 and validator mutations. |
| H-8 | Raw records add separate optional `producer_variant` and `wrapper_version`; `producer_version` remains the core version. | Fixture 40. |
| H-9 | A decrypted Meta referrer takes precedence over a simultaneously resolvable first-party click; the first-party evidence remains protected and unselected. | Fixture 34. |
| H-10 | Ad revenue adds optional `revenue_precision=exact | estimated | publisher_defined | undefined` without changing money arithmetic. | Fixture 27 and enum mutations. |
| H-11 | `candidate_missing` means a provider attribution reference lacks the expected first-party record; `external_row_unmatched` means an external row has no internal candidate under any matching key. | Fixture 03. |
| H-12 | Metric definition and run grouping add closed `attribution_status=organic | non_organic | unattributed`; organic and unattributed cohorts cannot inherit paid cost. | Fixture 33. |
| F11 | Imported attribution strategy adds `self_attributed_network` without converting provider judgment into first-party evidence. | Fixture 28 validator coverage. |
| F12 | A uniquely resolved `provider_click_ref` adds the matching first-party redirector click to imported-attribution evidence. | Fixture 28. |

The public schema uses the canonical matching-key name `provider_click_id`; the imported payload field remains `provider_click_ref`. This preserves the established v0.2 key vocabulary while distinguishing the protected source reference from its namespaced digest.

## Existing golden-output ledger

All 38 inherited fixtures move from `fixtures/v0.2/<fixture>/` to `fixtures/v0.3/<fixture>/`. Empty arrays are path-only moves. Every inherited `input.json` advances its contract and event schema versions to `0.3.0`. For non-empty golden files, these artifact-wide version fields advance and no other value changes unless the file appears in the semantic table below:

| Golden class | Version-only fields |
| --- | --- |
| `expected_raw_records.json` | `contract_version`, `schema_version` |
| `expected_deliveries.json`, `expected_logical_events.json`, `expected_corrections.json`, `expected_privacy_requests.json`, `expected_privacy_tombstones.json`, `expected_cost_records.json` | `contract_version` where the artifact defines it |
| `expected_attributions.json`, `expected_fraud_decisions.json`, `expected_rejections.json` | `reason_code_version`, `rule_bundle_version` where present |
| `expected_metric_definitions.json` | `metric_definition_version`, `rule_bundle_version` |
| `expected_metric_runs.json` | `metric_definition_version`, `rule_bundle_version` and embedded contract-owned version references where present |
| `expected_reconciliation.json` | `difference_reason_version` |

The following table is exhaustive for inherited golden changes beyond those path and version updates:

| Fixture | Golden file | Changed fields or rows | Reason |
| --- | --- | --- | --- |
| 02 | `expected_attributions.json` | `reason_code: no_referrer -> no_first_party_referrer` | The normalized third-party Play organic marker is explicit rather than inferred from an empty first-party referrer. |
| 02 | `expected_raw_records.json` | `payload_sha256` | The install payload adds `referrer_status=third_party` and `third_party_referrer_classification=play_organic_marker`. |
| 03 | `expected_reconciliation.json` | Existing row becomes `candidate_missing`; adds a second `external_row_unmatched` row and its matching key | H-11 makes the two neutral failure meanings independently testable. |
| 27 | `expected_raw_records.json` | Revenue `payload_sha256` | The ad-revenue payload adds `revenue_precision=exact`; the amount and metric outputs are unchanged. |
| 28 | `expected_attributions.json` | Adds the resolved `import-click-28` evidence reference | F12 requires imported attribution to retain a uniquely matched first-party click. |
| 28 | `expected_logical_events.json` | Click producer becomes `redirector`; logical ID and ordering follow that producer | The synthetic click is now first-party redirector evidence rather than an imported click row. |
| 28 | `expected_raw_records.json` | Click producer/time source/payload digest; imported install payload digest | Adds first-party `remote_click_ref` evidence and `self_attributed_network` strategy while preserving the provider-reported attribution. |
| 33 | `expected_attributions.json` | Adds the organic installation attribution | H-12 needs an independently grouped organic cohort. |
| 33 | `expected_deliveries.json` | Adds the organic install delivery | New accepted synthetic source row. |
| 33 | `expected_logical_events.json` | Adds the organic install logical event | New accepted synthetic source row. |
| 33 | `expected_metric_definitions.json` | Adds `attribution_status` grouping to the applicable ROAS definition | Contract grouping must declare the emitted cohort dimension. |
| 33 | `expected_metric_runs.json` | Non-organic rows add grouping/dimension digests; adds organic undefined ROAS with `no_attributed_cost`; affected snapshots/evidence and supersession IDs change | Organic and paid cohorts are separated without representing undefined ROAS as zero or infinity. Existing non-organic metric values remain unchanged. |
| 33 | `expected_raw_records.json` | Adds the organic install row; affected payload digests include the v0.3 SDK version and normalized attribution evidence | New source row and changed normative payload inputs. |
| 33 | `expected_reconciliation.json` | Candidate/reason output follows the v0.3 distinction and versioned imported evidence | H-11 reconciliation semantics are applied consistently. |
| 34 | `expected_attributions.json` | Adds first-party-evidence precedence coverage plus provider-unavailable, version-unsupported, and auth-failure outcomes; former absent status becomes `no_campaign_data` | H-4 and H-9 expose Meta coverage and deterministic precedence. |
| 34 | `expected_deliveries.json` | Adds deliveries for the new synthetic first-party click and Meta status branches | New accepted synthetic source rows. |
| 34 | `expected_logical_events.json` | Adds logical events for the new synthetic first-party click and Meta status branches | New accepted synthetic source rows. |
| 34 | `expected_raw_records.json` | Adds the new records; Meta click/view payload digests change for typed context, `is_ct`, and `actual_timestamp` | H-1 typed evidence and H-4 coverage states alter normative payloads. |

The inherited input files with semantic changes are exactly fixtures 02, 03, 27, 28, 33, and 34. All other inherited input changes are version-only. No inherited golden outside the table changes meaning.

## New fixture and golden ledger

Every new fixture uses synthetic values and includes one input plus all 13 reviewed expected-output classes. Empty arrays are deliberate reviewed results.

| Fixture | Meaningful derived output | Derivation |
| --- | --- | --- |
| 39 `foreign-referrer-unresolved` | `unattributed/foreign_referrer_unresolved` | A third-party referrer classified as foreign has neither a first-party click ID nor a deployment-confirmed Play organic marker. |
| 40 `custom-event-wrapper` | One accepted raw and logical `custom_event` | The closed payload has a synthetic event key, optional USD money, four bounded scalar attributes, and separate Unity wrapper provenance; it creates no attribution or metric. |
| 41 `click-injection-suspected` | One paid attribution plus one public fraud decision | Server CTIT is `9.999` seconds, strictly below the synthetic 10-second policy threshold. Exactly 10 seconds is covered by a negative mutation and emits no suspicion. |

The authoritative derivation details for fixtures 39-41 are also recorded in `fixtures/v0.3/README.md`. No fixture is generated by the validator.

## Inventory reconciliation

The final migration must reconcile this ledger against:

```bash
git diff --name-status --find-renames contract-v0.2.1..HEAD -- fixtures/
git diff --stat contract-v0.2.1..HEAD -- fixtures/
```

The expected new-side inventory is 41 `input.json` files, `41 * 13 = 533` golden files, and one README. The first 38 fixture directories correspond to the v0.2.1 set; fixtures 39-41 add three inputs and 39 goldens. Git rename detection may pair identical metric-definition files across fixture numbers, so reconciliation uses the destination inventory plus the semantic ledger rather than rename similarity alone.

## Consumer migration

1. Pin the previous implementation to the `contract-v0.2.1` tag while preparing the migration.
2. Upgrade schemas, registries, evaluator behavior, fixtures, and golden outputs as one v0.3 unit.
3. Recompute payload, dimension, and snapshot digests only when their normative JCS inputs change; never translate a digest by string substitution.
4. Reject mixed-version artifacts and validate the complete v0.3 suite before accepting deployment-private inputs outside this public repository.
