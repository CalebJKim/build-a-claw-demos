import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function loadRuntimeConfig(root, defaults = {}) {
  const manifest = readJson(path.join(root, 'demo.config.json'));
  const legacy = readJson(path.join(root, 'resume-claw.config.json'));
  const mappedManifest = manifest ? manifestToRuntimeConfig(manifest) : {};
  return deepMerge(defaults, deepMerge(legacy ?? {}, mappedManifest));
}

export function getPathValue(value, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => {
    if (current == null) return undefined;
    return current[key];
  }, value);
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function manifestToRuntimeConfig(manifest) {
  const model = manifest.model ?? {};
  const ports = manifest.ports ?? {};
  return {
    name: manifest.name,
    profile: manifest.profile,
    openclawMinVersion: manifest.openclawMinVersion,
    nodeMinVersion: manifest.nodeMinVersion,
    agents: manifest.agents,
    requiredCommands: manifest.requiredCommands,
    optionalCommands: manifest.optionalCommands,
    generatedPaths: manifest.generatedPaths,
    sample: manifest.sample,
    claws: manifest.claws,
    gatewayPort: ports.gateway,
    remoteReportPort: ports.report,
    localReportPort: ports.localTunnel,
    model: model.id,
    openclawModel: model.openclawId,
    ollamaHost: model.baseUrl,
    contextTokens: model.contextTokens,
    maxOutputTokens: model.maxOutputTokens,
    temperature: model.temperature,
    search: manifest.search,
  };
}

function deepMerge(base, next) {
  if (next == null) return base;
  if (Array.isArray(base) || Array.isArray(next)) return next ?? base;
  if (!isPlainObject(base) || !isPlainObject(next)) return next ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(next)) {
    out[key] = deepMerge(base[key], value);
  }
  return out;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}
