# Open MMP Project Plan

## Product hypothesis

Open MMP does not begin by copying every feature of an established MMP. It begins by solving two problems: measurements that cannot be explained and economics that cannot be tied to visible processing and storage costs.

The product therefore starts as a Shadow MMP alongside an existing provider.

- Store first-party events independently
- Normalize existing MMP and media outputs into a common contract
- Recalculate attribution and revenue under explicit definitions
- Explain discrepancies through candidates, exclusion reasons, windows, joins, and freshness
- Move a measurement path to primary status only after a real shadow pilot validates it

## Open and private boundaries

### Open

- Event and Metric Contract
- Attribution algorithms and versions
- Database schema and recalculation model
- Duplicate, conflict, delay, and missing-data fixtures
- Fraud evidence types and reason taxonomy
- Media-adapter interfaces and declared support status
- Infrastructure-cost calculation method

### Private and deployment-specific

- API keys, signing keys, and media tokens
- Live fraud thresholds and rule combinations
- Detection-model weights
- IP, device, and operator watchlists
- Detection-response timing
- Real user and campaign evidence

Fraud decisions retain evidence references, reason codes, rule-bundle versions and digests, evaluation time, action, and supersession history. A later delayed-transparency policy for retired rules may be considered, but it is not part of v0.1.

## Execution phases

### Phase 0: Contract

Produce `Open MMP Event & Metric Contract v0.1`:

- Raw-record envelope
- Click, install, and session core events
- Schema-only revenue, purchase, consent, privacy, and fraud extensions
- Orthogonal lifecycle and quality states
- Attribution result and reason registry
- Explicit D0 24-hour, UTC-calendar, and JST-calendar definitions
- Synthetic fixtures and a pure reference evaluator

### Phase 1: Shadow ledger

- PostgreSQL received-evidence ledger
- Normalized logical records
- Import API and CSV import
- Recalculable metric engine
- Difference-audit API

The first goal is to explain differences between existing MMP raw output and first-party evidence.

### Phase 2: Android and Unity vertical slice

- Unity C# SDK
- Android Kotlin bridge
- Google Play Install Referrer
- Deep links
- MAX ad-revenue callback
- Persistent queue, retry, and idempotency
- Versioned last-click attribution

### Phase 3: Trust and fraud boundary

- Replay evidence using nonce, time, and event IDs
- Play Integrity integration
- Click and install time consistency
- Append-only evidence and supersedable decisions
- Signed, least-privilege media adapters
- Adapter certification against public fixtures

### Phase 4: Media adapters

Add public and verifiable paths first:

1. First-party ads and referral URLs
2. AppLovin MAX ad revenue
3. Google Ads third-party provider flow
4. Apple Ads
5. AdAttributionKit
6. Networks requiring additional approval or contracts

Each adapter declares `official | approval_pending | experimental | unsupported`.

### Phase 5: Production pilot

- Three-to-five-month real-campaign shadow comparison
- Missing, duplicate, delayed, and reinstall measurement
- Consent withdrawal and deletion end-to-end tests
- Backup and restore
- Failure exercises and audit review
- Decision on which paths, if any, can become primary

## Evidence gates

A phase completes through measurable evidence, not code completion alone.

- Raw counts and aggregates can be recalculated under identical conditions
- Every exclusion has a reason code
- A fixed policy version reproduces a historical decision
- Duplicate, conflict, delay, deletion, and aggregate fixtures pass automatically
- Platform approval, device validation, and campaign validation remain labeled unverified until actually completed

## Rough estimate

- Contract and working prototype: 2–4 weeks
- Production pilot: approximately 3–5 months with two backend/Unity contributors and part-time security support
- Media approvals and campaign observation: additional elapsed time

AI can accelerate implementation, fixtures, documentation, adapters, and discrepancy analysis. It cannot shorten platform approval, device-signal delivery, real-campaign observation, consent behavior, or restore testing.
