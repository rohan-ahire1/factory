# factory

A drop-in agent factory for any GitHub repo. Work goes in as issues (from your phone or chat), a cloud Claude Code agent builds each one on a branch and proves it, CI rechecks everything and posts the proof on the PR, and you merge (or it merges itself once the checks pass, if you turn on auto-merge).

Every repo gets the same workflows, skills and safety guard. The only per-repo file is `factory.json`, which says how to install, which checks must pass, and how to serve the app.

## Install the kit (once per machine)

```bash
git clone https://github.com/rohan-ahire1/factory ~/factory
cd ~/factory && npm link            # puts `factory` on your PATH
mkdir -p ~/.claude/skills && ln -s ~/factory/skills/factory-setup ~/.claude/skills/factory-setup
```

Then, once per account:

1. Install the Claude GitHub app and choose **All repositories**: https://github.com/apps/claude
2. Make a Claude token, copy it (the whole thing), then save it. `--save` reads the clipboard, tests the token, and keeps it in the macOS Keychain:
   ```bash
   claude setup-token
   ```
   ```bash
   factory secret --save --all
   ```
3. Optional: to have worker PRs show under your own name, and to use auto-merge, add a GitHub token as the `FACTORY_GH_TOKEN` secret. Steps in `kit/docs/factory/README.md` ("Your name on PRs").

## Add the factory to a repo

Ask Claude in that repo: **"set up the factory here"**. It runs `factory init`, tunes `factory.json` to the repo, fills in `AGENTS.md` and the feature map, runs the gates and opens a PR. Then you run:

```bash
factory secret
```

and merge the PR.

By hand: `factory init`, edit `factory.json`, `node .factory/gates.mjs`, `factory doctor`, open a PR.

## Commands

| Command | What it does |
|---|---|
| `factory init` | Detects the stack, writes `factory.json`, copies the kit into the repo |
| `factory update` | Refreshes the kit files to this version; keeps `factory.json` and your docs |
| `factory doctor` | Checks the setup: config, kit files, guard, labels, secrets, deploy workflows |
| `factory secret` | Tests your token and copies it from the Keychain into the repo's Actions secret (`--save` stores it first, `--all` does every factory repo) |

## What it detects

Node (npm, pnpm, yarn, bun; Next.js, Vite, Astro, Nuxt, SvelteKit, Remix, CRA), Python (pip, uv, poetry; pytest, ruff), Go, Rust, Makefiles, and static HTML sites. Anything else: write `factory.json` by hand.

## Layout

| Folder | What |
|---|---|
| `kit/` | Files copied into every repo and kept in sync by `factory update` |
| `scaffold/` | Files created once if missing (PR template, feature map), then owned by the repo |
| `lib/detect.mjs` | Stack detection for `factory init` |
| `skills/factory-setup/` | User-level Claude skill: "set up the factory here" |

Change the kit here, bump `version` in `package.json`, then run `factory update` in each repo.
