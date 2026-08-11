# Roadmap

## Milestone 0: Event & Metric Contract v0.1

- Versioned event envelope and raw-record contract
- Attribution result, reason codes, and state transitions
- Retraction, redaction, and privacy-request contracts
- D0 24-hour, UTC calendar-day, and JST calendar-day definitions
- Synthetic duplicate, conflict, late, missing, and aggregate fixtures
- Public fraud-evidence schema and private live-policy boundary
- Pure reference evaluator
- Project name, license, and Android sample package decision as separate bootstrap tasks

Evidence gate: An independent implementation can reproduce the expected canonical outputs from the same fixtures and policy versions.

## Milestone 1: Shadow ledger

- PostgreSQL append-only received-evidence layer
- Lawful correction and redaction records
- Existing MMP and media-output import
- Normalization and deterministic recalculation
- Difference-audit API for candidates, exclusions, windows, joins, and freshness
- Docker Compose and automated tests

Evidence gate: The same inputs and policy versions reproduce the same aggregate and the same difference reasons.

## Milestone 2: Android and Unity SDK

- Unity C# SDK and Android Kotlin bridge
- Google Play Install Referrer client
- Offline queue, retry, and batch delivery
- SDK disablement and identifier reset
- Sample application
- MAX ad-revenue callback
- Device and Play internal-testing validation procedure

Evidence gate: A Google Play first launch retrieves the click evidence and produces one non-conflicting install record.

## Milestone 3: Minimal dashboard

- App registration
- Measurement-link creation
- Daily clicks and installs
- Organic, non-organic, and unattributed breakdown
- CSV export
- Attribution method, policy version, and data-freshness display

Evidence gate: Raw records, reporting API, and dashboard match under identical filters and definitions.

## Milestone 4: iOS privacy-preserving measurement

- AdAttributionKit and SKAdNetwork postback receipt
- Signature and transaction-ID verification
- Conversion-tag and value policy
- Aggregate reporting
- UI that does not mix aggregate iOS reports with deterministic Android attribution

Evidence gate: Apple test procedures produce verified, replay-resistant postbacks and aggregate results.

## Milestone 5: Production and fraud boundary

- Tenant isolation and RBAC
- Rate limiting
- Backup and restore
- Deletion-request end-to-end flow
- OpenTelemetry and load tests
- SDK distribution and compatibility policy
- Play Integrity and App Attest integration
- Rule-bundle versions, digests, and supersession history
- Signed, least-privilege media adapters with fixture certification

Evidence gate: A production pilot completes backup restoration, deletion, replay, failure, and shadow-reconciliation exercises with documented evidence.

## Immediate next step

Complete the `Open MMP Event & Metric Contract v0.1` tracking Epic before generating runtime code. This step requires no external service or GitHub access.
