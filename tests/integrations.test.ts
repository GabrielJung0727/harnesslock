import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const YAML_FILES = [
  "integrations/github-action/action.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/pages.yml",
  ".github/workflows/release.yml",
  ".github/dependabot.yml",
];

describe("shipped integration files", () => {
  it.each(YAML_FILES)("%s is valid YAML", async (file) => {
    const doc = parseDocument(await fs.readFile(file, "utf8"));
    expect(doc.errors.map((e) => e.message)).toEqual([]);
  });

  it("the GitHub Action declares a composite action with documented inputs", async () => {
    const action = parseDocument(await fs.readFile("integrations/github-action/action.yml", "utf8")).toJS();
    expect(action.runs.using).toBe("composite");
    for (const [name, input] of Object.entries<{ description?: unknown }>(action.inputs)) {
      expect(typeof input.description, `inputs.${name}.description`).toBe("string");
    }
  });

  it("plugin manifest is valid JSON", async () => {
    const manifest = JSON.parse(await fs.readFile("integrations/openai-plugin/plugin.json", "utf8"));
    expect(manifest.skills).toEqual(["./skills/verify"]);
  });
});
