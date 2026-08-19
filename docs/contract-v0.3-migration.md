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

The H-1 through H-12 and F11/F12 field-level changes are added here in the stage that implements each behavior.

## Existing golden-output ledger

This ledger is completed before review. It is exhaustive relative to `contract-v0.2.1`; a changed golden file not listed here is a migration defect.

## New fixture and golden ledger

Every new fixture uses synthetic values and includes one input plus all reviewed expected-output classes. Its independent derivation is recorded here and in `fixtures/v0.3/README.md`.

## Inventory reconciliation

The final migration must reconcile this ledger against:

```bash
git diff --name-status --find-renames contract-v0.2.1..HEAD -- fixtures/
git diff --stat contract-v0.2.1..HEAD -- fixtures/
```

## Consumer migration

1. Pin the previous implementation to the `contract-v0.2.1` tag while preparing the migration.
2. Upgrade schemas, registries, evaluator behavior, fixtures, and golden outputs as one v0.3 unit.
3. Recompute payload, dimension, and snapshot digests only when their normative JCS inputs change; never translate a digest by string substitution.
4. Reject mixed-version artifacts and validate the complete v0.3 suite before accepting deployment-private inputs outside this public repository.
