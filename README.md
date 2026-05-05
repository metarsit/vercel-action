# vercel-action

GitHub Actions for the [Vercel CLI](https://vercel.com/docs/cli). Install once, then build and deploy with a few lines of YAML.

This repo ships **two actions**:

| Action | Path | What it does |
| --- | --- | --- |
| Setup | `metarsit/vercel-action@v1` | Installs the Vercel CLI on the runner and adds it to `PATH`. |
| Deploy | `metarsit/vercel-action/deploy@v1` | Runs `vercel pull` → `vercel build` → `vercel deploy --prebuilt` and exposes the deployment URL as an output. |

You can use them together or use just the setup action and call the CLI directly.

---

## Quick start

### 1. Add secrets

Create a [Vercel access token](https://vercel.com/account/tokens) and add the following repository secrets:

| Secret | Where to find it |
| --- | --- |
| `VERCEL_TOKEN` | https://vercel.com/account/tokens |
| `VERCEL_ORG_ID` | `.vercel/project.json` after running `vercel link` locally |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` after running `vercel link` locally |

### 2. Add a workflow

```yaml
# .github/workflows/deploy.yml
name: Deploy to Vercel

on:
  push:
    branches: [main]
  pull_request:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Vercel CLI
        uses: metarsit/vercel-action@v1

      - name: Deploy
        id: deploy
        uses: metarsit/vercel-action/deploy@v1
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          prod: ${{ github.ref == 'refs/heads/main' }}

      - name: Comment preview URL on PR
        if: github.event_name == 'pull_request'
        uses: thollander/actions-comment-pull-request@v3
        with:
          message: |
            Preview: ${{ steps.deploy.outputs.preview-url }}
```

That is the whole setup. PRs get preview deployments, pushes to `main` go to production.

---

## Setup action

Installs the Vercel CLI globally on the runner.

### Inputs

| Name | Default | Description |
| --- | --- | --- |
| `vercel-version` | `latest` | CLI version to install. Accepts `latest`, an exact version (`53.1.1`), or any [npm semver range](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#dependencies) (`^53`). |
| `working-directory` | `.` | Directory used when running `vercel --version` to verify the install. |
| `cache` | `true` | Reserved for future caching support. Currently a no-op. |

### Outputs

| Name | Description |
| --- | --- |
| `vercel-version` | The version reported by `vercel --version`. |
| `vercel-path` | Absolute path to the installed `vercel` binary. |

### Example: pin a version

```yaml
- uses: metarsit/vercel-action@v1
  with:
    vercel-version: '53.1.1'

- run: vercel --version
```

### Example: setup-only, then run your own commands

If you do not want the deploy wrapper, the setup action plus a few `run:` steps mirrors the official [Vercel + GitHub Actions guide](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel):

```yaml
- uses: metarsit/vercel-action@v1

- name: Pull Vercel environment
  run: vercel pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }}
  env:
    VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
    VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}

- name: Build
  run: vercel build --prod --token=${{ secrets.VERCEL_TOKEN }}

- name: Deploy
  run: vercel deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}
```

### Example: PR build check (no deploy)

Catch broken builds in PRs without burning a deployment. Useful for monorepos where the actual deploy is handled by Vercel's Git integration.

```yaml
name: Vercel Build Check

on:
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    env:
      VERCEL_ORG_ID: ${{ vars.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID }}
    steps:
      - uses: actions/checkout@v4

      - uses: metarsit/vercel-action@v1
        with:
          vercel-version: '53.1.1'

      - name: Pull Vercel env
        run: vercel pull --yes --environment=preview --token=${{ secrets.VERCEL_TOKEN }}

      - name: Build
        run: vercel build --token=${{ secrets.VERCEL_TOKEN }}
```

### Example: matrix build check across multiple Vercel projects

Monorepo with several Vercel-linked apps. One job per app, each pointing at a different `VERCEL_PROJECT_ID`:

```yaml
jobs:
  build:
    name: Build ${{ matrix.app }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - app: frontend
            project_id: VERCEL_PROJECT_ID_FRONTEND
          - app: admin
            project_id: VERCEL_PROJECT_ID_ADMIN
          - app: docs
            project_id: VERCEL_PROJECT_ID_DOCS
    env:
      VERCEL_ORG_ID: ${{ vars.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ vars[matrix.project_id] }}
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - uses: metarsit/vercel-action@v1
        with:
          vercel-version: '53.1.1'

      - run: vercel pull --yes --environment=preview --token=${{ secrets.VERCEL_TOKEN }}
      - run: vercel build --token=${{ secrets.VERCEL_TOKEN }}
```

> Store `VERCEL_ORG_ID` and per-app `VERCEL_PROJECT_ID_*` as repo **variables** (not secrets) — they are not sensitive and `vars.*` keeps secrets scoped to the token only.

---

## Deploy action

Runs the full pull → build → deploy sequence and parses the resulting URL.

### Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `vercel-token` | yes | — | Access token. Pass via `${{ secrets.VERCEL_TOKEN }}`. |
| `vercel-org-id` | no | — | Org/team ID. Set as `VERCEL_ORG_ID` for the CLI. |
| `vercel-project-id` | no | — | Project ID. Set as `VERCEL_PROJECT_ID` for the CLI. |
| `prod` | no | `false` | Deploy to production when `true`. Otherwise creates a preview. |
| `prebuilt` | no | `true` | Run `vercel build` first and deploy with `--prebuilt`. Set to `false` to let Vercel build on the platform. |
| `environment` | no | inferred | `production`, `preview`, or `development`. Inferred from `prod` if empty. |
| `working-directory` | no | `.` | Project directory. |
| `scope` | no | — | Vercel team slug or ID for `--scope`. |
| `build-args` | no | — | Extra args appended to `vercel build`. |
| `deploy-args` | no | — | Extra args appended to `vercel deploy`. |

### Outputs

| Name | Description |
| --- | --- |
| `preview-url` | Final deployment URL (preview or production). |
| `inspect-url` | The Vercel inspect URL emitted by the CLI. |
| `deployment-id` | Deployment ID parsed from the inspect URL. |

### Example: preview on PRs, production on `main`

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: metarsit/vercel-action@v1

      - id: deploy
        uses: metarsit/vercel-action/deploy@v1
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          prod: ${{ github.ref == 'refs/heads/main' }}

      - run: echo "Deployed to ${{ steps.deploy.outputs.preview-url }}"
```

### Example: monorepo subdirectory

```yaml
- uses: metarsit/vercel-action@v1

- uses: metarsit/vercel-action/deploy@v1
  with:
    vercel-token: ${{ secrets.VERCEL_TOKEN }}
    vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
    vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
    working-directory: apps/web
    prod: true
```

### Example: skip prebuild and let Vercel build remotely

```yaml
- uses: metarsit/vercel-action/deploy@v1
  with:
    vercel-token: ${{ secrets.VERCEL_TOKEN }}
    vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
    vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
    prebuilt: false
```

---

## Comparison to the official KB guide

Vercel's [official KB article](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel) shows a manual three-step workflow (`npm i -g vercel`, `vercel pull`, `vercel build`, `vercel deploy --prebuilt`). That works, but every project re-implements it.

This action wraps that flow:

- The setup action takes care of installing the CLI (with version pinning and PATH wiring).
- The deploy action takes care of `pull` → `build` → `deploy`, environment inference from `prod`, monorepo `working-directory`, and parsing the URL into outputs your next steps can read.

If you only want the install step, use the setup action and write the rest yourself.

---

## Versioning

This repo follows the GitHub Action convention used by `actions/setup-go`:

- `@v1` — moving tag, follows the latest `v1.x.y` release.
- `@v1.2.3` — exact version pin.
- `@main` — bleeding edge, not recommended for production workflows.

Major versions are only bumped for breaking changes to inputs or outputs.

---

## Permissions and security

- `vercel-token` is the only required secret. It is registered with `core.setSecret` so it is masked in logs.
- The token is passed via `--token` and `VERCEL_TOKEN`. It is never written to disk.
- Use a [scoped Vercel token](https://vercel.com/account/tokens) when possible.

---

## Local development

This repo uses [pnpm](https://pnpm.io/). Install it once with `corepack enable` (Node 18+) or `npm i -g pnpm`.

```bash
pnpm install
pnpm run build      # bundles src/setup.ts and src/deploy.ts into dist/ via @vercel/ncc
pnpm run lint       # tsc --noEmit
```

Built artifacts in `dist/` are checked in so that `runs.using: node20` can execute them without a build step on the runner. CI verifies that `dist/` is up to date.

> The setup action installs the Vercel CLI on the runner via `npm install -g vercel@<version>`. `npm` ships with the runner's Node.js install, so no extra setup is needed regardless of which package manager your own project uses.

---

## Roadmap

- Tool cache support so the CLI is reused across runs without re-downloading.
- Composite `setup-and-deploy` action for one-step usage.
- Optional Slack / GitHub Deployment integration on success.

---

## License

MIT — see [LICENSE](./LICENSE).
