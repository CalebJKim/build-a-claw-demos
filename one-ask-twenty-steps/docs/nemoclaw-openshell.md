# NemoClaw and OpenShell Runbook

## Local Smoke Test

From this project directory:

```bash
npm run demo
```

Expected output:

- A terminal summary beginning with `One Ask, Twenty Steps Done`.
- `output/beginner-personal-finance-reading-list.md`.
- `output/beginner-personal-finance-reading-list.html`.
- `Verification passed.`

## Upload To OpenShell

```bash
./scripts/upload-to-openshell.sh my-assistant
```

The default destination is:

```text
/sandbox/one-ask-workflow
```

## Connect With NemoClaw

```bash
nemoclaw my-assistant connect
```

## Bootstrap The OpenClaw Agent

Inside the sandbox:

```bash
cd /sandbox/one-ask-workflow
./scripts/bootstrap-openclaw-agent.sh
```

## Run Through OpenClaw

```bash
openclaw agent --agent one-ask-workflow --message "Run the one-ask reading-list workflow for: Put together a reading list on personal finance for a beginner."
```

## Apply The Policy Preset

For persistent use, copy the preset into the NemoClaw policy preset directory and apply it through your normal NemoClaw workflow:

```bash
cp policies/research-publishing.yaml ~/.nemoclaw/source/nemoclaw-blueprint/policies/presets/one-ask-research.yaml
nemoclaw my-assistant policy-add
```

The preset is intentionally read-mostly. It allows official education sources for research and sandbox-local output publishing.
