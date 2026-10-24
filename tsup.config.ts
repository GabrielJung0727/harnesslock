import { defineConfig } from "tsup";

export default defineConfig({
  entry: { bin: "src/bin.ts", index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: true,
  splitting: true,
  dts: { entry: { index: "src/index.ts" } },
});
