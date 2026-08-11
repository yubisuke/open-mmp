# [Epic] Define Open MMP Event & Metric Contract v0.1

## Background

Implementing a replacement MMP before fixing the contract would mix media-specific behavior, metric definitions, duplicate handling, late data, privacy-preserving APIs, and fraud controls. The result would be difficult to reproduce or audit.

The first milestone is a shared Event & Metric Contract for SDKs, servers, media adapters, and shadow reconciliation. Before runtime implementation, the project must define what constitutes received evidence, how it is normalized, and which inputs and policy versions produced each attribution and metric.

This issue is the tracking Epic for Contract v0.1. PostgreSQL, HTTP APIs, SDKs, and live media integrations belong to follow-up issues.

## Goals

- Define a common contract that can recalculate attribution and metrics from received evidence
- Separate raw records, deliveries, logical events, corrections, and derived decisions
- Distinguish deterministic, platform-assigned, aggregate, and unknown attribution
- Represent duplicate delivery, ID conflict, lateness, correction, and deletion without hiding them
- Split ambiguous metrics such as D0 into explicit time definitions
- Separate the public fraud-evidence contract from private live defenses

## v0.1 boundary

### Core contract

- Raw-record envelope and schema versioning
- `click`, `install`, and `session_start`
- Delivery, duplicate, conflict, timeliness, and record lifecycle
- Correction and retraction
- Attribution result
- D0 metric definitions
- Synthetic fixtures and a pure reference evaluator

### Schema-only extensions

- `ad_impression` and `ad_revenue`
- `purchase` and `refund`
- `consent_changed`
- Privacy-request control plane
- Fraud-decision envelope

Schema-only extensions define shapes and states. They do not implement SDK collection, media connectivity, the fraud engine, or the deletion execution system.

## Work package 1: Schema foundation

- Use JSON Schema Draft 2020-12
- Give every schema a stable `$id` and Semantic Version
- Reject unknown fields by default in v0.1 and document explicit extension points
- Define breaking and non-breaking changes and version resolution
- Store timestamps as UTC RFC 3339 and fix the accepted precision
- Express reporting time zones with IANA time zone names

## Work package 2: Raw-record envelope

Define at least:

- `record_id`
- `tenant_id`
- `app_id`
- `producer`
- `producer_version`
- `source`
- `source_event_id`, when available
- `event_id`
- `delivery_id`
- `event_name`
- `schema_version`
- `payload_sha256`
- `occurred_at`
- `occurred_at_source`
- `received_at`, assigned by the server
- `raw_payload_ref`

Fix the JSON canonicalization method, character encoding, and hash algorithm used for `payload_sha256`. Distinguish the protected raw payload from a reference or digest that may be exposed through an audit API.

Define identifier ownership and cardinality:

- The ingestion service generates `record_id` and `delivery_id`.
- The producer generates `event_id`, which identifies one logical event within the tenant, app, and producer scope.
- `payload_sha256` hashes the canonical logical-event payload and excludes retry or transport metadata.
- The server assigns authoritative `tenant_id` and `app_id` from the authenticated SDK key or adapter configuration. Client-supplied values are non-authoritative consistency checks and a mismatch is rejected.

## Work package 3: Idempotency and orthogonal state axes

### Idempotency

- Use `(tenant_id, app_id, producer, event_id)` as the logical-event uniqueness key
- Classify the same key and same `payload_sha256` as `duplicate_delivery`
- Classify the same key and different digest as `event_id_conflict`
- Preserve conflict evidence but exclude it from derived processing
- Treat `replay_suspected` as a fraud decision, not duplicate resolution

### State axes

- Ingestion: `received | accepted | rejected`
- Duplicate resolution: `unique | duplicate_delivery | event_id_conflict`
- Timeliness: `on_time | late`
- Record lifecycle: `active | retracted | redacted`
- Attribution finality: `pending | provisional | final | superseded | retracted`
- Privacy request: `received | processing | completed | failed`

Define allowed transitions, terminal states, and reason codes. Do not combine unrelated concepts into one `data_quality_status`.

## Work package 4: Event contracts

### Core

- `click`: `click_id`, `tracking_link_id`, and `campaign_id`
- `install`: `installation_id`, protected referrer evidence reference, `referrer_click_at`, `install_begin_at`, and `referrer_read_at`
- `session_start`: `installation_id` and a session identifier

### Schema-only

- `ad_impression` and `ad_revenue`: `impression_id`, `ad_unit_id`, `ad_network`, `amount_unscaled`, `amount_scale`, `currency`, and `revenue_source`
- `purchase` and `refund`: `transaction_id`, `original_transaction_id`, `amount_unscaled`, `amount_scale`, `currency`, `financial_status`, and a correction target reference
- `consent_changed`: `consent_state`, `effective_at`, and `consent_policy_version`

Use a closed `consent_state` enum: `granted | denied | withdrawn | not_required | unknown`. Define required, optional, and prohibited fields, units, and whether negative values are valid for every event type.

Define consent handling by versioned processing purpose:

- The server, not the SDK, assigns whether a configured processing purpose requires consent.
- Accepted and rejected records retain `processing_purpose_id`, `consent_evaluation_policy_version`, and `consent_decision_reason_code` so the decision can be reproduced.
- After `withdrawn`, an event for a consent-required purpose is rejected and only non-identifying rejection metadata is retained; the event payload is discarded or immediately redacted.
- `consent_changed` and privacy-control records remain acceptable so withdrawal and deletion can complete.
- A purpose explicitly configured as `not_required` may continue only under the versioned server policy and applicable platform and legal requirements.
- Fixtures must cover the rejection and redaction behavior after withdrawal.

## Work package 5: Correction and deletion

### Correction contract

- `tenant_id`
- `app_id`
- `correction_id`
- `corrects_record_id`
- `correction_type`
- `correction_reason`
- `effective_at`

Do not overwrite received evidence. Represent corrections, retractions, refunds, and recalculated decisions through causal records.

### Privacy-request control plane

- `tenant_id`
- `app_id`, when the request is app-scoped
- `privacy_request_id`
- `deletion_subject_ref`
- `deletion_scope`
- `requested_at`
- `status`

Replace identifiable raw payloads subject to a valid deletion request with non-identifying redacted tombstones. Append-only design must not preserve identifiable deleted payloads. Define how derived attribution and aggregates are recalculated and how non-identifying audit evidence remains.

Correction and privacy references must resolve only within the same tenant and, when applicable, the same app.

## Work package 6: Attribution result

Define at least:

- `attribution_id`
- `tenant_id`
- `app_id`
- `subject_scope`: `user_level | aggregate`
- `subject_ref`
- `status`: `organic | non_organic | unattributed`
- `method`
- `model`
- `reason_code`
- `reason_code_version`
- `evidence_refs`
- `effective_at`
- `decided_at`
- `input_cutoff_at`
- `finality`
- `rule_bundle_id`
- `rule_bundle_version`
- `rule_bundle_hash`
- `supersedes_attribution_id`, when recalculated

Freeze the following behavior through a compatibility table and versioned reason-code registry:

- `organic`: the required inputs show that no valid paid candidate exists
- `unattributed`: missing, conflicting, expired, or otherwise insufficient inputs prevent a valid attribution
- `aggregate`: `installation_id` is prohibited; aggregate evidence must not be forced into a user-level record
- Valid combinations of `method`, `model`, `subject_scope`, and `status`

Represent a media API as provenance, not as an ambiguous `method=media_api` value.

## Work package 7: Metric definitions

Each metric definition and run includes:

- Metric name and `metric_definition_version`
- Anchor event
- Half-open window
- Aggregation time zone
- Attribution rule-bundle ID, version, and digest
- `input_received_at_watermark`
- `input_snapshot_id` or an immutable `input_ledger_position`
- `computed_at`
- Data freshness

Represent source money without precision loss using integer-string `amount_unscaled`, integer `amount_scale`, and ISO 4217 `currency`. For example, `amount_unscaled="123"` and `amount_scale=6` represents `0.000123` currency units. ISO 4217 currency exponent and media-reported precision are separate concepts. A display-oriented `amount_minor` may be derived but is not the source value. Converted results include `fx_rate`, `fx_rate_source`, `fx_rate_as_of`, `fx_policy_version`, and `rounding_mode`.

The input snapshot fixes the exact eligible record set, including ordering, retractions, and redactions. A timestamp watermark remains a freshness indicator but is not sufficient to identify the input set. If a ledger position is used, define a total ordering such as `(received_at, record_id)` and an inclusive upper bound.

Define at least these separate v0.1 metrics:

- `d0_install_to_24h_ad_revenue_usd`: `[install.occurred_at, install.occurred_at + 24h)`
- `d0_utc_install_calendar_ad_revenue_usd`
- `d0_jst_install_calendar_ad_revenue_usd`

The D1 and D7 catalogs are follow-up issues. v0.1 only needs to prove that the same contract can add them without changing raw records.

## Work package 8: Fraud-decision envelope

The public contract includes only the following types:

- `fraud_decision_id`
- `subject_ref`
- `decision`: `clear | suspected | confirmed`
- `action`: `allow | flag | exclude | quarantine`
- Versioned reason code
- `evidence[]`: `type`, `captured_at`, `digest`, and `access_class`
- Rule-bundle ID, version, digest, and hash algorithm
- `evaluated_at`
- `supersedes_fraud_decision_id`

Publish schemas, high-level reason categories, synthetic fixtures, and visibility classes. Keep actual production evidence, IP and User-Agent values, device or operator watchlists, live thresholds, model weights, keys, and response timing private and access-controlled.

## Work package 9: Synthetic fixtures and reference evaluator

Cover at least:

1. Valid Install Referrer attribution
2. Organic install with no referrer
3. Unknown click ID
4. Immediately before, exactly at, and immediately after the seven-day boundary
5. Duplicate delivery
6. Same event ID with a different payload
7. Same ID across tenants
8. Late ad revenue and an input watermark
9. UTC and JST calendar-boundary difference
10. Reinstall or redownload
11. Event after consent withdrawal
12. Out-of-order correction and refund
13. Suspected replay
14. Redaction and recalculation after deletion
15. Rejection of an aggregate result joined to an installation

Each fixture contains:

- `input.json`
- `expected_raw_records.json`
- `expected_attributions.json`
- `expected_metric_runs.json`
- `expected_rejections.json`

With fixed time, FX, and rule digests, run a pure evaluator twice and require identical canonicalized output.

Although `ad_revenue` is a schema-only integration extension, the reference evaluator must validate its schema and use its high-precision source amount in D0 fixture calculations. No live media connection is required.

## Deliverables

- `spec/event-metric-contract-v0.1.md`
- `schemas/raw-record.schema.json`
- `schemas/events/*.schema.json`
- `schemas/attribution-result.schema.json`
- `schemas/metric-definition.schema.json`
- `schemas/correction.schema.json`
- `schemas/privacy-request.schema.json`
- `schemas/fraud-decision.schema.json`
- `registries/reason-codes-v0.1.json`
- `fixtures/v0.1/**`
- State-transition and method/model/subject compatibility tables
- Pure reference evaluator and one validation command

## Acceptance criteria

- [ ] Every schema validates under Draft 2020-12 and has a stable `$id` and version
- [ ] `event_name` is canonical across documents, examples, and schemas
- [ ] Raw record, delivery, logical event, correction, and derived result are separate concepts
- [ ] Tenant-scoped idempotency, duplicate delivery, and event-ID conflict are covered by fixtures
- [ ] Authoritative tenant and app scope comes from server authentication context, and a client mismatch is rejected
- [ ] Orthogonal state axes and allowed transitions are fixed in a machine-readable form or table
- [ ] Attribution requires scope, method, model, reason, policy version, and input cutoff
- [ ] Fixtures distinguish organic from unattributed
- [ ] A fixture attaching `installation_id` to an aggregate result is rejected
- [ ] D0 24-hour, UTC calendar-day, and JST calendar-day metrics recalculate independently
- [ ] Currency, FX, rounding, and input watermark produce reproducible results
- [ ] High-precision source amounts survive ingestion without conversion to currency minor units
- [ ] An immutable input snapshot or ledger position fixes the exact records used by each metric run
- [ ] Correction, retraction, redaction, and post-deletion recalculation are fixture-tested
- [ ] Events requiring consent are rejected and payload-redacted after withdrawal, while consent and privacy control records remain processable
- [ ] The public fraud schema and private live-policy boundary are documented
- [ ] One documented command validates every schema and fixture
- [ ] Running the same fixture twice produces identical canonicalized output

## Out of scope

- PostgreSQL ledger and HTTP ingestion implementation
- Unity, Android, and iOS SDKs
- Live Install Referrer, MAX, or media-API connectivity
- Dashboard, RBAC, monitoring, and backup implementation
- Production fraud engine and live thresholds
- API keys, signing keys, media tokens, real campaigns, and real user data
- Disabling an existing MMP
- ClickHouse, Kafka, and other scaling infrastructure
- Final project name, license, repository visibility, and package identifiers

## Follow-up issue candidates

1. Implement Contract validation CI and the reference evaluator
2. Implement the PostgreSQL Shadow ledger
3. Import existing MMP raw output and expose discrepancy evidence
4. Implement the Unity C# SDK and Android Kotlin bridge
5. Implement the Google Play Install Referrer vertical slice
6. Connect MAX ad-revenue events to the common contract
7. Implement privacy deletion and redaction end to end
8. Implement the fraud rule-bundle and audit-history boundary
9. Implement adapter support status and fixture certification
10. Add the D1 and D7 metric catalogs
11. Implement the Reporting API and dashboard
12. Implement backup, restore, observability, and RBAC
13. Define the Shadow pilot and primary-migration evidence gate

## Primary references

- https://developer.android.com/google/play/installreferrer
- https://developer.apple.com/documentation/AdAttributionKit
- https://developers.google.com/app-conversion-tracking/api
- https://developers.applovin.com/en/max/advanced-features/s2s-impression-level-api/
