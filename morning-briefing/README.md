# Morning Briefing Claw

Demo line: set it once. Every morning at 7am, a NemoClaw/OpenShell sandbox checks the news, weather, and your updates, then drops a short Telegram digest on your phone.

This repo is intentionally small: no npm dependencies, no app to open, and a dry-run fixture mode so the demo works even without network access or phone credentials.

## What It Shows

- NemoClaw provides the always-on OpenClaw sandbox and phone bridge surface.
- OpenShell enforces the network policy for weather, news, and Telegram delivery.
- The briefing claw runs as a scheduled Node process inside the sandbox.
- Telegram delivery makes the output feel like a morning notification, not another feed.

## Local Demo

```bash
npm run demo
```

That prints a fixture-backed briefing and writes:

- `out/latest-digest.md`
- `out/latest-briefing.json`

To try live weather/news with fixture fallback:

```bash
npm run brief
```

## Send To Your Phone

Create a Telegram bot with BotFather, then set:

```bash
export TELEGRAM_BOT_TOKEN="..."
export TELEGRAM_CHAT_ID="..."
npm run send
```

## Run In NemoClaw/OpenShell

This machine already has NemoClaw and OpenShell installed. The default registered sandbox on this host is `my-assistant`.

Upload the demo and apply the narrowly scoped egress policy overlay:

```bash
./scripts/deploy-to-sandbox.sh my-assistant
```

Then connect:

```bash
nemoclaw my-assistant connect
cd /sandbox/morning-briefing
npm run demo
```

Start the daily 7am sender:

```bash
TELEGRAM_BOT_TOKEN="..." TELEGRAM_CHAT_ID="..." npm run schedule
```

For an OpenClaw-driven run inside the sandbox:

```bash
./scripts/run-openclaw.sh
```

## OpenShell Policy Overlay

`openshell/morning-briefing-policy.yaml` adds only:

- `api.open-meteo.com` for weather
- `news.google.com` for RSS news search
- `api.gdeltproject.org` as a JSON news fallback
- `api.telegram.org` for Telegram delivery

All are restricted to `/usr/local/bin/node` in the sandbox. `scripts/deploy-to-sandbox.sh` reads the active sandbox policy, merges this overlay into it with `yq`, and applies the full merged policy so locked filesystem/process settings stay unchanged.

## Configure The Briefing

Edit `config/briefing.json`:

- `schedule.time`: default `07:00`
- `schedule.timezone`: default `America/Chicago`
- `location`: label plus latitude/longitude for Open-Meteo
- `topics`: GDELT search queries
- `updatesFile`: local calendar/task/message signals

Edit `data/updates.json` to simulate "pulls your updates" in the demo. The `dayOffset` and `dueOffsetDays` fields keep demo dates relative to the run date.
