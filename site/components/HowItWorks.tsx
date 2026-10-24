import { FileCode, FileLock, ShieldCheck } from "lucide-react";
import { Card, SectionHeading } from "./ui";

const STEPS = [
  {
    icon: FileCode,
    step: "01 · Declare",
    title: "harnesslock.yaml",
    body: "Say what your agents may load: MCP servers and version ranges, required skills and hooks, permission allow/deny lists, and which instruction files must stay in sync.",
    code: "npx harnesslock init",
  },
  {
    icon: FileLock,
    step: "02 · Lock",
    title: "harnesslock.lock",
    body: "Resolve the exact state statically — pinned versions, cached versions of unpinned packages, SHA-256 fingerprints of every config, skill and hook. Secrets are excluded.",
    code: "npx harnesslock lock",
  },
  {
    icon: ShieldCheck,
    step: "03 · Verify",
    title: "Every machine, every PR",
    body: "Compare any workspace against the lock in milliseconds. Git hooks warn after a pull, CI fails the pull request with SARIF annotations, and sync fixes drift in one command.",
    code: "npx harnesslock verify",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20 border-t border-line py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="How it works" title="One lockfile for every agent on the team">
          The same idea as <code className="font-mono text-slate-200">package-lock.json</code>, applied to the configuration that shapes
          what your coding agents can see and do.
        </SectionHeading>
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, step, title, body, code }) => (
            <Card key={step} className="flex flex-col">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="font-mono text-xs uppercase tracking-wider text-slate-400">{step}</span>
              </div>
              <h3 className="mt-5 font-mono text-lg font-semibold text-white">{title}</h3>
              <p className="mt-2 flex-1 text-sm leading-6 text-slate-400">{body}</p>
              <code className="mt-5 block rounded-lg border border-line bg-black/40 px-3 py-2 font-mono text-xs text-emerald-300">$ {code}</code>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
