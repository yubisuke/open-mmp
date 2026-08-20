# Open MMP

Open MMP is an early-stage project for a self-hostable, open-source Mobile Measurement Partner whose measurement evidence can be audited and reproduced.

## Why this project exists

Independent measurement systems can produce totals that need transparent evidence to reconcile: raw events, attribution decisions, metric definitions, attribution logic, and pricing or cost assumptions. Open MMP starts in complementary shadow mode alongside an existing MMP, so neutral measurement differences can be explained before any primary migration.

The project focuses on auditable, open event and metric contracts that independent implementations can reproduce from synthetic fixtures. Deployment-specific data, credentials, and live fraud defenses remain private. It is designed to make measurement more transparent without enabling device fingerprinting or cross-app tracking.

This is an early runtime-stage project, not a production-ready MMP.

## License

This project is licensed under the [Apache License 2.0](LICENSE); attribution is recorded in [NOTICE](NOTICE). The project maintainer must complete a name and trademark clearance before the first public release; this is a release prerequisite, not a claim of trademark rights. Security reporting follows [SECURITY.md](SECURITY.md).

## Current status

This project contains the v0.3.1 contract, the M1a Shadow ledger/import foundation, the M1b cohort metric and difference-audit runtime, and the M2 Android/Unity implementation. M2 adds a portable measurement-link redirector, HMAC-authenticated durable SDK ingestion, a Kotlin SDK with a backup-excluded Room queue and Install Referrer readers, server-side Meta Install Referrer decryption over synthetic vectors, MAX ILRD mapping, a Unity UPM bridge, Android samples, and synthetic JVM/emulator gates. Real provider connectivity, real-device and campaign validation, a production deployment, and exact 4-vCPU/8-GB capacity validation have not been demonstrated. Immutable baselines are available at the `contract-v0.1` and `contract-v0.2.1` Git tags.

The first product entry point is a Shadow MMP that runs alongside an existing provider. It normalizes first-party events, existing MMP exports, media cost, and revenue into a common contract, then explains neutral differences through candidate evidence, exclusion reasons, attribution windows, ID joins, and recalculation history. Difference reasons describe measurement semantics, not provider quality. It must not be treated as the primary MMP until a real shadow pilot has produced sufficient evidence.

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

## Runtime layout

```text
apps/
  api/                 # Management and reporting API
  redirector/          # Measurement links and redirects
  worker/              # Attribution and recalculation jobs
  dashboard/           # Management UI, later in the MVP
packages/
  contracts/           # API schemas and shared types
  attribution-core/    # Pure attribution logic
  redirector-core/     # Portable redirect and referrer behavior
  meta-install-referrer/ # Synthetic AES-GCM decryption core
sdk/
  android/             # Kotlin SDK, optional provider modules, and native sample
  unity/               # UPM package, Android bridge, sample, and compile probe
docs/
```

Implemented runtime code lives in `apps/api`, `apps/redirector`, `apps/worker`, `apps/runtime`, `packages/contracts`, `packages/attribution-core`, `packages/redirector-core`, `packages/meta-install-referrer`, `sdk/android`, and `sdk/unity`. The iOS SDK and dashboard remain planned.

## Current layout (v0.3 contract artifacts)

- `schemas/` — Draft 2020-12 artifact schemas, including event payloads under `schemas/events/`
- `registries/` — versioned closed vocabularies and compatibility definitions
- `fixtures/v0.3/` — reviewed synthetic inputs and immutable golden outputs
- `spec/` — normative contract behavior and serialization rules
- `tools/` — TypeScript and Python reference evaluators and contract validation
- `issue-drafts/` — historical design and acceptance records

## Documents

- [Product scope](docs/product-scope.md)
- [Architecture](docs/architecture.md)
- [Privacy and security](docs/privacy-security.md)
- [Initial threat model](docs/threat-model.md)
- [Roadmap](docs/roadmap.md)
- [Project plan](docs/project-plan.md)
- [Issue #1 draft](issue-drafts/001-event-metric-contract-v0.1.md)
- [Primary references](docs/references.md)
- [Event & Metric Contract v0.3](spec/event-metric-contract-v0.3.md)
- [Contract v0.3 migration guide](docs/contract-v0.3-migration.md)
- [Schema versioning policy](docs/schema-versioning.md)
- [Operator real-data validation checklist](docs/validation/real-data-checklist.md)
- [M2 device and provider validation checklist](docs/validation/m2-device-checklist.md)

## Five-minute synthetic quickstart

Requirements: Docker with Compose, Node.js 22.18.0, and npm 11.6.2. From a clean clone, run:

```bash
docker compose up -d --wait
npm run demo:metrics
```

The bootstrap service generates local secrets, migrations run automatically, and the API and worker start only after PostgreSQL is healthy. `demo:metrics` prints tenant-scoped ledger counts plus a clearly labelled contract-synthetic preview. The preview is calculated from fixture 33 and does not claim that a real provider or campaign was queried. Its key values are:

The API listens on `http://localhost:8080` and the portable redirector on `http://localhost:8090`. Tracking links are created through the authenticated management route; request query parameters and headers can never override their stored destinations. SDK enrollment and event delivery use the HMAC signing string fixed in [M2 Design Baseline](docs/design/m2-baseline.md).

```json
{
  "synthetic_contract_preview": [
    { "metric_name": "d7_roas", "value_unscaled": "1500000", "ratio_scale": 6 },
    { "metric_name": "retention_d1", "value_unscaled": "1000000", "ratio_scale": 6 }
  ]
}
```

To load all reviewed contract fixtures through the real PostgreSQL ingestion path and compare database artifacts with their immutable goldens, run:

```bash
docker compose --profile seed run --rm seed
npm run verify:parity
```

This quickstart uses synthetic inputs only. Do not place provider exports, credentials, real user data, campaign values, or validation results in this public repository.

## Android and Unity SDK development

Requirements: JDK 17 and Android SDK 36. The Android project uses a checksum-pinned Gradle 8.13 wrapper. From the repository root:

```bash
./sdk/android/gradlew -p sdk/android androidAcceptance verifySdkSbom
./sdk/android/gradlew -p sdk/android :sample:connectedDebugAndroidTest
dotnet run --project sdk/unity/tests/UnityCompileProbe.csproj --configuration Release
```

The second command requires a running API 36 emulator. The first command compiles every documented Install Referrer 2.2 accessor, tests queue/consent/Meta/MAX behavior, verifies the merged manifest and backup rules, builds the native sample, and writes `sbom/sdk-android.cdx.json`. The Unity command is a shim compile and callback-concurrency gate; an actual Unity export remains an operator procedure. M2 distributes source and local build instructions only, not Maven or UPM registry artifacts.

## Contract validation

Use Node.js 22.18.0 from [`.nvmrc`](.nvmrc), npm 11.6.2 from `package.json#engines`, and Python 3.13.5 from [`.python-version`](.python-version). The repository enforces the Node.js and npm engines through [`.npmrc`](.npmrc). Then run:

```bash
npm ci
python -m pip install --require-hashes --requirement requirements-contract.txt
npm run validate
```

Validation is read-only. It checks 27 schemas, 8 registries, 42 reviewed synthetic fixtures, 546 golden output artifacts across 13 classes, 42 scenario assertions, 26 acceptance criteria, semantic and metamorphic mutations, deterministic TypeScript output, independent Python output, and RFC 8785 conformance. See the [fixture provenance note](fixtures/v0.3/README.md).
