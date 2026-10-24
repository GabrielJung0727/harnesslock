import type { ResolvedPolicy } from "../schema/config-schema.js";
import type { DriftEvent, PolicyLevel, Severity, VerificationSummary } from "../types/model.js";
import type { RawDriftEvent } from "./diff-engine.js";

const LEVEL_TO_SEVERITY: Record<Exclude<PolicyLevel, "off">, Severity> = {
  error: "error",
  warn: "warning",
};

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/**
 * Turns raw drift into final events:
 * - `forced` events keep their default severity (explicit `required` / `require_pinned` contracts);
 * - events tied to a policy key take the configured level (`off` drops them);
 * - everything else keeps its default severity.
 */
export function applyPolicy(raw: readonly RawDriftEvent[], policy: ResolvedPolicy): DriftEvent[] {
  const out: DriftEvent[] = [];
  for (const event of raw) {
    const { defaultSeverity, policy: key, forced, ...rest } = event;
    let severity: Severity = defaultSeverity;
    if (!forced && key) {
      const level = policy[key];
      if (level === "off") continue;
      severity = LEVEL_TO_SEVERITY[level];
    }
    out.push({ ...rest, severity });
  }
  return out;
}

export function summarize(events: readonly DriftEvent[]): VerificationSummary {
  return {
    errors: events.filter((e) => e.severity === "error").length,
    warnings: events.filter((e) => e.severity === "warning").length,
    infos: events.filter((e) => e.severity === "info").length,
  };
}

/** 0 = clean or warnings only, 1 = drift / policy violation. (2 is reserved for config/internal errors.) */
export function exitCodeFor(events: readonly DriftEvent[]): 0 | 1 {
  return events.some((e) => e.severity === "error") ? 1 : 0;
}

export function worstSeverity(events: readonly DriftEvent[]): Severity | undefined {
  return [...events].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])[0]?.severity;
}
