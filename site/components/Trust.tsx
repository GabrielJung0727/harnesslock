import { Cpu, Fingerprint, HardDrive, Scale } from "lucide-react";
import { SITE } from "@/lib/site";
import { Card, SectionHeading } from "./ui";

const ITEMS = [
  {
    icon: Cpu,
    title: "Nothing executed",
    body: "MCP servers and hook scripts are parsed, never started. The only process it can launch is <agent> --version — and only with --check-binaries.",
  },
  {
    icon: HardDrive,
    title: "No network, no telemetry",
    body: "Everything runs locally. No usage pings, no crash reports, no LLM calls. Same input, same bytes out.",
  },
  {
    icon: Fingerprint,
    title: "Secrets stay yours",
    body: "Token values are excluded from the lockfile, reports and fingerprints. User-scope configs are only counted.",
  },
  {
    icon: Scale,
    title: "Apache 2.0",
    body: "The whole source is open. You don't have to trust this page — read what the code does.",
  },
];

export function Trust() {
  return (
    <section id="trust" className="scroll-mt-20 border-t border-line py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="Trust" title="Safe to run on any repository.">
          A tool that inspects agent configs must never become the attack surface itself.
        </SectionHeading>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map(({ icon: Icon, title, body }) => (
            <Card key={title}>
              <Icon className="h-5 w-5 text-emerald-400" />
              <h3 className="mt-4 font-semibold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
            </Card>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-slate-500">
          <a href={SITE.repo} className="underline decoration-slate-600 underline-offset-4 hover:text-slate-300">
            Browse the source on GitHub
          </a>
        </p>
      </div>
    </section>
  );
}
