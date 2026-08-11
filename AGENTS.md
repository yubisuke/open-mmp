# AGENTS.md

## Project

- This folder contains the development work for a self-hostable, open-source Mobile Measurement Partner.
- Project documentation, GitHub issues, pull requests, and release notes must be written in English by default.
- Code identifiers and API field names must use English.
- The initial product entry point is a Shadow MMP. The first native attribution vertical slice targets Android and Unity.
- `docs/roadmap.md` is the canonical milestone sequence. When a milestone, exit gate, or ordering changes, update its project-plan crosswalk in that file and the corresponding summary in `docs/project-plan.md` in the same change.

## GitHub boundary

- Use the `yubisuke` account only when the user explicitly authorizes that specific GitHub operation.
- Without explicit authorization, do not authenticate with `gh`, read through the authenticated account, create or modify repositories, add or change remotes, run `git push`, or create issues, pull requests, or releases.
- Do not infer a repository name or visibility setting.
- Before any GitHub write, verify the account, exact `OWNER/REPO`, visibility, and operation.
- Local design, implementation, and testing do not imply that anything has been published to GitHub.

## Product constraints

- Do not implement device fingerprinting.
- The SDK must not collect personal data by default.
- Advertising identifiers may be handled only when explicitly configured and permitted by platform rules and required consent.
- Store and display deterministic, platform-assigned, aggregate privacy-preserving, estimated, and unknown attribution as distinct categories.
- Use primary Apple, Google, and media-platform sources for behavior that depends on external specifications.
- Keep received evidence append-only where lawful, but redact personal data when a valid deletion request requires it. Append-only is not a reason to retain identifiable deleted data.
- Keep the measurement core open while separating deployment secrets and live fraud-defense policy.
