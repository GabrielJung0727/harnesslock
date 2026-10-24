import { Ban, EyeOff, FileDiff, GitPullRequest, KeyRound, RefreshCw } from "lucide-react";
import { Card, SectionHeading } from "./ui";

function Static() {
  return (
    <Card className="md:col-span-2">
      <Ban className="h-5 w-5 text-emerald-400" />
      <h3 className="mt-4 text-lg font-semibold text-white">Static by construction</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">
        Launch commands are parsed, never run. A config with <code className="font-mono text-slate-200">curl … | sh</code> can&apos;t execute
        during a scan. Versions of unpinned packages are read from <code className="font-mono text-slate-200">node_modules</code>, lockfiles
        and the npx, uv and pipx caches.
      </p>
      <div className="mt-5 grid gap-2 font-mono text-xs sm:grid-cols-2">
        {[
          ["npx -y @modelcontextprotocol/server-github", "unpinned · cached 1.6.1"],
          ["uvx mcp-server-git==0.6.2", "pinned · 0.6.2"],
          ["docker run mcp/postgres:latest", "unpinned · :latest"],
          ["cmd /c npx -y pkg@1.4.7", "pinned · 1.4.7"],
        ].map(([cmd, verdict]) => (
          <div key={cmd} className="rounded-lg border border-line bg-black/40 px-3 py-2">
            <div className="truncate text-slate-200">{cmd}</div>
            <div className={verdict.startsWith("pinned") ? "text-emerald-400" : "text-amber-400"}>→ {verdict}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Secrets() {
  return (
    <Card>
      <KeyRound className="h-5 w-5 text-emerald-400" />
      <h3 className="mt-4 text-lg font-semibold text-white">Zero secrets</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">Values are never stored, not even hashed. Rotating a token causes no drift.</p>
      <pre className="mt-5 rounded-lg border border-line bg-black/40 p-3 font-mono text-xs leading-5 text-slate-300">
        {"requiredEnv:\n  GITHUB_TOKEN:\n    required: true\n    "}
        <span className="text-emerald-400">value: excluded</span>
      </pre>
    </Card>
  );
}

function CrossSync() {
  return (
    <Card>
      <FileDiff className="h-5 w-5 text-emerald-400" />
      <h3 className="mt-4 text-lg font-semibold text-white">Cross-agent instructions</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">
        Claude reads <code className="font-mono text-slate-200">CLAUDE.md</code>; Codex and Cursor read{" "}
        <code className="font-mono text-slate-200">AGENTS.md</code>. Edit freely — just keep them in sync.
      </p>
      <div className="mt-5 space-y-1.5 font-mono text-xs">
        <div className="flex justify-between rounded-md bg-black/40 px-3 py-1.5">
          <span>CLAUDE.md</span>
          <span className="text-slate-500">73fa2b11</span>
        </div>
        <div className="flex justify-between rounded-md bg-black/40 px-3 py-1.5">
          <span>AGENTS.md</span>
          <span className="text-slate-500">73fa2b11</span>
        </div>
        <div className="text-center text-emerald-400">== synced</div>
      </div>
    </Card>
  );
}

function Shadowing() {
  return (
    <Card>
      <EyeOff className="h-5 w-5 text-emerald-400" />
      <h3 className="mt-4 text-lg font-semibold text-white">Shadowing, privately</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">
        Personal MCP servers in <code className="font-mono text-slate-200">~/.cursor</code> or <code className="font-mono text-slate-200">~/.claude</code>{" "}
        are counted, not exposed. Names appear only with <code className="font-mono text-slate-200">--include-user</code>.
      </p>
      <p className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 font-mono text-xs text-amber-300">
        ⚠ 1 unapproved global MCP detected in ~/.cursor/mcp.json
      </p>
    </Card>
  );
}

function PullRequests() {
  return (
    <Card>
      <GitPullRequest className="h-5 w-5 text-emerald-400" />
      <h3 className="mt-4 text-lg font-semibold text-white">Native to pull requests</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">
        <code className="font-mono text-slate-200">verify --ci</code> emits SARIF for GitHub Code Scanning and markdown for job summaries. Git hooks
        warn after every pull.
      </p>
      <div className="mt-5 flex flex-wrap gap-2 font-mono text-xs">
        {["--format sarif", "--format markdown", "--format json", "install-hooks"].map((flag) => (
          <span key={flag} className="rounded-md border border-line bg-black/40 px-2 py-1 text-slate-300">
            {flag}
          </span>
        ))}
      </div>
    </Card>
  );
}

function Remediation() {
  return (
    <Card className="grid gap-5 md:col-span-3 md:grid-cols-2 md:items-center">
      <div>
      <RefreshCw className="h-5 w-5 text-emerald-400" />
      <h3 className="mt-4 text-lg font-semibold text-white">One-command remediation</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">
        <code className="font-mono text-slate-200">sync --pin</code> pins floating versions, removes permissions outside policy and re-syncs
        instruction files. JSON keeps its indentation and line endings; Codex TOML is edited in place, comments included.
      </p>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-line bg-black/40 p-3 font-mono text-xs leading-5">
        <span className="text-red-400">{'-  "args": ["-y", "@modelcontextprotocol/server-github"]'}</span>
        {"\n"}
        <span className="text-emerald-400">{'+  "args": ["-y", "@modelcontextprotocol/server-github@1.4.7"]'}</span>
        {"\n"}
        <span className="text-red-400">{'-  "permissions": ["repo:read", "repository:delete"]'}</span>
        {"\n"}
        <span className="text-emerald-400">{'+  "permissions": ["repo:read"]'}</span>
      </pre>
    </Card>
  );
}

export function Features() {
  return (
    <section id="features" className="scroll-mt-20 border-t border-line py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="Features" title="Know exactly what your agents run.">
          Lock MCP servers, skills, hooks, rules, permissions and instructions across Claude Code, Codex and Cursor — without running any of them.
        </SectionHeading>
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          <Static />
          <Secrets />
          <CrossSync />
          <Shadowing />
          <PullRequests />
          <Remediation />
        </div>
      </div>
    </section>
  );
}
