"use client";

import { ArrowRight, BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { SETUP_PROMPT, SITE } from "@/lib/site";
import { CommandSnippet, CopyButton } from "./CopyButton";

const LINES = ["The lockfile", "for AI coding", "agents."];
const TOTAL = LINES.reduce((sum, line) => sum + line.length, 0);

const WORKS_WITH = ["Claude Code", "OpenAI Codex", "Cursor", "MCP", "GitHub Actions", "git hooks"];

const FACTS = [
  { value: "0", label: "processes spawned to inspect configs" },
  { value: "0", label: "secret values stored in the lockfile" },
  { value: "0", label: "LLM calls — fully deterministic" },
  { value: "3", label: "agents verified with one lockfile" },
];

function useTyped(total: number, speed = 45): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCount(total);
      return;
    }
    const id = window.setInterval(() => {
      setCount((c) => {
        if (c >= total) {
          window.clearInterval(id);
          return c;
        }
        return c + 1;
      });
    }, speed);
    return () => window.clearInterval(id);
  }, [total, speed]);
  return count;
}

export function Hero() {
  const typed = useTyped(TOTAL);
  let remaining = typed;

  return (
    <section className="relative overflow-hidden">
      <div aria-hidden="true" className="bg-grid absolute inset-0" />
      <div
        aria-hidden="true"
        className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(16_185_129/0.22),transparent)]"
      />
      <div
        aria-hidden="true"
        className="absolute -top-20 right-[-200px] h-[420px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgb(99_102_241/0.18),transparent)]"
      />

      <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
        <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-white/5 px-3 py-1 text-xs text-slate-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Open source · Apache-2.0 · Claude Code, Codex & Cursor
        </p>

        <h1 className="sr-only">{LINES.join(" ")}</h1>
        <div aria-hidden="true" className="space-y-2 font-mono text-4xl font-semibold leading-tight tracking-tight text-white sm:text-6xl">
          {LINES.map((line, index) => {
            const shown = Math.max(0, Math.min(line.length, remaining));
            remaining -= line.length;
            const typing = shown < line.length && (shown > 0 || index === 0);
            const isLastFinished = index === LINES.length - 1 && typed >= TOTAL;
            // The untyped remainder is rendered invisibly so every line keeps its final size (no layout shift).
            return (
              <div key={line}>
                <span
                  className={`inline-block px-3 py-1 transition-colors ${shown > 0 ? "bg-black/70 ring-1 ring-white/10" : ""}`}
                >
                  <span className={typing || isLastFinished ? "caret" : ""}>{line.slice(0, shown)}</span>
                  <span className="invisible">{line.slice(shown)}</span>
                </span>
              </div>
            );
          })}
        </div>

        <p className="mt-8 max-w-2xl text-lg leading-8 text-slate-300">
          Your team shares one commit and one <code className="font-mono text-emerald-300">package-lock.json</code> — but every
          agent runs different MCP versions, instructions and permissions. HarnessLock locks them in{" "}
          <code className="font-mono text-emerald-300">harnesslock.lock</code> and catches drift on every machine and every pull request.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href="#get-started"
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-ink transition hover:bg-emerald-400"
          >
            Get started <ArrowRight className="h-4 w-4" />
          </a>
          <a
            href={SITE.docs}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            <BookOpen className="h-4 w-4" /> Read the docs
          </a>
        </div>

        <div className="mt-6 flex max-w-xl flex-col gap-3 sm:flex-row sm:items-center">
          <CommandSnippet command={SITE.install} className="flex-1" />
          <CopyButton
            text={SETUP_PROMPT}
            label="Copy setup prompt for your coding agent"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-line px-4 py-3 font-mono text-xs uppercase tracking-wider text-slate-300 transition hover:bg-white/5 hover:text-white"
          >
            Copy setup prompt
          </CopyButton>
        </div>
        <p className="mt-2 text-xs text-slate-500">Paste the setup prompt into Claude Code, Codex or Cursor and let your agent wire it up.</p>

        <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-400">
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">Works with</span>
          {WORKS_WITH.map((name) => (
            <span key={name} className="rounded-md border border-line bg-white/[0.03] px-2.5 py-1">
              {name}
            </span>
          ))}
        </div>

        <dl className="mt-14 grid grid-cols-2 gap-6 border-t border-line pt-8 sm:grid-cols-4">
          {FACTS.map((fact) => (
            <div key={fact.label}>
              <dt className="sr-only">{fact.label}</dt>
              <dd className="font-mono text-4xl font-semibold text-white">{fact.value}</dd>
              <dd className="mt-1 text-sm text-slate-400">{fact.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
