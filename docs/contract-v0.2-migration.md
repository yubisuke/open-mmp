# Contract v0.2 Migration

Contract v0.2 is an in-place pre-runtime migration. The `contract-v0.1` Git tag preserves the prior schemas, registries, fixtures, and golden outputs. No production data or incumbent MMP export is part of this migration.

## Required consumer changes

1. Resolve schema IDs ending in `:v0.2` and require `contract_version` and `schema_version` value `0.2.0` where applicable.
2. Load the `*-v0.2.json` registries.
3. Read reviewed fixtures from `fixtures/v0.2/`.
4. Apply the vocabulary, privacy, money, metric-definition, reconciliation, and timestamp rules described by the v0.2 specification.
5. Re-run the read-only validation gate and compare outputs with the reviewed v0.2 goldens.

## Version-identity changes

| Scope | Field or path | Change | Reason |
| --- | --- | --- | --- |
| All schemas | `$id` | `:v0.1` to `:v0.2` | R-15 in-place contract migration. |
| Versioned schemas | `contract_version`, `schema_version`, and contract-bound version constants | `0.1.0` to `0.2.0` | R-15 makes the breaking semantic repair an explicit contract line. |
| Registries | filename and `contract_version` | `*-v0.1.json` / `0.1.0` to `*-v0.2.json` / `0.2.0` | Keeps registry identity aligned with the active contract. |
| Fixtures | directory | `fixtures/v0.1/` to `fixtures/v0.2/` | R-15 preserves v0.1 at the `contract-v0.1` tag and advances the active evidence set. |
| Reference evaluators | contract-bound output versions | `0.1.0` to `0.2.0` | Outputs declare the semantics that produced them. |

## Golden-output change ledger

The final ledger below lists every changed `expected_*.json` file, every changed field group, and the governing decision. Pure path moves with byte-identical contents are not golden value changes. New fixtures are listed with all twelve expected artifact files and their derivation in `fixtures/v0.2/README.md`.

<!-- The exhaustive reviewed ledger is completed with the semantic fixture commits. -->
