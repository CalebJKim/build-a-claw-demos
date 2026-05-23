#!/usr/bin/env node
const [root, portRaw, openclawModel, vllmModel, vllmBaseUrl] = process.argv.slice(2);

if (!root || !portRaw || !openclawModel || !vllmModel || !vllmBaseUrl) {
  console.error('Usage: write-openclaw-patch.js <root> <port> <openclaw-model> <vllm-model> <vllm-base-url>');
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
        [openclawModel]: {},
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
      vllm: {
        baseUrl: vllmBaseUrl,
        apiKey: 'local',
        api: 'openai-completions',
        models: [
          {
            id: vllmModel,
            name: vllmModel,
            reasoning: true,
            input: ['text', 'image'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 262144,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
};

process.stdout.write(`${JSON.stringify(patch, null, 2)}\n`);
