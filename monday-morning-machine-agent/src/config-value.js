#!/usr/bin/env node
import { loadRuntimeConfig, getPathValue } from './demo-config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const config = loadRuntimeConfig(ROOT, {});
const key = process.argv[2];

const aliases = {
  gatewayPort: 'gatewayPort',
  remoteReportPort: 'remoteReportPort',
  localReportPort: 'localReportPort',
  openclawModel: 'openclawModel',
  ollamaHost: 'ollamaHost',
};

if (!key) {
  console.error('Usage: config-value.js <path>');
  process.exit(2);
}

const value = getPathValue(config, aliases[key] ?? key);
if (value == null) process.exit(1);
if (typeof value === 'object') {
  process.stdout.write(`${JSON.stringify(value)}\n`);
} else {
  process.stdout.write(`${value}\n`);
}
