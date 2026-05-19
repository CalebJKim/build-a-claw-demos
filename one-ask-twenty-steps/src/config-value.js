#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPathValue, loadRuntimeConfig } from './demo-config.js';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '..');
const key = process.argv[2];

if (!key) {
  console.error('Usage: config-value.js <dotted.path>');
  process.exit(2);
}

const config = loadRuntimeConfig(root, {});
const value = getPathValue(config, key);

if (value == null) process.exit(1);
if (typeof value === 'object') {
  process.stdout.write(`${JSON.stringify(value)}\n`);
} else {
  process.stdout.write(`${String(value)}\n`);
}
