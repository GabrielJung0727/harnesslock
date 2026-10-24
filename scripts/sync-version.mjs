// Runs from the npm `version` lifecycle (`npm version patch|minor|major`): copies the new
// package.json version into files that cannot import package.json themselves.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

const pluginPath = "integrations/openai-plugin/plugin.json";
const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));
plugin.version = version;
writeFileSync(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`);

const sitePath = "site/lib/site.ts";
const site = readFileSync(sitePath, "utf8");
const updated = site.replace(/(\bversion:\s*")[^"]*(")/, `$1${version}$2`);
if (updated === site && !site.includes(`version: "${version}"`)) {
  throw new Error(`could not find the version field in ${sitePath}`);
}
writeFileSync(sitePath, updated);

console.log(`synced version ${version} → ${pluginPath}, ${sitePath}`);
