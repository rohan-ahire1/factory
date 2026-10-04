# The factory

<!-- Managed by the factory kit: `factory update` overwrites this file. -->

Work goes in as GitHub issues. Verified PRs come out. You choose what goes in and you merge what comes out, or turn on auto-merge and let PRs that pass the gates merge themselves. Agents do everything in between, and every step has to show proof.

```
 you (phone or chat)          cloud (GitHub Actions)                         you
 ───────────────────          ───────────────────────────────────────        ──────────────
 issue + size label    ──▶  worker: Claude Code + factory-worker skill
                              branch → change → gates from factory.json
                              → browser check (apps) → opens PR        ──▶  CI reruns every gate,
                                                                            posts results + screenshots
                              local inspector (optional, your Mac):
                              factory-inspect skill = clean checkout,
                              gates, regression check, Codex review    ──▶  you read the proof, tap merge
```

## Pieces

| Piece | File |
|---|---|
| This repo's settings: install, gates, app, protected paths, worker model | `factory.json` (yours to edit) |
| Rules every agent follows | `AGENTS.md` (Claude reads it through `CLAUDE.md`) |
| What exists and what proves it works | `docs/factory/feature-map.md` |
| Runs every gate, same locally and in CI | `.factory/gates.mjs` (`node .factory/gates.mjs --help`) |
| Browser proof: drives the app in Chromium | `.factory/verify.mjs` (`node .factory/verify.mjs --help`) |
| Blocks agents from pushing the protected branch or merging | `.factory/guard.mjs`, wired in `.claude/settings.json` |
| Skills: worker, verify, file work from chat, inspect a PR | `.claude/skills/factory-*` |
| Cloud worker | `.github/workflows/factory-worker.yml` |
| Gates + results comment on every PR | `.github/workflows/factory-gates.yml` |
| Merges a PR once its gates pass (off unless `"automerge": true`) | `.github/workflows/factory-automerge.yml` |
| Phone intake forms, one per job size | `.github/ISSUE_TEMPLATE/factory*.yml` |

Files marked "Managed by the factory kit" are replaced by `factory update`. Change behaviour through `factory.json` instead.

## factory.json

```jsonc
{
  "branch": "main",                    // protected branch: agents never push or merge here
  "node": "22",                        // Node version for CI (the factory scripts need Node 20+)
  "setup": ["npm ci"],                 // install commands, run before the gates
  "gates": [                           // every check a change must pass, in order
    { "name": "Tests", "run": "npm test" },
    { "name": "Build", "run": "npm run build" }
  ],
  "app": {                             // omit (null) for repos without a UI
    "start": "npx next start -p $PORT",// serves the built app; $PORT is filled in
    "routes": "sitemap",               // "sitemap" or a list like ["/", "/pricing"]
    "ignore": []                       // regexes for known, accepted browser-check problems
  },
  "protect": ["ops/", ".github/workflows/"],  // agents leave these alone unless asked
  "automerge": false,                  // true: squash-merge PRs once the gates pass (needs FACTORY_GH_TOKEN)
  "worker": {
    "tools": [],                       // extra allowed tools, e.g. "Bash(make:*)"
    "sizes": {                         // optional: override any job size (defaults below)
      "standard": { "maxTurns": 200 }
    }
  }
}
```

## Job sizes

The label picks the model, effort and turn limit. Pick the smallest one that fits: it costs less, and the worker stops and says so if the job is bigger than the label.

| Label | Issue form | Model | Effort | Max turns | For |
|---|---|---|---|---|---|
| `factory:cheap` | Factory job: small | Sonnet 5.5 | high | 60 | Copy, a style tweak, a one-file fix |
| `factory` | Factory job | Opus 5.5 | medium | 150 | Most features and bugs |
| `factory:deep` | Factory job: big | Opus 5.5 | high | 250 | Big features, hard bugs |

Opus jobs fall back to Sonnet when Opus is overloaded. For `@claude` comments, the size comes from the issue's or PR's labels (default `factory`).

## When a run fails

The worker always reports back. While it runs, the issue has a `factory:working` label. If it fails, it adds `factory:failed` and comments the reason with a link to the log: a missing token, the turn limit, an API error. If Claude fails before doing any work with a temporary error (overloaded, a timeout), it waits a minute and retries once by itself. To try again, remove the size label and add it back.

## Your name on PRs

By default the worker's commits, PRs and comments show as Claude. To make them yours, give the factory a token from your own GitHub account:

1. GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.
2. Repository access: only the factory repos. Permissions: Contents, Pull requests and Issues, all read and write. Set an expiry.
3. Save it as a secret in each repo (it asks you to paste the token):
   ```bash
   gh secret set FACTORY_GH_TOKEN --repo <owner>/<repo>
   ```

Worker commits then use your name and no-reply email, and carry no AI attribution lines. When the token expires, the worker falls back to the Claude app and auto-merge stops until you set a new one.

## Auto-merge

Set `"automerge": true` in `factory.json` (needs `FACTORY_GH_TOKEN`). When the gates pass on a PR into the protected branch, it squash-merges and deletes the branch. The merge is made with your token, so a deploy-on-push workflow runs as you and passes the deploy guard. That means a passing PR goes live with no one looking at it first.

It skips drafts, PRs from forks, PRs that changed after the gates ran, and PRs labelled `factory:hold`. Add `factory:hold` to any PR you want to read first.

## Safety

1. **Guard hook**: blocks Claude from pushing to the protected branch and from `gh pr merge`, on your Mac and in the cloud.
2. **Cloud permissions**: the worker itself can't merge, force-push or call the raw GitHub API, and only your own label or `@claude` comment starts it.
3. **Deploy guard** (repos that deploy on push): the deploy job only runs for pushes by the repo owner. `factory doctor` warns when a deploy workflow is missing it.

To stop the worker and auto-merge, set the repo variable `FACTORY_PAUSED` to `true` (Settings → Secrets and variables → Actions → Variables).

## Daily use

- **From your phone:** GitHub app → New issue → "Factory job" (or "small" / "big"). The worker starts right away.
- **From chat:** tell Claude "file this: …" (the `factory-file` skill writes a proper issue).
- **Fix a PR:** comment `@claude <what to change>` on it.
- **Before merging** (or before the gates finish, with auto-merge on): read the results comment on the PR. For anything non-trivial, ask Claude to inspect it (the `factory-inspect` skill).
- **Hands-on work:** run Claude locally in a worktree. The same skills and guard apply.

## Rules that keep quality up

- One concern per issue. "Done when" must be provable by a screenshot, a test or a command.
- Agents never approve their own work: CI and `factory-inspect` re-check everything independently.
- When a PR is wrong in a way that could happen again, add a gate, a test, a rule to `AGENTS.md` or a row to the feature map.
- Grow volume only while reverts stay at zero.

## What to measure (weekly)

Issues filed, PRs merged, PRs still in place 7 days later, reverts, and failed runs with their causes. The aim is changes that survive a week, not raw PR count.
