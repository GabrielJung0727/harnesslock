# HarnessLock website

Landing page for HarnessLock, built with Next.js (App Router), Tailwind CSS v4 and
`react-force-graph-2d`. It is exported as a fully static site (`output: "export"`).

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # writes the static site to out/
npm run typecheck
```

To host under a sub-path (e.g. GitHub Pages at `/harnesslock`), build with `SITE_BASE_PATH=/harnesslock`.

| Path | Contents |
| --- | --- |
| `app/` | layout, global styles, the single page |
| `components/` | page sections; `GraphExplorer` + `ForceGraphCanvas` render the lockfile graph |
| `lib/site.ts` | links, version, the "copy setup prompt" text |
| `lib/graph-data.ts` | nodes/edges and drift states shown in the explorer |

The terminal output on the page is real CLI output; keep it in sync with the CLI when output formats change.
