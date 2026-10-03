---
name: factory-verify
description: Launch this repo's app, drive it in a real browser and collect proof (screenshots, video, report) that a change works. Use before calling a UI change done, to reproduce a reported UI bug, or when asked to "show me" something in the app.
---

# Verify in a real browser

Proof beats claims. A UI change is not done until you have run this and looked at the output. Settings live under `app` in `factory.json`. If there is no `app`, this repo has no UI: prove changes with tests and command output instead.

## Doctor (when something seems off)

```bash
node .factory/verify.mjs --install           # installs Playwright and Chromium if missing
node .factory/verify.mjs --doctor --start    # needs a build; checks Chromium and the server
```

## Launch

- Production-like (preferred for proof): build first (the build gate), then `node .factory/verify.mjs --start ...`. It runs `app.start` on a free port and stops it after.
- Against a dev server you started: `node .factory/verify.mjs --base-url http://localhost:<port> ...`.
- In a worktree, ports never clash: `--start` always picks a free port.

## Drive

| Goal | Command |
|---|---|
| Every page, quick check | `node .factory/verify.mjs --start` |
| Screenshot the routes you changed | `node .factory/verify.mjs --start --shots /,/pricing` |
| Only some routes | `node .factory/verify.mjs --start --routes /a,/b --shots all` |
| Record video | add `--video` |
| Machine-readable | add `--json` |

Every route is checked at mobile (390×844) and desktop (1440×900) with reduced motion. It fails on HTTP errors, console errors, failed requests, sideways scroll, no `<h1>`, images without alt, an empty title and broken internal links. Known, accepted problems can be silenced with regexes in `app.ignore`; say why in the PR.

For interactions the tool doesn't cover (menus, forms, keyboard focus, logged-in flows), write a short throwaway Playwright script in `.factory/evidence/` (ignored by git), and save its screenshots next to the report.

## Evidence

- Output goes to `.factory/evidence/<timestamp>/`: `report.md`, `report.json`, `<route>--<viewport>.png`, `video/`.
- **Open the screenshots for the routes you changed and describe what you see** in the PR. A passing report with a visibly broken layout is still a failure.
- For bugs: capture the broken state first (reproduce it twice), then the fixed state. Before and after is the proof.

## When the tool itself is wrong

If verify misses a real problem or flags a false one, say so in the PR and tell the human. The tool is shared by every repo through the factory kit, so it is fixed there, not here.
