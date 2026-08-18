# Contract v0.2 fixture provenance

The JSON files in the 27 numbered directories are reviewed, immutable golden contract examples. They are committed as source artifacts; the validation command never creates, updates, or regenerates them.

Each fixture has one synthetic input and 12 independently asserted output classes:

- `expected_raw_records.json`
- `expected_deliveries.json`
- `expected_logical_events.json`
- `expected_corrections.json`
- `expected_privacy_requests.json`
- `expected_privacy_tombstones.json`
- `expected_attributions.json`
- `expected_metric_definitions.json`
- `expected_metric_runs.json`
- `expected_fraud_decisions.json`
- `expected_rejections.json`
- `expected_reconciliation.json`

The validator checks every object against its Draft 2020-12 schema, checks registry references, runs scenario-specific semantic assertions and acceptance assertions, evaluates each input twice in TypeScript, evaluates it independently in Python, and compares RFC 8785 canonical bytes. Deliberate in-memory mutations prove that malformed timestamps, negative money, unknown registry values, changed golden output, input reorder, paid reinstall evidence, record-ID collisions, ambiguous clicks, cross-scope references, and registry/schema drift fail validation or fail closed as specified.

The data is synthetic. It contains no external-source format, campaign data, user data, credential, live fraud rule, or operational threshold.

## Independent third-oracle calculations

These high-value calculations were checked without invoking either reference evaluator.

### Fixture 04: seven-day half-open boundary

The authoritative click time is `2026-08-01T00:00:00.000Z`. Seven days are `7 * 24 * 60 * 60 * 1000 = 604,800,000` milliseconds.

- `install-before` is at `2026-08-07T23:59:59.999Z`, a delta of `604,799,999` ms. It satisfies `click <= install < click + 604,800,000 ms`, so the result is `non_organic/valid_install_referrer`.
- `install-exact` is at `2026-08-08T00:00:00.000Z`, a delta of `604,800,000` ms. The upper bound is exclusive, so the result is `unattributed/window_expired`.
- `install-after` is at `2026-08-08T00:00:00.001Z`, a delta of `604,800,001` ms. It is outside the window, so the result is `unattributed/window_expired`.

### Fixture 08: integer FX and half-even rounding

The late revenue is EUR `123456789012345678 * 10^-18`. The synthetic EUR-to-USD rate is `125000000 * 10^-8`, and the target scale is 6. The integer conversion is:

`123456789012345678 * 125000000 * 10^6 / 10^(18 + 8) = 154320.9862654320975`

Half-even rounding therefore produces `154321` target units, or USD `0.154321`. The initial watermark ends before the revenue delivery and yields `0`; the recalculated watermark includes it and yields `154321`. Separate mutation vectors exercise exact quotient ties: `0.5` rounds to the even integer `0`, and `1.5` rounds to the even integer `2`.

## v0.2 fixture derivations

Fixtures 01 through 19 preserve the reviewed v0.1 scenarios under the v0.2 schemas and semantics. Their per-file changes are recorded in `docs/contract-v0.2-migration.md`. Every fixture now includes the three versioned metric definitions as a twelfth output class.

Each new fixture 20 through 27 contains the same 12 `expected_*.json` artifacts listed above. Empty arrays are deliberate reviewed outputs, not missing assertions.

| Fixture | Independent derivation of the meaningful golden result |
| --- | --- |
| `20-timestamp-invalid` | `2026-02-30T00:00:00.000Z` has the required lexical shape but no real UTC calendar instant. The delivery and rejection use `timestamp_invalid`, discard the payload, retain non-identifying metadata, and emit no raw, logical, attribution, metric, fraud, privacy, correction, or reconciliation result. |
| `21-reconciliation-window-mismatch` | A normalized one-to-one provider-install key joins to `install-21`, freshness is current, and the supplied window state is out of window. With key and candidate present, the first applicable neutral difference is `window_mismatch`. |
| `22-reconciliation-join-key-missing` | The reconciliation input has no typed matching key, candidate, or join. The deterministic neutral result is `join_key_missing`; no provider-quality conclusion is made. |
| `23-reconciliation-freshness-mismatch` | The one-to-one key joins to `install-23` and the window is in range, but freshness is `stale`. The remaining neutral difference is `freshness_mismatch`. |
| `24-attribution-supersession` | The original click and install yield paid last-click attribution. Redacting the click creates a tombstone and correction; the immutable replacement attribution names `supersedes_attribution_id=attr:install-24`, carries redacted click evidence, and is marked `finality=superseded`. |
| `25-replay-suspected` | The unique click remains an accepted delivery. Its synthetic replay marker separately produces one public `suspected/exclude/replay_suspected` fraud decision with protected categorical evidence; it is not classified as `duplicate_delivery`. |
| `26-retention-affected` | Before expiry, USD 2.000000 revenue is included in all three D0 series. Retention purges only the revenue evidence, produces a `retention_expiry` tombstone without a privacy request, and creates three replacement runs with value `0`, `retention_affected`, and explicit supersession links. |
| `27-ad-impression-revenue-link` | One install, one impression, and one USD 3.000000 revenue record share the synthetic impression ID. All three D0 outputs equal `3000000` at scale 6 and cite install, impression, and revenue evidence. |

## Adding a fixture

`fixtures/.candidates/` is a gitignored working area for proposed synthetic inputs. It is outside `fixtures/v0.2/` and is not discovered by `npm run validate`.

1. Create `fixtures/.candidates/<NN-name>/input.json`. Use only synthetic data and keep the proposed number and name stable during review.
2. Run `evaluate()` from `tools/evaluator.ts` manually and run `python tools/python_evaluator.py fixtures/.candidates/<NN-name>/input.json` independently. Save neither command's output as an approved golden automatically.
3. Compare the two outputs, review every field by hand against the schemas and contract, and record the derivation of each meaningful expected value in the pull-request description. Resolve any disagreement before promotion.
4. Promote the reviewed input to `fixtures/v0.2/<NN-name>/`, hand-create the 12 `expected_*.json` output files, and update the named scenario assertions and inventory checks in `tools/validate.ts`. Run `npm run validate` before requesting review.

Golden changes must be reviewed in a commit separate from evaluator or schema behavior changes. The validation command remains read-only and must never promote a candidate or regenerate an expected file.
