#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from './demo-config.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const config = loadRuntimeConfig(ROOT, {});

for (const agent of config.agents ?? []) {
  process.stdout.write([
    agent.id,
    agent.workspace,
    agent.agentDir,
    agent.template,
    agent.soul,
    agent.chatFacing ? 'true' : 'false',
  ].join('\t') + '\n');
}
