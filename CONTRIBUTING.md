# Contributing to Open MMP

Open MMP is currently a contract and reference-evaluator project. Read [AGENTS.md](AGENTS.md) before changing the repository, and use the setup and validation commands in the [README](README.md#contract-validation) rather than duplicating environment instructions here.

## Local workflow

- Create a working branch from `main`; never edit `main` directly.
- Keep each commit focused and write commit messages in English.
- Run `npm run validate` before reporting a completed change.
- GitHub authentication, pushes, issues, pull requests, releases, and other remote writes require explicit authorization for the exact operation.

## Contract artifacts

- Follow the reviewed workflow in [fixtures/v0.2/README.md](fixtures/v0.2/README.md) when proposing a fixture. Golden outputs require human review and a written derivation; validation must not regenerate them.
- Treat existing v0.1 schema identifiers as frozen. Breaking and non-breaking schema changes, version resolution, and the v0.2 layout are to be defined in the v0.2 contract work before a versioned schema change is accepted.
- Do not include real user, campaign, credential, provider-export, or live fraud-defense data in public fixtures or documentation.

## Real data never enters this repository

This repository is public. Real or production data — MMP exports, ad revenue, media cost, identifiers, campaign, ad-set, creative, or app names, and any value derived from them — must never enter the repository in any form: files, fixtures, tests, documentation, commit messages, or examples. Fixtures are synthetic only. Guardrails enforce part of this: `.gitignore` excludes tabular exports and lab/input directories, and both CI and `npm run validate` fail if a tracked or addable file has a `.csv`, `.tsv`, `.xlsx`, `.xls`, or `.parquet` extension, sits under an `open-mmp-lab/`, `real-data/`, or `input/` directory, or is a non-JSON file under `fixtures/`. If a future importer needs a synthetic CSV fixture, allow-list that exact path in `.gitignore`, `tools/validate.ts`, and the CI step in the same change and explain in the pull request why the file is synthetic.
