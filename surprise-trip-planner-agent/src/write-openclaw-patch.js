#!/usr/bin/env node
const [root, portRaw, openclawModel, ollamaModel, ollamaHost] = process.argv.slice(2);

if (!root || !portRaw || !openclawModel || !ollamaModel || !ollamaHost) {
  console.error('Usage: write-openclaw-patch.js <root> <port> <openclaw-model> <ollama-model> <ollama-host>');
  process.exit(1);
}

const port = Number(portRaw);

const patch = {
  gateway: {
    mode: 'local',
    port,
  },
  agents: {
    defaults: {
      model: {
        primary: openclawModel,
        fallbacks: [],
      },
      models: {
        [openclawModel]: {
          alias: 'Trip Demo Local',
        },
      },
      workspace: `${root}/workspaces/main`,
      maxConcurrent: 3,
      subagents: {
        maxConcurrent: 3,
      },
    },
  },
  models: {
    mode: 'merge',
    providers: {
      ollama: {
        baseUrl: ollamaHost,
        apiKey: 'ollama',
        api: 'ollama',
        models: [
          {
            id: ollamaModel,
            name: ollamaModel,
            reasoning: false,
            input: ['text'],
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
            },
            contextWindow: 262144,
            maxTokens: 8192,
            api: 'ollama',
          },
        ],
      },
    },
  },
};

process.stdout.write(`${JSON.stringify(patch, null, 2)}\n`);
