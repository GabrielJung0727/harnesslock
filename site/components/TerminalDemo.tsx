"use client";

import { useEffect, useState } from "react";
import { SectionHeading } from "./ui";

type Tone = "dim" | "ok" | "warn" | "err" | "brand" | "bold" | "plain" | "cmd";
type Line = [Tone, string];

const TONE: Record<Tone, string> = {
  dim: "text-slate-500",
  ok: "text-emerald-400",
  warn: "text-amber-400",
  err: "text-red-400 font-semibold",
  brand: "text-cyan-300 font-semibold",
  bold: "text-white font-semibold",
  plain: "text-slate-200",
  cmd: "text-white",
};

const RULE = "────────────────────────────────────────────────────────────";

/** Real `harnesslock` output, captured from the CLI. */
const SCENES: Record<string, { title: string; caption: string; lines: Line[] }> = {
  clean: {
    title: "verify · clean",
    caption: "Everyone matches the lock. Codex isn't installed on this laptop, so it's skipped — not failed.",
    lines: [
      ["cmd", "$ npx harnesslock verify"],
      ["brand", "🔒 HarnessLock v0.1.0 — Environment Verification"],
      ["dim", RULE],
      ["bold", "Agents (Strategy: if_installed)"],
      ["ok", "  ✓ Claude Code        installed"],
      ["dim", "  ○ Codex              not installed (skipped by policy)"],
      ["ok", "  ✓ Cursor             3.22.12 (satisfies >=3.22.0)"],
      ["bold", "Instructions (Strategy: cross-sync)"],
      ["ok", "  ✓ core-agent-instructions CLAUDE.md == AGENTS.md (synced)"],
      ["bold", "MCP Servers"],
      ["ok", "  ✓ github             1.4.7 (pinned across 2 configs)"],
      ["bold", "Security & Permissions"],
      ["ok", "  ✓ github             1 permission within policy"],
      ["ok", "  ✓ user-scope         no unapproved global MCPs or hooks"],
      ["dim", RULE],
      ["ok", "Status: PASSED (0 errors, 0 warnings) in 215ms"],
    ],
  },
  drift: {
    title: "verify · drift",
    caption: "Someone unpinned the GitHub MCP, granted repository:delete and edited only AGENTS.md. A personal MCP sits in ~/.cursor.",
    lines: [
      ["cmd", "$ npx harnesslock verify"],
      ["bold", "Instructions (Strategy: cross-sync)"],
      ["err", "  ✕ core-agent-instructions cross-agent instruction drift: CLAUDE.md != AGENTS.md"],
      ["dim", "                       expected: CLAUDE.md sha256:2e8a0bb9"],
      ["dim", "                       actual:   AGENTS.md sha256:46e14eee"],
      ["bold", "MCP Servers"],
      ["err", "  ✕ github             version drift & unpinned config"],
      ["dim", "                       expected: 1.4.7 (pinned)"],
      ["dim", "                       actual:   unversioned in .cursor/mcp.json (cached: 1.6.1)"],
      ["bold", "Security & Permissions"],
      ["err", "  ✕ github             unexpected permission: repository:delete"],
      ["warn", "  ⚠ user-scope         1 unapproved global MCP detected in ~/.cursor/mcp.json"],
      ["dim", RULE],
      ["err", "Status: FAILED (3 errors, 1 warning) in 225ms"],
      ["bold", "💡 Quick Remediation:"],
      ["plain", "  • Auto-pin & sync configs:    npx harnesslock sync --pin"],
    ],
  },
  sync: {
    title: "sync --pin",
    caption: "One command repairs everything that belongs to the repository. The personal MCP is reported, never touched.",
    lines: [
      ["cmd", "$ npx harnesslock sync --pin"],
      ["brand", "🔧 HarnessLock Sync — Aligning local configs to harnesslock.lock"],
      ["ok", "  ✓ Updated .cursor/mcp.json: pinned @modelcontextprotocol/server-github to 1.4.7"],
      ["ok", "  ✓ Updated .cursor/mcp.json: removed unauthorized permission 'repository:delete'"],
      ["ok", "  ✓ Synced AGENTS.md <- CLAUDE.md (core-agent-instructions)"],
      ["plain", ""],
      ["plain", "✨ Local agent configuration is now 100% synced with harnesslock.lock!"],
      ["dim", "   (1 warning remains — see `harnesslock verify`)"],
    ],
  },
};

type SceneKey = keyof typeof SCENES;
const ORDER: SceneKey[] = ["clean", "drift", "sync"];

export function TerminalDemo() {
  const [scene, setScene] = useState<SceneKey>("drift");
  const [visible, setVisible] = useState(0);
  const current = SCENES[scene]!;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(current.lines.length);
      return;
    }
    setVisible(0);
    const id = window.setInterval(() => {
      setVisible((v) => {
        if (v >= current.lines.length) {
          window.clearInterval(id);
          return v;
        }
        return v + 1;
      });
    }, 70);
    return () => window.clearInterval(id);
  }, [scene, current.lines.length]);

  return (
    <section className="border-t border-line py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="See it in action" title="Drift in, drift out — in one command">
          Real output from the CLI. Pick a scene.
        </SectionHeading>

        <div className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-2xl border border-line bg-[#0b0e14] shadow-2xl shadow-emerald-500/5">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-red-500/70" />
            <span className="h-3 w-3 rounded-full bg-amber-500/70" />
            <span className="h-3 w-3 rounded-full bg-emerald-500/70" />
            <div role="tablist" aria-label="Terminal scenes" className="ml-4 flex gap-1">
              {ORDER.map((key) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={scene === key}
                  onClick={() => setScene(key)}
                  className={`rounded-md px-3 py-1 font-mono text-xs transition ${
                    scene === key ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {SCENES[key]!.title}
                </button>
              ))}
            </div>
          </div>
          <pre className="min-h-[430px] overflow-x-auto p-5 font-mono text-[12.5px] leading-6">
            {current.lines.slice(0, visible).map(([tone, text], index) => (
              <div key={`${scene}-${index}`} className={`${TONE[tone]} animate-fade-up`}>
                {text || " "}
              </div>
            ))}
          </pre>
          <p className="border-t border-line px-5 py-3 text-sm text-slate-400">{current.caption}</p>
        </div>
      </div>
    </section>
  );
}
