#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from './demo-config.js';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '..');
const config = loadRuntimeConfig(root, {});

for (const agent of config.agents ?? []) {
  const fields = [
    agent.id,
    agent.workspace,
    agent.agentDir,
    agent.template,
    agent.soul,
    agent.chatFacing ? 'true' : 'false',
  ];
  process.stdout.write(`${fields.join('\t')}\n`);
}
