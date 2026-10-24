import { ArrowRight } from "lucide-react";
import { SITE } from "@/lib/site";
import { GitHubIcon } from "./ui";

const LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#explorer", label: "Explorer" },
  { href: "#features", label: "Features" },
  { href: "#compare", label: "Compare" },
  { href: "#trust", label: "Trust" },
];

export function Nav() {
  return (
    <>
      <a
        href={SITE.repo}
        className="flex items-center justify-center gap-2 border-b border-line bg-emerald-500/10 px-4 py-2 text-center text-xs text-emerald-200 transition hover:bg-emerald-500/15"
      >
        <span className="rounded-full border border-emerald-400/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider">v{SITE.version}</span>
        Static MCP version resolution for npx, uvx and docker
        <ArrowRight className="h-3 w-3" />
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-ink/80 backdrop-blur-md">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="#" className="flex items-center gap-2 font-semibold text-white">
            <span aria-hidden="true">🔒</span> HarnessLock
          </a>
          <div className="hidden items-center gap-6 text-sm text-slate-400 md:flex">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href} className="transition hover:text-white">
                {link.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={SITE.repo}
              className="hidden items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white sm:flex"
            >
              <GitHubIcon /> GitHub
            </a>
            <a
              href="#get-started"
              className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-sm font-medium text-ink transition hover:bg-emerald-400"
            >
              Get started
            </a>
          </div>
        </nav>
      </header>
    </>
  );
}
