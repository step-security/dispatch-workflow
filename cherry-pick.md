# Cherry-Pick Workflow

## Context

PR: https://github.com/step-security/dispatch-workflow/pull/58

This repository is a secure drop-in replacement for an upstream action. We
cherry-pick selected changes from upstream while maintaining our own identity
and release process.

## Steps

### 1. Read the Cherry-Pick Verification Report

- Open the PR above and find the comment posted by the GitHub Actions bot titled
  **"Cherry-Pick Verification Report"**.
- This report lists the two upstream versions being compared and indicates which
  commits have already been cherry-picked.
- Pay particular attention to these sections, which drive the manual passes:
  - **Completely Skipped Commits** — commits that only touched paths the script
    ignores (`package.json`, `package-lock.json`, `yarn.lock`, `node_modules/`,
    `dist/`, `.gitignore`). Many of these still carry version bumps you must
    apply manually.
  - **Conflicting Files** — files the script tried to apply but couldn't merge
    (commonly `README.md`, `package.json`, sometimes `.github/dependabot.yml`).
  - **Missing Files** and **Workflow Files** — usually skipped per the rules
    below; verify before acting. c

### 2. Identify the upstream repository

- Go to the homepage of this repo.
- In the **About** section, you will see a description like _"Secure drop-in
  replacement for ..."_ — the upstream repo name is in that description.
- Open the upstream repo and navigate to the comparison view between the two
  versions referenced in the report (e.g.
  `https://github.com/<upstream>/compare/v4.0.0...v4.1.0`). Reading the diff
  directly is the fastest way to design the manual edits.

### 3. Cherry-pick the missing commits

Cherry-pick only the commits listed as **not yet done** in the verification
report, applying the rules below.

## Rules

### Always cherry-pick

- **`README.md` and `package.json`** — these almost always show up under the
  report's _Conflicting Files_ or _Completely Skipped Commits_ sections. Apply
  the upstream delta manually, but **preserve our branding and identity**: the
  StepSecurity banner/badges in `README.md`, and `repository.url` + `author` +
  any step-security-specific deps (e.g. `@actions/github`, `axios` for the
  subscription/banner code) in `package.json`.
- **Version upgrades** of dependencies in `package.json` (even though
  `package.json`/`package-lock.json` aren't cherry-picked via script, version
  bumps from upstream should be brought over manually).
- **Build-toolchain migrations** — e.g. ncc → esbuild. Apply the new `build`
  script, add/remove the corresponding dev-deps (`@vercel/ncc` → `esbuild`,
  `generate-license-file`), and **delete the stale build artifacts from
  `dist/`** so the layout matches upstream (the bot's auto-update of `dist/`
  only adds the new file, it doesn't prune the old one).
- **ESM / module-system conversion changes** in `package.json` and related
  config files — e.g., adding `"type": "module"`, updating `test` scripts to
  point at the new `jest.config.cjs`, etc. When upstream converts the action to
  an ES module, bring those structural changes too, not just version bumps.
- **Renames driven by ESM conversion** — e.g., `jest.config.js` →
  `jest.config.cjs`. These show up in the bot's "Missing Files" list and must be
  applied to keep tests/build working.
- **Workflow file changes** — workflow files are never applied by the script,
  but they **are** listed in the report under _"Workflow Files (Cannot be
  auto-applied by GitHub Actions)"_. Walk through that list and, for each file
  that still exists in our repo, apply the upstream v(prev)…v(target) delta
  manually. The categories of change to bring over:
  - **Plain version bumps** of `uses:` references (action major/minor/patch
    upgrades, including the pinned SHA + trailing `# v<version>` comment).
  - **`permissions:` blocks — do NOT pick blindly.** A bare
    `permissions: contents: read` is the default-ish read posture, and the
    workflow almost always runs fine without it being declared at all. Apply
    this rule:
    - **Workflow change is only a new `permissions:` block, nothing else** →
      **skip**. No new step is asking for a token scope, so there's nothing to
      harden. Adding it is churn.
    - **Workflow adds new steps that actually need a token scope** (e.g. a step
      that pushes commits, comments on PRs, uploads SARIF, writes packages,
      etc.) → bring the `permissions:` block over, but **only the scopes the new
      steps actually need**. Don't widen beyond that.
    - **Upstream introduces any `write` scope** (`contents: write`,
      `pull-requests: write`, `id-token: write`, `security-events: write`,
      `packages: write`, etc.) → **double-check before applying**: which step
      needs it, is that step actually being adopted, and is there a
      less-privileged alternative? Default is to skip unless the corresponding
      step is also being cherry-picked.
    - If our workflow already has a more restrictive `permissions:` block than
      upstream, keep ours.
  - **Coordinated refactors that must be applied together** — whenever upstream
    bumps an action's major version alongside changes to the surrounding
    workflow (renamed step IDs, renamed job outputs, changed `with:` keys,
    changed matrix strategy, swapped subaction paths, etc.), treat the bump and
    the surrounding edits as one atomic change. Applying only the version bump
    without the surrounding edits — or vice versa — typically leaves the
    workflow broken. The way to spot these: read the upstream
    `compare/v(prev)...v(target)` diff for that workflow file and apply every
    hunk that touches it, not just the `uses:` line.

  When applying, **preserve our customizations**: the
  `step-security/harden-runner` pre-steps in every job, SHA-pinned action
  references with the `# v<version>` trailing comment, our own
  concurrency/permissions settings if more restrictive than upstream, and any
  other step-security-specific wiring. Files that exist only in our repo (e.g.
  `actions_release.yml`) are still off-limits regardless of upstream changes.

### Never cherry-pick

- **Author/maintainer name changes** — this project is maintained under our own
  name; do not import upstream branding or author references. In `package.json`,
  keep our `repository` field (`step-security/...`) and never overwrite it with
  upstream's value.
- **Markdown docs** like `CONTRIBUTING.md`, `CLAUDE.md`, `CHANGELOG.md`, and
  similar meta-docs.
- **Our own release process files** — e.g., `actions_release.yml` is ours; never
  overwrite it with upstream changes. The same applies to any other file that
  exists only in our repo.
- **Workflow files via script** — the automated script never touches workflow
  files; the report lists them under _"Workflow Files (Cannot be auto-applied by
  GitHub Actions)"_ precisely so you handle them manually (see _Always
  cherry-pick → Workflow file changes_ for what to apply).
- **Protected files — never update regardless of upstream changes.** These files
  are owned by step-security and must never be modified during cherry-pick, no
  matter what the upstream delta is:
  - `.github/dependabot.yml`
  - `.github/workflows/scorecards.yml`
  - `.github/workflows/dependency-review.yml`
  - `.github/workflows/claude_review.yml`
  - `.github/workflows/codeql.yml`
  - `.github/workflows/auto_cherry_pick.yml`
  - `.github/workflows/audit_package.yml`
  - `.github/workflows/actions_release.yml`

### Use judgment

For files that exist in upstream but **not in our repo**, separate two cases —
the right call is different in each:

- **Pre-existing upstream file, never adopted in our repo** — e.g. a file that's
  existed upstream for many releases but isn't in our fork. This is almost
  always a deliberate past decision (skipped or deleted as unnecessary).
  Default: leave it out; don't reintroduce just because upstream changed it.
- **Newly introduced upstream file in this version range** — e.g. a workflow or
  config that upstream added between the previous and target versions. We've
  never had a chance to evaluate it. Default: assess on its own merits — does it
  duplicate something we already do (e.g. zizmor vs our existing
  CodeQL/Scorecards/audit workflows)? Is it consistent with how we maintain the
  other ~500 actions in the fleet? Only adopt it if the answer to both is "yes,
  and we'd want it fleet-wide" — otherwise skip, but flag it so the call is
  intentional rather than accidental.

To tell which case you're in: check whether the path appears in the upstream
tree at the **previous** version. If yes → pre-existing. If no → new in this
range.

## After cherry-picking

Verify locally.

**First, detect the package manager and the actual script names** — don't assume
`yarn build`/`yarn test`. The repo could use yarn, npm, or pnpm, and the scripts
in `package.json` may not be named `build`/`test` (e.g. some repos use `bundle`,
`compile`, `dist`, `vitest`, `jest`, etc.):

- **Package manager** — check in this order:
  - `yarn.lock` and/or `.yarnrc.yml` / `.yarn/` → use `yarn`
  - `pnpm-lock.yaml` → use `pnpm`
  - `package-lock.json` → use `npm`
  - Fall back to `package.json`'s `packageManager` field if no lockfile is
    obvious.
- **Script names** — read `package.json`'s `scripts` block. Pick the script that
  actually produces `dist/` for "build" (look for `ncc`, `esbuild`, `tsc`,
  `rollup`, etc.) and the script that runs the test suite for "test" (look for
  `vitest`, `jest`, `mocha`, etc.). If the script is named differently from
  `build`/`test`, use the real name.

Then run, using the detected tool and scripts:

1. `<pm> install` — regenerates the lockfile to match any `package.json`
   changes.
2. `<pm> run <build-script>` — regenerates `dist/` with the new toolchain.
   Confirm `dist/` ends up with the same file set as upstream (extra build
   artifacts from the old toolchain must be removed by hand).
3. `<pm> run <test-script>` — runs the test suite to confirm the new bundle and
   dep bumps work.
4. `git status` — confirm only the intended files changed.

**Do NOT commit.** Stop after verification and hand off to the user — they will
review the diff and commit themselves. Also do not stage `cherry-pick.md`; it's
a working note, not part of the action.
