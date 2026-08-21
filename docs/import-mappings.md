# Import Mapping DSL

Runtime import mappings are schema-validated JSON documents. Public files under `examples/mappings/` contain synthetic values only; deployment-specific provider column names and certification evidence remain private.

## Row selection

The original single equality clause remains valid:

```json
"row_filter": { "source": "event_type", "equals": "click" }
```

An array means logical AND. Every clause must match for the row to be mapped:

```json
"row_filter": [
  { "source": "event_type", "equals": "click" },
  { "source": "row_status", "equals": "accepted" }
]
```

See `examples/mappings/synthetic-and-filter-click.json`.

The import CLI lints only the mapping selected by `--source`; unrelated JSON files beside it are never loaded. To lint a deliberately curated directory of sibling mappings for producer-wide event-ID overlap, add `--lint-directory=<directory>`.

## Conditional source columns

`fallback_column` is read only when the primary `source` is absent, null, or an empty string. It is intentionally one level deep; chained conditional programs are outside this DSL.

```json
{ "source": "primary_event_id", "fallback_column": "legacy_event_id" }
```

See `examples/mappings/synthetic-fallback-install.json`.

## Optional empty columns

`omit_if_empty: true` removes an optional target when its evaluated source is an empty string, `null`, or absent. This permits one mapping to accept mixed rows such as attributed and organic exports without emitting contract-invalid empty strings. Mapping load rejects this option on fields that the selected event schema requires.

```json
{ "source": "network", "omit_if_empty": true }
```

See `examples/mappings/synthetic-optional-columns-click.json`.

## Integer money

An integer source stays a base-10 string and is paired with the declared scale. This avoids binary floating-point conversion and preserves arbitrarily large CSV integers exactly. Negative values, decimal points, exponent notation, and unsafe JSON numbers are rejected.

```json
{ "source": "cost_micros", "money": { "input": "integer", "scale": 6, "currency_source": "currency" } }
```

See `examples/mappings/synthetic-integer-cost.json`.

## Decimal money

A decimal input must be a non-negative base-10 string without exponent notation. The mapper appends zeros up to the declared scale and never passes the value through binary floating point. If the source has more fractional digits than the declared scale, the row is rejected instead of rounded. Numeric JSON values are rejected in decimal mode so their original decimal representation cannot be lost.

```json
{ "source": "cost_decimal", "money": { "input": "decimal", "scale": 6, "currency_source": "currency" } }
```

For example, `1.23` at scale 6 becomes `amount_unscaled=1230000` and `amount_scale=6`. See `examples/mappings/synthetic-decimal-cost.json`.

The operator entry points are `npm run import:cost -- --file=<csv> --mapping=<json>` and `npm run metrics:run -- --date=<YYYY-MM-DD> --definitions=<json> [--watermark=<ISO8601>]`. The definitions document supplies tenant/app scope, one fixed FX policy, and one or more metric-name/grouping requests. `--date` supplies a default `cohort_date` only when an evaluation does not declare one. The watermark defaults to the following UTC midnight; an explicit canonical UTC watermark permits late-imported historical cohorts to be backfilled. Both commands use the same persistence and cohort-engine functions as the integration tests.

## Producer-wide event IDs

The contract idempotency key excludes `event_name`. If multiple mappings for the same tenant, app, and provider reuse one source ID column, give each route a stable, distinct `prefix`. The CLI emits `event_id_source_reused_across_routes` when sibling mappings overlap without disjoint prefixes. See `synthetic-shared-id-click.json` and `synthetic-shared-id-install.json` for the safe pattern.
