"use client";

import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

export function CopyButton({
  text,
  label,
  className = "",
  children,
}: {
  text: string;
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be unavailable (insecure context, denied permission); the text stays selectable.
    }
  }

  return (
    <button type="button" onClick={copy} aria-label={label} className={className}>
      {children}
      {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

/** A `$ command` line with a copy button. */
export function CommandSnippet({ command, className = "" }: { command: string; className?: string }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border border-line bg-black/40 px-4 py-3 font-mono text-sm ${className}`}>
      <span className="select-none text-emerald-400">$</span>
      <code className="flex-1 overflow-x-auto whitespace-nowrap text-slate-100">{command}</code>
      <CopyButton text={command} label={`Copy ${command}`} className="text-slate-400 transition hover:text-white" />
    </div>
  );
}
