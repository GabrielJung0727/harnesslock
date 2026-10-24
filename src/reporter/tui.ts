import pc from "picocolors";
import { worstSeverity } from "../core/policy-engine.js";
import type { ComponentStatus, DriftEvent, ReportSection, Severity, VerificationReport } from "../types/model.js";
import { VERSION } from "../version.js";

export type Colors = ReturnType<typeof pc.createColors>;

export function createPalette(enabled: boolean) {
  const c = pc.createColors(enabled);
  return {
    c,
    brand: (s: string) => c.bold(c.cyan(s)),
    ok: (s: string) => c.green(s),
    warn: (s: string) => c.yellow(s),
    error: (s: string) => c.bold(c.red(s)),
    dim: (s: string) => c.dim(s),
    bold: (s: string) => c.bold(s),
  };
}

export type Palette = ReturnType<typeof createPalette>;

export const SYMBOLS = { ok: "✓", warning: "⚠", error: "✕", skipped: "○", info: "ℹ" } as const;

const RULE_WIDTH = 60;
const LABEL_WIDTH = 18;

export function divider(p: Palette): string {
  return p.dim("─".repeat(RULE_WIDTH));
}

export function header(p: Palette, title: string): string {
  return `${p.brand(`🔒 HarnessLock v${VERSION}`)} ${p.dim("—")} ${p.bold(title)}\n${divider(p)}`;
}

function symbolFor(p: Palette, severity: Severity): string {
  if (severity === "error") return p.error(SYMBOLS.error);
  if (severity === "warning") return p.warn(SYMBOLS.warning);
  return p.dim(SYMBOLS.info);
}

const SECTION_TITLES: Record<ReportSection, string> = {
  lock: "Lockfile & Configuration",
  agents: "Agents",
  instructions: "Instructions",
  mcp: "MCP Servers",
  skills: "Skills & Hooks",
  hooks: "Skills & Hooks",
  rules: "Rules",
  security: "Security & Permissions",
};

/** Sections rendered together under one heading. */
const SECTION_GROUPS: ReportSection[][] = [["lock"], ["agents"], ["instructions"], ["mcp"], ["skills", "hooks"], ["rules"], ["security"]];

function sectionTitle(report: VerificationReport, sections: ReportSection[]): string {
  const first = sections[0] as ReportSection;
  if (first === "agents") {
    return report.mode === "ci" ? "Agents (repository mode)" : `Agents (Strategy: ${report.presenceStrategy})`;
  }
  if (first === "instructions") return `Instructions (Strategy: ${report.instructionStrategy})`;
  return SECTION_TITLES[first];
}

function pad(label: string): string {
  return label.length >= LABEL_WIDTH ? `${label} ` : label.padEnd(LABEL_WIDTH + 1);
}

const DETAIL_INDENT = " ".repeat(4 + LABEL_WIDTH + 1);

function renderEvents(p: Palette, id: string, events: DriftEvent[]): string[] {
  const lines: string[] = [];
  events.forEach((event, index) => {
    const label = index === 0 ? pad(id) : " ".repeat(LABEL_WIDTH + 1);
    lines.push(`  ${symbolFor(p, event.severity)} ${label}${event.message}`);
    if (event.expected !== undefined) lines.push(`${DETAIL_INDENT}${p.dim("expected:")} ${event.expected}`);
    if (event.actual !== undefined) lines.push(`${DETAIL_INDENT}${p.dim("actual:  ")} ${event.actual}`);
  });
  return lines;
}

function renderComponent(p: Palette, component: ComponentStatus): string {
  if (component.state === "skipped") return `  ${p.dim(SYMBOLS.skipped)} ${p.dim(pad(component.id) + component.detail)}`;
  return `  ${p.ok(SYMBOLS.ok)} ${pad(component.id)}${p.dim(component.detail)}`;
}

export interface TuiOptions {
  color: boolean;
}

export function renderVerifyReport(report: VerificationReport, options: TuiOptions): string {
  const p = createPalette(options.color);
  const out: string[] = [header(p, report.mode === "ci" ? "Repository Verification (--ci)" : "Environment Verification"), ""];

  for (const sections of SECTION_GROUPS) {
    const components = report.components.filter((comp) => sections.includes(comp.section));
    const events = report.events.filter((e) => sections.includes(e.section));
    if (components.length === 0 && events.length === 0) continue;
    out.push(p.bold(sectionTitle(report, sections)));

    const ids: string[] = [];
    for (const item of [...components.map((x) => x.id), ...events.map((e) => e.componentId)]) {
      if (!ids.includes(item)) ids.push(item);
    }
    for (const id of ids) {
      const own = events.filter((e) => e.componentId === id);
      if (own.length > 0) {
        const sorted = [...own].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : b.severity === "error" ? 1 : 0));
        out.push(...renderEvents(p, id, sorted));
      } else {
        const component = components.find((x) => x.id === id);
        if (component) out.push(renderComponent(p, component));
      }
    }
    out.push("");
  }

  if (report.components.length === 0 && report.events.length === 0) {
    out.push(p.dim("  Nothing to verify: no agent configuration found."), "");
  }

  out.push(divider(p));
  const { errors, warnings } = report.summary;
  const counts = `(${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}) in ${report.durationMs}ms`;
  out.push(errors > 0 ? `Status: ${p.error("FAILED")} ${counts}` : `Status: ${p.ok("PASSED")} ${counts}`);

  if (errors > 0 || warnings > 0) {
    const hints = new Map<string, string>([
      ["View exact line diffs:", "npx harnesslock diff"],
      ["Auto-pin & sync configs:", "npx harnesslock sync --pin"],
    ]);
    for (const event of report.events) {
      if (!event.remediation) continue;
      if (event.remediation === "npx harnesslock lock") hints.set("Regenerate the lockfile:", event.remediation);
    }
    out.push("", p.bold("💡 Quick Remediation:"));
    for (const [label, cmd] of hints) out.push(`  • ${label.padEnd(28)}${p.c.cyan(cmd)}`);
  }
  return `${out.join("\n")}\n`;
}

/** One-line banner used by git hooks (`verify --quiet`). Empty when clean. */
export function renderQuietBanner(report: VerificationReport, options: TuiOptions): string {
  const p = createPalette(options.color);
  const worst = worstSeverity(report.events);
  if (!worst || worst === "info" || report.summary.errors === 0) return "";
  const { errors, warnings } = report.summary;
  return (
    `${p.error("🔒 HarnessLock: agent configuration drift detected")} ` +
    `(${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}). ` +
    `Run ${p.c.cyan("npx harnesslock verify")} for details or ${p.c.cyan("npx harnesslock sync --pin")} to fix.\n`
  );
}
