# TOOLS.md - One Ask Workflow Demo

## Primary Command

```bash
node scripts/demo-runner.mjs "Put together a reading list on personal finance for a beginner."
```

## Useful Variants

```bash
node scripts/demo-runner.mjs --json
node scripts/demo-runner.mjs --no-write --json
node scripts/demo-runner.mjs --publish md
node scripts/demo-runner.mjs --publish html
```

## Output Contract

The runner prints a short terminal summary and writes draft artifacts under `output/`.

The OpenClaw agent should inspect `output/beginner-personal-finance-reading-list.md` before briefing the user.

## Safety Contract

Do not use financial tools that move money, open accounts, place trades, apply for credit, submit tax forms, or enroll in paid products.

The demo is allowed to draft and publish educational artifacts only.
