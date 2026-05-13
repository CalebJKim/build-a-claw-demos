# Intro Basics

## Who this is for

Users who are **new to OpenClaw and agentic systems**. No prior experience required.

This is a **conversational demo** — expect a lot of entry-level questions, and lean into them:
- "What does it mean to serve a model locally?"
- "What is an agent?"
- "What's the difference between a model and an agent?"
- "Why do we need a gateway?"
- "What's tool calling?"

## What this demo covers

A tour of the framework's core capabilities, suitable for first exposure:

- **Web search** (via Ollama Web Search or Brave Search API)
- **Email** (via AgentMail)
- **Coding** (e.g. building a Pong game, Mario-style game, iterating with the agent)
- **OpenClaw-specific features**: heartbeat, cron jobs, VLM integration, webcam + vision
- **Advanced extension**: Isaac Sim/Lab

The reference walkthrough — install steps, model serving, `openclaw.json` setup, prompts to try, known issues — lives in [`Gemma 4 x OpenClaw on NVIDIA Spark.md`](./Gemma%204%20x%20OpenClaw%20on%20NVIDIA%20Spark.md). That file is the source of truth for instructions; this README just frames it.

## How to run

1. Set up the serving side (llama.cpp + Gemma 4) — see the "Llama.cpp x Openclaw manual setup" section of the linked doc. Keep the serving terminal open the entire session; it doubles as a debug screen.
2. Install OpenClaw and point it at your local vLLM endpoint.
3. Enable the skills you want to demo (web search, AgentMail, etc.).
4. Open `openclaw dashboard` and run through the "Really fun prompts" section conversationally.

## Hardware

Tuned for **NVIDIA Spark**. The memory footprint is the bottleneck — a 16GB gaming laptop will run Gemma 4 at roughly half the token rate, and Nemotron-3-super won't fit at all without a Spark or RTX PRO 6000-class card.
