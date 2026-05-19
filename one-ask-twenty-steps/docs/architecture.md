# Architecture

## What This Demo Shows

The user gives one request:

```text
Put together a reading list on personal finance for a beginner.
```

The OpenClaw agent turns that into a completed artifact without requiring the user to manage the intermediate steps.

## Runtime Shape

NemoClaw provides the managed sandbox.

OpenShell provides the constrained shell and policy boundary.

OpenClaw provides the agent interface inside the sandbox.

The demo runner provides deterministic behavior for live demos, so the story works without depending on network timing or search engine variance.

## Data Flow

1. User asks OpenClaw for the reading list.
2. OpenClaw runs `scripts/demo-runner.mjs`.
3. The runner loads `data/search_results.json` and `data/workflow_steps.json`.
4. The runner scores each result for authority, beginner fit, clarity, practicality, relevance, freshness, commercial pressure, and risk flags.
5. The runner selects a balanced set of resources by topic.
6. The runner writes Markdown and HTML into `output/`.
7. The agent briefs the user with selected resources, filtered resources, artifact paths, and verification status.

## Why The Corpus Is Local

The local corpus makes the demo repeatable. The policy file still shows how to allow read-only access to official education sources when the same workflow is connected to live search.

## Guardrails

The workflow creates educational material only.

It avoids individualized financial advice, specific investment recommendations, guaranteed returns, account opening, trades, loan applications, insurance sales, tax filings, and paid product enrollment.
