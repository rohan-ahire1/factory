---
name: factory-setup
description: Set up, update or check the agent factory (issues in, verified PRs out) in any git repo. Use when the user says "set up the factory here", "add the factory to <repo>", "update the factory", or "is the factory working".
---

# Set up the factory in a repo

The kit lives in `~/factory` (`factory` on the PATH, or `node ~/factory/bin/factory.mjs`). It copies the same workflows, skills and guard into every repo; each repo only differs in `factory.json`.

## New repo

1. Work on a branch: `git switch -c factory/setup` from the up-to-date default branch.
2. `factory init`. It detects the stack and writes `factory.json`, then copies the kit.
3. **Make factory.json true for this repo.** Read `package.json` / `pyproject.toml` / `Makefile` / CI files / README:
   - `setup`: the exact install commands CI needs on a clean Ubuntu runner.
   - `gates`: every check that must pass, in order. Prefer the repo's own scripts. Drop any that are broken on the default branch and say so (a gate that always fails is worse than none).
   - `app`: for anything with a UI, a `start` command that serves the **built** app on `$PORT`, and `routes` (`"sitemap"` or a list of the important pages). `null` for libraries, CLIs and APIs.
   - `protect`: infra, deploy and secrets-adjacent paths.
4. Fill in `AGENTS.md` (Map and Rules, above the managed block) and `docs/factory/feature-map.md` from the code. Short and true beats long.
5. `node .factory/gates.mjs` until it passes. For apps, open the screenshots in `.factory/evidence/` and check they show the real app.
6. `factory doctor`. If it flags a deploy-on-push workflow without an owner check, add `if: github.actor == github.repository_owner` to the deploy job, and tell the user in the PR.
7. Commit (plain message, no AI attribution), push, open a PR titled "Add the agent factory". The user merges it.
8. Tell the user what's left that only they can do:
   - If `factory doctor` says the secret is missing: run `factory secret` in the repo (`factory secret --save` once first, after `claude setup-token`). Never handle the token yourself.
   - If the Claude GitHub app isn't installed on this repo: https://github.com/apps/claude.

## Existing factory

- **Update:** `factory update` on a branch, run the gates, open a PR.
- **Check:** `factory doctor` and report the result in plain words.

## Rules

- Never push to the default branch or merge. The user merges.
- Don't change the kit's managed files inside a repo; change `~/factory/kit` and run `factory update` instead, so every repo gets the fix.
