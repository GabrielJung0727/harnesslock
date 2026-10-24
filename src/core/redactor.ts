import type { RedactedEnvEntry } from "../types/model.js";

export const REDACTED = "<redacted>";

/** Environment/flag names that always carry secrets. */
const SECRET_NAME_PATTERN = /(TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|PRIVATE|COOKIE|SESSION)/i;

/** Well-known credential prefixes. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /^gh[pousr]_[A-Za-z0-9]{8,}/,
  /^github_pat_[A-Za-z0-9_]{8,}/,
  /^sk-[A-Za-z0-9_-]{8,}/,
  /^sk_(live|test)_[A-Za-z0-9]{8,}/,
  /^rk_(live|test)_[A-Za-z0-9]{8,}/,
  /^xox[abposr]-[A-Za-z0-9-]{8,}/,
  /^eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/,
  /^AKIA[0-9A-Z]{16}$/,
  /^ASIA[0-9A-Z]{16}$/,
  /^glpat-[A-Za-z0-9_-]{8,}/,
  /^AIza[0-9A-Za-z_-]{20,}/,
  /^npm_[A-Za-z0-9]{20,}/,
  /^hf_[A-Za-z0-9]{20,}/,
  /^pypi-[A-Za-z0-9_-]{20,}/,
  /^lin_api_[A-Za-z0-9]{20,}/,
];

/** `${VAR}`, `$VAR` and `%VAR%` style references are not secrets themselves. */
const ENV_REFERENCE_PATTERN = /^(\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%)$/;

export function isSecretName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name);
}

export function isEnvReference(value: string): boolean {
  return ENV_REFERENCE_PATTERN.test(value.trim());
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** True for strings that look like credentials: known token prefixes or long high-entropy blobs. */
export function looksLikeSecretValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 8 || isEnvReference(trimmed)) return false;
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  // Long, unbroken base64/hex blobs with high entropy (paths, URLs and package specs are excluded).
  if (trimmed.length >= 32 && /^[A-Za-z0-9+/_=-]+$/.test(trimmed) && !/^[a-z0-9-]+$/.test(trimmed)) {
    const hasDigit = /[0-9]/.test(trimmed);
    const hasLetter = /[A-Za-z]/.test(trimmed);
    if (hasDigit && hasLetter && shannonEntropy(trimmed) >= 4.0) return true;
  }
  if (/^[0-9a-f]{40,}$/i.test(trimmed)) return true;
  return false;
}

/** Every environment variable is recorded only by presence. */
export function redactEnv(env: Record<string, unknown> | undefined): Record<string, RedactedEnvEntry> {
  const out: Record<string, RedactedEnvEntry> = {};
  for (const key of Object.keys(env ?? {}).sort()) {
    out[key] = { required: true, value: "excluded" };
  }
  return out;
}

/**
 * Material used for fingerprinting an `env` block. Secret values (by name or by shape) are replaced
 * by a constant so that neither the value nor any hash of it can leak via the lockfile; benign
 * values (e.g. `LOG_LEVEL=debug`) still participate so their changes are detected.
 */
export function envFingerprintMaterial(env: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(env ?? {})) {
    const value = typeof raw === "string" ? raw : JSON.stringify(raw ?? null);
    if (isSecretName(key) || looksLikeSecretValue(value)) {
      out[key] = REDACTED;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Redacts secrets embedded in a free-form string (header values, command lines, URLs). */
export function redactString(input: string): string {
  let out = input;
  // Authorization schemes.
  out = out.replace(/\b(Bearer|Basic|Token)\s+[^\s"']+/gi, (_m, scheme: string) => `${scheme} ${REDACTED}`);
  // URL userinfo.
  out = out.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(:[^\s/@]*)?@/gi, (_m, scheme: string) => `${scheme}${REDACTED}@`);
  // Query parameters with secret-looking names.
  out = out.replace(/([?&])([^=&\s]+)=([^&\s"']*)/g, (match, sep: string, name: string, value: string) =>
    isSecretName(name) || looksLikeSecretValue(value) ? `${sep}${name}=${REDACTED}` : match,
  );
  // NAME=value assignments with secret names (e.g. `-e GITHUB_TOKEN=...`).
  out = out.replace(/\b([A-Za-z_][A-Za-z0-9_]*)=([^\s"'&]+)/g, (match, name: string, value: string) =>
    (isSecretName(name) && !isEnvReference(value)) || looksLikeSecretValue(value) ? `${name}=${REDACTED}` : match,
  );
  // Bare tokens.
  out = out
    .split(/(\s+)/)
    .map((part) => (looksLikeSecretValue(part.replace(/^["']|["']$/g, "")) ? REDACTED : part))
    .join("");
  return out;
}

/**
 * Redacts command-line arguments: `--api-key=...`, `--token <value>`, `Authorization: Bearer ...`,
 * `NAME=value` with secret names, and bare credential-shaped values.
 */
export function redactArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  let redactNext = false;
  for (const arg of args) {
    if (redactNext) {
      out.push(isEnvReference(arg) ? arg : REDACTED);
      redactNext = false;
      continue;
    }
    const flagWithValue = /^(--?[A-Za-z0-9][A-Za-z0-9_-]*)=(.*)$/s.exec(arg);
    if (flagWithValue) {
      const [, flag = "", value = ""] = flagWithValue;
      if (isSecretName(flag) && !isEnvReference(value)) {
        out.push(`${flag}=${REDACTED}`);
        continue;
      }
    }
    if (/^--?[A-Za-z0-9][A-Za-z0-9_-]*$/.test(arg) && isSecretName(arg)) {
      out.push(arg);
      redactNext = true;
      continue;
    }
    out.push(redactString(arg));
  }
  return out;
}

/** Redacts every value of a header map, keeping only the header names. */
export function redactHeaders(headers: Record<string, unknown> | undefined): string[] {
  return Object.keys(headers ?? {}).sort();
}

/** Returns true when the string contains any recognizable credential. */
export function containsSecret(input: string): boolean {
  return redactString(input) !== input;
}
