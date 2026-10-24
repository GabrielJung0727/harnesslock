import { describe, expect, it } from "vitest";
import {
  canonicalize,
  canonicalizeInstruction,
  fingerprint,
  hashFileContent,
  hashInstruction,
  hashText,
  sha256,
} from "../src/core/canonical.js";
import { envFingerprintMaterial, looksLikeSecretValue, redactArgs, redactEnv, redactString, REDACTED } from "../src/core/redactor.js";

describe("canonicalize (RFC 8785)", () => {
  it("sorts keys recursively so key order never changes the fingerprint", () => {
    const a = { mcpServers: { github: { command: "npx", args: ["-y", "x"], env: { B: "2", A: "1" } } }, z: 1, a: [3, { y: 1, x: 2 }] };
    const b = { a: [3, { x: 2, y: 1 }], z: 1, mcpServers: { github: { env: { A: "1", B: "2" }, args: ["-y", "x"], command: "npx" } } };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(a)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("matches the JCS serialization rules for primitives", () => {
    expect(canonicalize({ b: true, a: null, c: 1e21, d: 0.5, e: "é\n", f: undefined })).toBe('{"a":null,"b":true,"c":1e+21,"d":0.5,"e":"é\\n"}');
    expect(canonicalize([undefined, 1])).toBe("[null,1]");
    expect(canonicalize(-0)).toBe("0");
    expect(() => canonicalize(Number.NaN)).toThrow(TypeError);
  });

  it("orders keys by UTF-16 code units", () => {
    expect(canonicalize({ "€": 1, "\r": 2, "1": 3, a: 4, A: 5 })).toBe('{"\\r":2,"1":3,"A":5,"a":4,"€":1}');
  });

  it("produces the published SHA-256 for a known input", () => {
    expect(sha256("")).toBe("sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("text normalization", () => {
  it("treats CRLF and LF (and trailing whitespace) identically", () => {
    const lf = "# Title\n\nLine one\nLine two\n";
    const crlf = "# Title  \r\n\r\nLine one\t\r\nLine two\r\n\r\n";
    expect(hashText(lf)).toBe(hashText(crlf));
    expect(hashFileContent(Buffer.from(lf))).toBe(hashFileContent(Buffer.from(crlf)));
  });

  it("hashes binary content raw", () => {
    const a = Buffer.from([0, 1, 2, 13, 10]);
    const b = Buffer.from([0, 1, 2, 10]);
    expect(hashFileContent(a)).not.toBe(hashFileContent(b));
  });

  it("strips HTML comments and collapses blank lines in instruction files", () => {
    const a = "# Rules\n<!-- internal note -->\n\n\n\nUse pnpm.\n";
    const b = "﻿# Rules\r\n\r\nUse pnpm.";
    expect(canonicalizeInstruction(a)).toBe("# Rules\n\nUse pnpm.");
    expect(hashInstruction(a)).toBe(hashInstruction(b));
  });
});

describe("secret redaction", () => {
  const token = "ghp_1234567890abcdefABCDEF1234567890ab";

  it("detects well-known token formats", () => {
    expect(looksLikeSecretValue("ghp_1234567890abcdef")).toBe(true);
    expect(looksLikeSecretValue("sk-proj-abcdefghijklmnop")).toBe(true);
    expect(looksLikeSecretValue("xoxb-1234-5678-abcdefgh")).toBe(true);
    expect(looksLikeSecretValue("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig")).toBe(true);
    expect(looksLikeSecretValue("${GITHUB_TOKEN}")).toBe(false);
    expect(looksLikeSecretValue("@modelcontextprotocol/server-github@1.4.7")).toBe(false);
    expect(looksLikeSecretValue("debug")).toBe(false);
  });

  it("records every env var only by presence", () => {
    expect(redactEnv({ GITHUB_TOKEN: token, LOG_LEVEL: "debug" })).toEqual({
      GITHUB_TOKEN: { required: true, value: "excluded" },
      LOG_LEVEL: { required: true, value: "excluded" },
    });
  });

  it("never lets a secret value (or its hash) influence fingerprints", () => {
    const a = envFingerprintMaterial({ GITHUB_TOKEN: "ghp_1234567890abcdef", API_URL: "https://x" });
    const b = envFingerprintMaterial({ GITHUB_TOKEN: "ghp_ffffffffffffffff", API_URL: "https://x" });
    expect(a).toEqual(b);
    expect(a.GITHUB_TOKEN).toBe(REDACTED);
    expect(JSON.stringify(a)).not.toContain("ghp_");
    // Secret-shaped values are excluded even under innocuous names.
    expect(envFingerprintMaterial({ VALUE: "ghp_1234567890abcdef" }).VALUE).toBe(REDACTED);
    // Benign values still participate.
    expect(envFingerprintMaterial({ LOG_LEVEL: "debug" }).LOG_LEVEL).toBe("debug");
  });

  it("redacts secrets inside command-line arguments", () => {
    const args = redactArgs([
      "--api-key=sk-live-abcdefghijklmnop",
      "--token",
      token,
      "--header",
      "Authorization: Bearer abc.def.ghi",
      "-e",
      "GITHUB_TOKEN=ghp_1234567890abcdef",
      token,
      "--port=3000",
      "@modelcontextprotocol/server-github@1.4.7",
    ]);
    expect(args).toEqual([
      `--api-key=${REDACTED}`,
      "--token",
      REDACTED,
      "--header",
      `Authorization: Bearer ${REDACTED}`,
      "-e",
      `GITHUB_TOKEN=${REDACTED}`,
      REDACTED,
      "--port=3000",
      "@modelcontextprotocol/server-github@1.4.7",
    ]);
    expect(args.join(" ")).not.toContain("ghp_");
  });

  it("redacts URL credentials and secret query parameters", () => {
    expect(redactString("https://user:pass@example.com/mcp?token=abc123&mode=x")).toBe(`https://${REDACTED}@example.com/mcp?token=${REDACTED}&mode=x`);
  });
});
