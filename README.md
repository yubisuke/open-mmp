# Open MMP

Open MMP is an early-stage project for a self-hostable, open-source Mobile Measurement Partner whose measurement evidence can be audited and reproduced.

## Why this project exists

Mobile measurement can expose totals without enough evidence to reproduce them: raw events, attribution decisions, metric definitions, attribution decision logic, and pricing or cost assumptions may remain black boxes. Open MMP starts in shadow mode alongside an existing MMP, so differences can be explained before any primary migration.

The project focuses on auditable, open event and metric contracts that independent implementations can reproduce from synthetic fixtures. Deployment-specific data, credentials, and live fraud defenses remain private. It is designed to make measurement more transparent without enabling device fingerprinting or cross-app tracking.

This is an early design-stage project, not a production-ready MMP.

## Current status

This project is currently in the design phase. The repository contains documentation only; no runtime code has been generated.

The first product entry point is a Shadow MMP that runs alongside an existing provider. It normalizes first-party events, existing MMP exports, media cost, and revenue into a common contract, then explains differences through candidate evidence, exclusion reasons, attribution windows, ID joins, and recalculation history. It must not be treated as the primary MMP until a real shadow pilot has produced sufficient evidence.

The first native attribution vertical slice targets Android:

1. A user opens a measurement link.
2. The redirector passes a click ID to Google Play through Install Referrer.
3. The Android SDK reads Install Referrer on first launch.
4. The SDK sends an install record to the ingestion API.
5. The attribution engine deterministically matches the click and install.
6. Reporting separates organic and non-organic installs and groups results by campaign.

## Principles

- Privacy by default
- No device fingerprinting
- Raw evidence, normalized records, decisions, and aggregates remain traceable
- Deterministic and aggregate privacy-preserving measurement remain distinct
- Received evidence is append-only; corrections are new records, and valid deletion requests produce redacted tombstones
- The measurement core is open; deployment secrets and live fraud policy remain private
- SDK, ingestion, attribution, and reporting are loosely coupled
- Start with PostgreSQL and add analytical infrastructure only when measured load requires it

## Planned layout

```text
apps/
  api/                 # Management and reporting API
  redirector/          # Measurement links and redirects
  worker/              # Attribution and recalculation jobs
  dashboard/           # Management UI, later in the MVP
packages/
  contracts/           # API schemas and shared types
  attribution-core/    # Pure attribution logic
sdks/
  android/             # Kotlin SDK and Unity bridge
  ios/                 # Swift SDK, Phase 2
docs/
```

This is a proposed implementation layout, not generated code.

## Documents

- [Product scope](docs/product-scope.md)
- [Architecture](docs/architecture.md)
- [Privacy and security](docs/privacy-security.md)
- [Roadmap](docs/roadmap.md)
- [Project plan](docs/project-plan.md)
- [Issue #1 draft](issue-drafts/001-event-metric-contract-v0.1.md)
- [Primary references](docs/references.md)
