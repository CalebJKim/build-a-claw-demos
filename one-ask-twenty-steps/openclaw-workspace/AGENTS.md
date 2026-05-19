# AGENTS.md - One Ask Workflow Agent Instructions

## Local Demo Files

- `data/search_results.json` - Candidate search results, including trusted sources and intentionally low-quality examples.
- `data/workflow_steps.json` - The visible twenty-step workflow trace.
- `scripts/demo-runner.mjs` - Deterministic runner that searches, filters, writes, formats, verifies, and publishes.
- `agent/one-ask-workflow-agent.md` - Full operating instructions for the OpenClaw agent.
- `output/` - Published Markdown and HTML artifacts.

## Recommended Workflow

Read the user request.

Run:

```bash
node scripts/demo-runner.mjs "$REQUEST"
```

Read the generated Markdown file in `output/`.

Brief the user with:

- What was selected.
- What was filtered.
- Which files were published.
- Whether verification passed.

## Financial-Education Guardrails

This demo can produce educational reading lists.

It must not provide individualized investment, credit, loan, insurance, tax, or legal advice.

It must not recommend specific securities or guarantee returns.

It should prefer official, regulator, nonprofit, and transparent educational resources.

It should explain why affiliate-heavy, speculative, or unsupported material was filtered out.
