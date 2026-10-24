import { SectionHeading } from "./ui";

type Cell = { text: string; good?: boolean };

const COLUMNS = ["HarnessLock", "Shared dotfiles repo", "Container sandbox", "Manual checklist"];

const ROWS: Array<{ capability: string; cells: Cell[] }> = [
  {
    capability: "Detects MCP version drift",
    cells: [{ text: "per config, per machine", good: true }, { text: "only if copied" }, { text: "inside the image only" }, { text: "if someone looks" }],
  },
  {
    capability: "Resolves unpinned versions",
    cells: [{ text: "static cache inspection", good: true }, { text: "no" }, { text: "at build time" }, { text: "no" }],
  },
  {
    capability: "CLAUDE.md ↔ AGENTS.md sync",
    cells: [{ text: "canonical hash check", good: true }, { text: "no" }, { text: "no" }, { text: "by convention" }],
  },
  {
    capability: "Personal global MCP detection",
    cells: [{ text: "counts only, private", good: true }, { text: "no" }, { text: "isolated away" }, { text: "no" }],
  },
  {
    capability: "Pull request gate",
    cells: [{ text: "SARIF + markdown", good: true }, { text: "no" }, { text: "separate pipeline" }, { text: "review comment" }],
  },
  {
    capability: "Executes nothing to inspect",
    cells: [{ text: "100% static", good: true }, { text: "yes" }, { text: "runs the agent" }, { text: "yes" }],
  },
  {
    capability: "Secrets kept out of git",
    cells: [{ text: "value: excluded", good: true }, { text: "easy to leak" }, { text: "env injection" }, { text: "depends" }],
  },
  {
    capability: "Works with existing setups",
    cells: [{ text: "Claude Code · Codex · Cursor", good: true }, { text: "per tool" }, { text: "changes the workflow" }, { text: "any" }],
  },
];

export function Comparison() {
  return (
    <section id="compare" className="scroll-mt-20 border-t border-line py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="Side by side" title="Lockfile, dotfiles or sandbox?">
          The ways teams try to keep agent setups consistent today, and what each one actually guarantees.
        </SectionHeading>
        <div className="mt-12 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-panel">
                <th scope="col" className="px-5 py-4 font-medium text-slate-400">
                  Capability
                </th>
                {COLUMNS.map((column, index) => (
                  <th key={column} scope="col" className={`px-5 py-4 font-semibold ${index === 0 ? "text-emerald-300" : "text-slate-300"}`}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.capability} className="border-b border-line last:border-0">
                  <th scope="row" className="px-5 py-4 font-medium text-slate-200">
                    {row.capability}
                  </th>
                  {row.cells.map((cell, index) => (
                    <td key={index} className={`px-5 py-4 ${index === 0 ? "bg-emerald-500/[0.06] font-mono text-xs text-emerald-300" : "text-slate-400"}`}>
                      {cell.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
