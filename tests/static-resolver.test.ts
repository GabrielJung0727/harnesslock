import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatPinnedSpec,
  locateInstalledNpmPackage,
  locateInstalledPythonPackage,
  parseMcpCommand,
  resolveInstalledNpmVersion,
} from "../src/core/static-resolver.js";
import { GITHUB_PKG, makeSandbox, npxCachePackage, writeFiles, type Sandbox } from "./helpers.js";

describe("parseMcpCommand", () => {
  it("parses unpinned npx commands", () => {
    const parsed = parseMcpCommand("npx", ["-y", GITHUB_PKG]);
    expect(parsed).toMatchObject({ sourceType: "npm", runner: "npx", packageName: GITHUB_PKG, isPinned: false });
    expect(parsed.declaredVersion).toBeUndefined();
    expect(parsed.specLocation).toEqual({ index: 1, prefix: "" });
  });

  it("parses pinned, tagged and ranged npm specs", () => {
    expect(parseMcpCommand("npx", ["--yes", `${GITHUB_PKG}@1.4.7`])).toMatchObject({ declaredVersion: "1.4.7", isPinned: true });
    expect(parseMcpCommand("npx", ["-y", `${GITHUB_PKG}@latest`])).toMatchObject({ declaredVersion: "latest", isPinned: false });
    expect(parseMcpCommand("npx", ["-y", `${GITHUB_PKG}@^1.4.0`])).toMatchObject({ declaredVersion: "^1.4.0", isPinned: false });
    expect(parseMcpCommand("npx", ["-y", "mcp-server@2.0.0-beta.1", "--port", "3000"])).toMatchObject({
      packageName: "mcp-server",
      declaredVersion: "2.0.0-beta.1",
      isPinned: true,
    });
  });

  it("honours -p / --package and strips runner flags", () => {
    expect(parseMcpCommand("npx", ["-p", "@scope/pkg@3.1.0", "pkg-bin", "--flag"])).toMatchObject({
      packageName: "@scope/pkg",
      declaredVersion: "3.1.0",
      specLocation: { index: 1, prefix: "" },
    });
    expect(parseMcpCommand("npx", ["--package=@scope/pkg@3.1.0", "pkg-bin"])).toMatchObject({
      packageName: "@scope/pkg",
      specLocation: { index: 0, prefix: "--package=" },
    });
  });

  it("supports bunx, pnpm dlx, npm exec and Windows cmd /c wrappers", () => {
    expect(parseMcpCommand("bunx", ["@scope/a@1.0.0"])).toMatchObject({ runner: "bunx", packageName: "@scope/a", isPinned: true });
    expect(parseMcpCommand("pnpm", ["dlx", "@scope/b"])).toMatchObject({ runner: "pnpm dlx", packageName: "@scope/b", isPinned: false, specLocation: { index: 1 } });
    expect(parseMcpCommand("npm", ["exec", "--yes", "--", "c@2.0.0"])).toMatchObject({ runner: "npm exec", packageName: "c", isPinned: true });
    const wrapped = parseMcpCommand("C:\\Windows\\System32\\cmd.exe", ["/c", "npx", "-y", `${GITHUB_PKG}@1.4.7`]);
    expect(wrapped).toMatchObject({ runner: "npx", packageName: GITHUB_PKG, isPinned: true, specLocation: { index: 3, prefix: "" } });
    expect(wrapped.normalizedArgs).toEqual(["/c", "npx", "-y", GITHUB_PKG]);
  });

  it("parses uvx / pipx specs", () => {
    expect(parseMcpCommand("uvx", ["mcp-server-git==0.6.2", "--repository", "."])).toMatchObject({
      sourceType: "uvx",
      packageName: "mcp-server-git",
      declaredVersion: "0.6.2",
      isPinned: true,
    });
    expect(parseMcpCommand("uvx", ["mcp-server-fetch"])).toMatchObject({ isPinned: false });
    expect(parseMcpCommand("uvx", ["--from", "mcp-server-time>=1.0", "mcp-server-time"])).toMatchObject({
      packageName: "mcp-server-time",
      isPinned: false,
      specLocation: { index: 1 },
    });
    expect(parseMcpCommand("uv", ["tool", "run", "pkg[cli]@1.2.3"])).toMatchObject({ runner: "uv tool run", packageName: "pkg", specExtras: "[cli]", isPinned: true });
    expect(parseMcpCommand("pipx", ["run", "--spec", "tool==2.0", "tool"])).toMatchObject({ runner: "pipx run", packageName: "tool", isPinned: true });
  });

  it("parses docker images and tags", () => {
    const args = ["run", "-i", "--rm", "-e", "GITHUB_TOKEN", "ghcr.io/github/github-mcp-server:v0.4.0"];
    expect(parseMcpCommand("docker", args)).toMatchObject({
      sourceType: "docker",
      packageName: "ghcr.io/github/github-mcp-server",
      declaredVersion: "v0.4.0",
      isPinned: true,
      specLocation: { index: 5 },
    });
    expect(parseMcpCommand("docker", ["run", "-i", "mcp/postgres:latest"])).toMatchObject({ isPinned: false, declaredVersion: "latest" });
    expect(parseMcpCommand("docker", ["run", "localhost:5000/mcp"])).toMatchObject({ packageName: "localhost:5000/mcp", isPinned: false });
    expect(parseMcpCommand("podman", ["run", "img@sha256:abc"])).toMatchObject({ isPinned: true, declaredVersion: "sha256:abc" });
  });

  it("treats other commands as local", () => {
    expect(parseMcpCommand("node", ["./scripts/mcp.js"])).toMatchObject({ sourceType: "local", isPinned: true });
  });

  it("formats pinned specs per source type", () => {
    expect(formatPinnedSpec("npm", GITHUB_PKG, "1.4.7")).toBe(`${GITHUB_PKG}@1.4.7`);
    expect(formatPinnedSpec("uvx", "pkg", "1.2.3", "[cli]")).toBe("pkg[cli]==1.2.3");
    expect(formatPinnedSpec("docker", "mcp/pg", "0.6.2")).toBe("mcp/pg:0.6.2");
  });
});

describe("static version resolution", () => {
  let sandbox: Sandbox;
  beforeEach(async () => {
    sandbox = await makeSandbox();
  });
  afterEach(async () => {
    await sandbox.cleanup();
  });

  it("resolves an unpinned npx package from ~/.npm/_npx without executing anything", async () => {
    await writeFiles(sandbox.home, npxCachePackage("1.4.7"));
    const parsed = parseMcpCommand("npx", ["-y", GITHUB_PKG]);
    expect(parsed.isPinned).toBe(false);
    const version = await resolveInstalledNpmVersion(parsed.packageName as string, sandbox.root, sandbox.home, { env: {} });
    expect(version).toBe("1.4.7");
    const located = await locateInstalledNpmPackage(GITHUB_PKG, sandbox.root, sandbox.home, { env: {} });
    expect(located?.source).toBe("npx-cache");
  });

  it("picks the highest cached version across npx cache entries", async () => {
    await writeFiles(sandbox.home, { ...npxCachePackage("1.4.7", "aaa"), ...npxCachePackage("1.6.1", "bbb"), ...npxCachePackage("1.5.0", "ccc") });
    await writeFiles(sandbox.home, { ".npm/_npx/broken/node_modules/@modelcontextprotocol/server-github/package.json": "{not json" });
    expect(await resolveInstalledNpmVersion(GITHUB_PKG, sandbox.root, sandbox.home, { env: {} })).toBe("1.6.1");
  });

  it("prefers the workspace node_modules, then package-lock.json", async () => {
    await writeFiles(sandbox.home, npxCachePackage("1.6.1"));
    await writeFiles(sandbox.root, {
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { [`node_modules/${GITHUB_PKG}`]: { version: "1.5.2" } } }),
    });
    expect(await locateInstalledNpmPackage(GITHUB_PKG, sandbox.root, sandbox.home, { env: {} })).toMatchObject({ version: "1.5.2", source: "package-lock" });
    await writeFiles(sandbox.root, { [`node_modules/${GITHUB_PKG}/package.json`]: JSON.stringify({ version: "1.4.9" }) });
    expect(await locateInstalledNpmPackage(GITHUB_PKG, sandbox.root, sandbox.home, { env: {} })).toMatchObject({ version: "1.4.9", source: "node_modules" });
  });

  it("honours npm_config_cache and survives missing caches", async () => {
    expect(await resolveInstalledNpmVersion(GITHUB_PKG, sandbox.root, sandbox.home, { env: {} })).toBeUndefined();
    const custom = path.join(sandbox.base, "custom-cache");
    await fs.mkdir(custom, { recursive: true });
    await writeFiles(custom, { [`_npx/x1/node_modules/${GITHUB_PKG}/package.json`]: JSON.stringify({ version: "2.0.0" }) });
    expect(await resolveInstalledNpmVersion(GITHUB_PKG, sandbox.root, sandbox.home, { env: { npm_config_cache: custom } })).toBe("2.0.0");
  });

  it("reads Python versions from uv tool installs and pipx venvs", async () => {
    await writeFiles(sandbox.home, {
      ".local/share/uv/tools/mcp-server-git/lib/python3.12/site-packages/mcp_server_git-0.6.2.dist-info/METADATA": "Metadata-Version: 2.1\nName: mcp-server-git\nVersion: 0.6.2\n",
      ".local/pipx/venvs/mcp-server-fetch/Lib/site-packages/mcp_server_fetch-1.1.0.dist-info/METADATA": "Name: mcp-server-fetch\nVersion: 1.1.0\n",
    });
    expect(await locateInstalledPythonPackage("mcp-server-git", sandbox.home, { env: {}, platform: "linux" })).toMatchObject({ version: "0.6.2", source: "uv-tools" });
    expect(await locateInstalledPythonPackage("mcp_server.fetch", sandbox.home, { env: {}, platform: "linux" })).toMatchObject({ version: "1.1.0", source: "pipx" });
    expect(await locateInstalledPythonPackage("missing", sandbox.home, { env: {}, platform: "linux" })).toBeUndefined();
  });
});
