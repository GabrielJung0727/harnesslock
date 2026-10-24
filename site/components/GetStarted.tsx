import { ArrowRight } from "lucide-react";
import { SITE } from "@/lib/site";
import { CommandSnippet } from "./CopyButton";
import { GitHubIcon } from "./ui";

const ACTION_YAML = `- uses: actions/checkout@v4
- uses: GabrielJung0727/harnesslock/integrations/github-action@v0.1.0`;

export function GetStarted() {
  return (
    <section id="get-started" className="scroll-mt-20 border-t border-line py-24">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-400">Try it on your own repo</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Three commands. No install.</h2>
          <p className="mt-4 text-slate-400">
            Node.js 20+ is all you need. <code className="font-mono text-slate-200">init</code> reads what&apos;s already committed and writes a
            starting policy; nothing leaves your machine.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={SITE.docs}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-ink transition hover:bg-emerald-400"
            >
              Read the docs <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href={SITE.repo}
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              <GitHubIcon /> Star on GitHub
            </a>
          </div>
        </div>
        <div className="space-y-3">
          <CommandSnippet command="npx harnesslock init" />
          <CommandSnippet command="npx harnesslock lock" />
          <CommandSnippet command="npx harnesslock verify" />
          <div className="rounded-xl border border-line bg-black/40 p-4">
            <p className="mb-2 font-mono text-xs uppercase tracking-wider text-slate-500">.github/workflows/harnesslock.yml</p>
            <pre className="overflow-x-auto font-mono text-xs leading-5 text-slate-300">{ACTION_YAML}</pre>
          </div>
        </div>
      </div>
    </section>
  );
}
