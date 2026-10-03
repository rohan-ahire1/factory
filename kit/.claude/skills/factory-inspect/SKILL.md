---
name: factory-inspect
description: Independently check a factory PR before the human merges it. Reruns the gates in a clean worktree, checks for regressions against the protected branch, gets a Codex review (a different model family), and posts one verdict comment. Use when asked to "inspect", "check" or "review" a PR, or "what's ready to merge".
---

# Inspect a PR

You did not write this PR. Assume nothing it claims is true until you've reproduced it. You never merge, approve or push to the PR branch.

## 1. Pick the PR

- Given a number, use it. Otherwise list candidates with `gh pr list --search "head:factory/" --state open`, and inspect each.

## 2. Clean checkout

```bash
repo="$(basename "$(git rev-parse --show-toplevel)")"
git fetch origin
git worktree add "../$repo-pr-<n>" "origin/<branch from factory.json>"
cd "../$repo-pr-<n>" && gh pr checkout <n>
node .factory/gates.mjs --setup --shots <routes from the PR's "Verify routes">
```

## 3. Check the result

- Open the screenshots (apps) or the test output. Compare them against the issue's "Done when" list, item by item.
- Regression check: run the same gates on the protected branch (a second worktree) for the same routes. Anything that passes there but fails on the PR is a regression.

## 4. Second opinion from Codex

```bash
codex review --base origin/<branch> "Review this PR for bugs, regressions, security and accessibility problems, and violations of AGENTS.md. Real problems only, no style nitpicks."
```

If `codex` isn't installed, say so in the verdict and skip this step. Check each Codex finding yourself and keep only the ones that hold up.

## 5. Verdict

Post exactly one comment with `gh pr comment <n> --body-file -`:

```
## Inspection: READY | NEEDS WORK | BLOCKED
Head: <sha>

**Done when**
- [x] <item>: <what the screenshot, test or command showed>
- [ ] <item>: <why not>

**Gates:** <each gate ✓/✗> · regression vs <branch> ✓
**Codex:** <confirmed findings, or "no confirmed issues">
**Look at:** <the one or two things the human should eyeball before merging>
```

- READY = every "Done when" item is proven, all gates pass, no confirmed findings.
- NEEDS WORK = fixable problems. To send it back to the cloud worker, end the comment with `@claude` and the list of fixes.
- BLOCKED = the request itself is wrong, unclear or breaks a rule in AGENTS.md.

## 6. Clean up

Remove the worktrees with `git worktree remove`. Report the verdicts to the user in one line per PR.
