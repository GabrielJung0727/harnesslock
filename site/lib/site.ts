export const SITE = {
  name: "HarnessLock",
  version: "0.1.1",
  repo: "https://github.com/GabrielJung0727/harnesslock",
  docs: "https://github.com/GabrielJung0727/harnesslock#readme",
  npm: "https://www.npmjs.com/package/harnesslock",
  install: "npx harnesslock init",
};

export const SETUP_PROMPT = `Set up HarnessLock in this repository.
1. Run \`npx harnesslock init\` and review the generated harnesslock.yaml with me.
2. Run \`npx harnesslock lock\` to write harnesslock.lock.
3. Run \`npx harnesslock verify\` and explain any drift it reports.
4. Only after I approve, run \`npx harnesslock sync --pin\` to fix drift, then \`npx harnesslock install-hooks\`.
Never start the MCP servers or hooks listed in the agent configs, and never print secret values.`;
