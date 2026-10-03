---
name: factory-file
description: Turn a request described in chat into a well-formed factory issue on GitHub, so a cloud agent picks it up. Use when the user says "file this", "add to the factory", "queue this", or describes work on this repo they want done later or in the background.
---

# File work for the factory

1. Restate the request in one plain sentence and confirm any detail that changes the result (which page, exact copy, which behaviour). Keep it to one short question at most.
2. Size it. If it's more than one concern, split it into separate issues, one change each.
3. Create each issue:

```bash
gh issue create --label factory --title "<imperative, under 60 chars>" --body-file - <<'BODY'
## What
<plain description of the change or bug>

## Where
<routes, screens, files or modules; use docs/factory/feature-map.md>

## Done when
- [ ] <checkable outcome, e.g. "on /pricing at 390px the buy button is visible without scrolling">
- [ ] <another>

## Notes
<copy to use word for word, links, constraints. "None" if nothing>
BODY
```

4. The `factory` label starts the cloud worker right away. To queue without starting, create the issue without the label and say so.
5. Reply with the issue links and one line on what will happen next.

Rules:
- "Done when" must be checkable from a screenshot, a test or a command. "Looks better" isn't checkable, so ask what "better" means.
- Never put secrets, personal data or unverified claims in an issue.
- If the `factory` label doesn't exist yet: `gh label create factory --color B60205 --description "Agent factory: build this"`.
