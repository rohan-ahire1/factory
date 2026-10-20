# factory

**A drop-in agent factory for any GitHub repo: issues in, verified PRs out, a human merges.**

You file a GitHub issue (from your phone or from chat). A Claude Code agent picks it up in GitHub Actions, builds the change on a branch, runs every check the repo defines, drives the app in a real browser, and opens a pull request with the proof attached. CI then reruns everything on its own and posts the results on the PR. You read the proof and merge, or let PRs that pass merge themselves if you turn on auto-merge.

One command (`factory init`) adds the whole setup to a repo. Every repo gets the same workflows, skills and safety guard; the only per-repo file is `factory.json`.

## What it does

- **Turns issues into pull requests.** Label an issue `factory` (or use the issue form) and a cloud worker takes it from request to an open PR.
- **Makes agents prove their work.** Each PR has to pass the repo's gates (tests, build, lint, whatever `factory.json` lists) and, for apps, a browser check with screenshots.
- **Rechecks everything independently.** CI reruns the gates on every PR and posts one results comment. Agents never approve their own work.
- **Keeps the human in charge of `main`.** A guard hook blocks agents from pushing the protected branch or merging, both locally and in the cloud.
- **Sizes jobs to save cost.** The issue label picks the model, reasoning effort and turn limit.
- **Reports failures.** If a run fails, the issue gets a `factory:failed` label and a comment with the reason and a link to the log. Temporary errors retry once.
- **Works across stacks.** `factory init` detects the stack and writes a starting `factory.json`.

## How it works

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

1. **Intake.** An issue form (small, standard or big) or the `factory-file` skill ("file this: …") creates a well-formed issue with a "done when" that a screenshot, test or command can prove.
2. **Worker.** `factory-worker.yml` runs Claude Code (`anthropics/claude-code-action`) with the `factory-worker` skill. It reads `AGENTS.md` and the feature map, restates the problem, branches, makes the change, and runs `.factory/gates.mjs`.
3. **Browser proof.** For repos with a UI, `.factory/verify.mjs` serves the built app and drives it in Chromium (Playwright) at mobile and desktop sizes. It checks status codes, console errors, failed requests, sideways scroll, headings, alt text and internal links, and saves screenshots and a report.
4. **Independent gates.** `factory-gates.yml` reruns every gate on the PR in a clean CI run and posts the results and screenshots as a comment.
5. **Optional second opinion.** The `factory-inspect` skill rechecks a PR on your machine: clean worktree, gates, a regression check against the protected branch, and a review from a different model family (Codex).
6. **Merge.** You merge. Or set `"automerge": true` and `factory-automerge.yml` squash-merges PRs once the gates pass, skipping drafts, forks, PRs that changed after the gates ran, and anything labelled `factory:hold`.

### Job sizes

| Label | Model | Effort | Max turns | For |
|---|---|---|---|---|
| `factory:cheap` | Sonnet | high | 60 | Copy, a style tweak, a one-file fix |
| `factory` | Opus | medium | 150 | Most features and bugs |
| `factory:deep` | Opus | high | 250 | Big features, hard bugs |

If a job turns out bigger than its label, the worker stops and says so on the issue instead of pushing on.

### Safety

1. **Guard hook** (`.factory/guard.mjs`, a Claude Code `PreToolUse` hook): blocks `gh pr merge` and any `git push` that would reach the protected branch, including `--all`, `--mirror` and `HEAD` pushes while on it.
2. **Cloud permissions:** the worker can't merge, force-push or call the raw GitHub API, and only the repo owner's label or `@claude` comment starts it.
3. **Deploy guard:** for repos that deploy on push, `factory doctor` warns if the deploy job doesn't check that the push came from the owner.
4. **Kill switch:** set the repo variable `FACTORY_PAUSED=true` to stop the worker and auto-merge.

## Tech stack

- Node.js 20+ (plain ES modules, no runtime dependencies)
- GitHub Actions, GitHub CLI, issue forms
- Claude Code: `claude-code-action`, skills, and hooks
- Playwright + Chromium for browser checks
- macOS Keychain for storing the Claude token locally

## Install the kit (once per machine)

```bash
git clone https://github.com/rohan-ahire1/factory ~/factory
cd ~/factory && npm link            # puts `factory` on your PATH
mkdir -p ~/.claude/skills && ln -s ~/factory/skills/factory-setup ~/.claude/skills/factory-setup
```

Then, once per GitHub account:

1. Install the Claude GitHub app and choose **All repositories**: https://github.com/apps/claude
2. Make a Claude token and save it. `--save` reads the token from your clipboard, tests it, and keeps it in the macOS Keychain:
   ```bash
   claude setup-token        # copy the whole token it prints
   factory secret --save --all
   ```
3. Optional: to have worker PRs show under your own name, and to use auto-merge, add a GitHub token as the `FACTORY_GH_TOKEN` secret. Steps in [`kit/docs/factory/README.md`](kit/docs/factory/README.md#your-name-on-prs).

## Add the factory to a repo

Ask Claude in that repo: **"set up the factory here"**. The `factory-setup` skill runs `factory init`, tunes `factory.json` to the repo, fills in `AGENTS.md` and the feature map, runs the gates and opens a PR. Then run `factory secret` and merge the PR.

By hand: `factory init`, edit `factory.json`, `node .factory/gates.mjs`, `factory doctor`, open a PR.

### factory.json

```jsonc
{
  "branch": "main",                    // protected branch: agents never push or merge here
  "node": "22",                        // Node version for CI
  "setup": ["npm ci"],                 // install commands, run before the gates
  "gates": [                           // every check a change must pass, in order
    { "name": "Tests", "run": "npm test" },
    { "name": "Build", "run": "npm run build" }
  ],
  "app": {                             // omit for repos without a UI
    "start": "npx next start -p $PORT",
    "routes": "sitemap"                // "sitemap" or a list like ["/", "/pricing"]
  },
  "protect": ["ops/", ".github/workflows/"],
  "automerge": false
}
```

## Commands

| Command | What it does |
|---|---|
| `factory init` | Detects the stack, writes `factory.json`, copies the kit into the repo |
| `factory update` | Refreshes the kit files to this version; keeps `factory.json` and your docs |
| `factory doctor` | Checks the setup: config, kit files, guard, labels, secrets, deploy workflows |
| `factory secret` | Tests your token and copies it from the Keychain into the repo's Actions secret (`--save` stores it first, `--all` does every factory repo) |

## Stack detection

Node (npm, pnpm, yarn, bun; Next.js, Vite, Astro, Nuxt, SvelteKit, Remix, CRA), Python (pip, uv, poetry; pytest, ruff), Go, Rust, Makefiles, and static HTML sites. Anything else: write `factory.json` by hand.

## Repo layout

| Folder | What |
|---|---|
| `bin/factory.mjs` | The `factory` CLI |
| `lib/detect.mjs` | Stack detection for `factory init` |
| `kit/` | Files copied into every repo and kept in sync by `factory update`: workflows, gate and browser-check scripts, guard hook, skills, issue forms, docs |
| `scaffold/` | Files created once if missing (PR template, feature map), then owned by the repo |
| `skills/factory-setup/` | User-level Claude skill: "set up the factory here" |

Full operating guide (daily use, failure handling, auto-merge, what to measure): [`kit/docs/factory/README.md`](kit/docs/factory/README.md).

To change the kit: edit it here, bump `version` in `package.json`, then run `factory update` in each repo.
