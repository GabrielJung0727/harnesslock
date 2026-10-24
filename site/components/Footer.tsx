import { SITE } from "@/lib/site";
import { GitHubIcon } from "./ui";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "Explorer", href: "#explorer" },
      { label: "Features", href: "#features" },
      { label: "Compare", href: "#compare" },
    ],
  },
  {
    title: "Docs",
    links: [
      { label: "README", href: SITE.docs },
      { label: "Configuration", href: `${SITE.repo}#configuration` },
      { label: "CI & integrations", href: `${SITE.repo}#ci-and-integrations` },
      { label: "Troubleshooting", href: `${SITE.repo}#troubleshooting` },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "GitHub", href: SITE.repo },
      { label: "npm", href: SITE.npm },
      { label: "License (Apache-2.0)", href: `${SITE.repo}/blob/main/LICENSE` },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-4">
        <div>
          <p className="flex items-center gap-2 font-semibold text-white">
            <span aria-hidden="true">🔒</span> HarnessLock
          </p>
          <p className="mt-3 text-sm text-slate-400">Reproducible configuration for AI coding agents.</p>
          <a href={SITE.repo} aria-label="HarnessLock on GitHub" className="mt-4 inline-flex text-slate-400 hover:text-white">
            <GitHubIcon className="h-5 w-5" />
          </a>
        </div>
        {COLUMNS.map((column) => (
          <div key={column.title}>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">{column.title}</p>
            <ul className="mt-4 space-y-2 text-sm">
              {column.links.map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="text-slate-400 transition hover:text-white">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line py-6 text-center text-xs text-slate-500">
        HarnessLock v{SITE.version} · Apache-2.0 · Claude Code, Codex and Cursor are trademarks of their respective owners.
      </div>
    </footer>
  );
}
