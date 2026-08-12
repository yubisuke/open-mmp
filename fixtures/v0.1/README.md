# Contract v0.1 fixture provenance

The JSON files in the 19 numbered directories are reviewed, immutable golden contract examples. They are committed as source artifacts; the validation command never creates, updates, or regenerates them.

Each fixture has one synthetic input and 11 independently asserted output classes:

- raw records
- event deliveries
- logical events
- corrections
- privacy requests
- privacy tombstones
- attribution results
- metric runs
- public fraud-decision envelopes
- non-identifying rejections
- shadow reconciliation results

The validator checks every object against its Draft 2020-12 schema, checks registry references, runs scenario-specific semantic assertions and acceptance assertions, evaluates each input twice in TypeScript, evaluates it independently in Python, and compares RFC 8785 canonical bytes. Deliberate in-memory mutations prove that malformed timestamps, negative ad revenue, unknown registry values, changed golden output, input reorder, paid reinstall evidence, record-ID collisions, ambiguous clicks, and cross-scope references fail validation or fail closed as specified.

The data is synthetic. It contains no external-source format, campaign data, user data, credential, live fraud rule, or operational threshold.
