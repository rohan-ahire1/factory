---
name: factory-worker
description: Take one factory issue from request to a verified pull request. Use when working a GitHub issue labelled `factory`, or when asked to build, fix or change something in this repo end to end.
---

# Factory worker

You own one issue, start to finish, and stop at an open PR. You never merge. If auto-merge is on, the PR merges itself once CI's gates pass.

## Job size

The prompt names the job size (from the issue label). It sets how much you explore, not the quality bar: every size still has to pass the gates and show proof.

- **cheap** (`factory:cheap`, Sonnet): a small, clear change. Go straight to the files the issue or the feature map names; don't explore beyond them. Skip the "before" screenshot unless it's a bug. If it turns out to need a design decision or more than a few files, stop and comment on the issue suggesting `factory` or `factory:deep`, instead of pushing on.
- **standard** (`factory`, Opus medium): follow the steps below as written.
- **deep** (`factory:deep`, Opus high): before editing, comment a short plan on the issue (files, approach, how you'll prove it). Look for the root cause, cover edge cases with tests, and check routes next to the ones you touched.

Spend tokens where they change the result: use the feature map and `Grep` to find code before reading it, read only the parts you need, don't re-read files you already have, and open only the screenshots for routes you changed.

Work through these steps in order. If a step doesn't apply, write `skip: <reason>` in the PR. If any step fails the bar, **stop the line**: comment on the issue with what you found and what's blocking, and don't open a half-done PR.

## 1. Understand

- Read the issue and its comments. Read `AGENTS.md`, `factory.json` and `docs/factory/feature-map.md`.
- Restate the problem in plain English in one or two sentences. If the request is ambiguous in a way that changes the result (which page? which wording? which behaviour?), stop and ask on the issue. Don't guess at copy, claims or product decisions.
- If the request would break a rule in `AGENTS.md`, stop and say so on the issue.

## 2. Branch

- `git switch -c factory/issue-<number>-<short-slug>` from the up-to-date protected branch (`branch` in `factory.json`). Never commit to it.

## 3. Reproduce (bugs) or baseline (changes)

- Bugs: reproduce on the protected branch **twice** (a failing test, a command, or the `factory-verify` skill for UI), and save the evidence. If it doesn't reproduce, stop and report what you tried.
- UI changes: screenshot the affected routes before you edit, so there's a "before".

## 4. Change

- Smallest change that solves it. Match the surrounding code.
- One concern. If you find other problems, list them as follow-ups. Don't fix them here.
- If the same mistake could happen again, prefer a structural guard (a test, a type, a check) over a note.
- For bugs, add a test that fails before the fix and passes after, when the repo has tests.

## 5. Prove it

```bash
node .factory/gates.mjs --shots <every route you touched>
```

This runs every gate in `factory.json` and, for apps, the browser check. Fix until it passes. Run one gate with `--only <name>` while iterating.

For UI changes, open the screenshots for the touched routes (mobile and desktop) and check them against the request. Describe what you see. If it looks wrong, it is wrong, even if the report passes.

## 6. Self-review

- Read your own diff top to bottom: no debug code, no unrelated edits, no secrets.
- Update `docs/factory/feature-map.md` if you added, moved or removed a feature.

## 7. Open the PR

- Commit with a plain, imperative message. No AI attribution in commits or the PR body: no `Co-Authored-By` lines, no "Generated with" notes.
- Push the branch and open a PR with `gh pr create`, using `.github/pull_request_template.md`. Fill in:
  - `Closes #<issue>`
  - **Verify routes:** the routes you touched, so CI screenshots them (apps only)
  - **Evidence:** what you ran, what passed, what the screenshots or tests show, before and after
  - **Risk and follow-ups**
- Comment on the issue with the PR link. Then stop.

## Limits

- Don't touch the paths under `protect` in `factory.json` unless the issue asks for it explicitly.
- Don't add dependencies without saying why in the PR.
- If you've tried three different approaches and the gates still fail, stop and write up what you learned on the issue.
