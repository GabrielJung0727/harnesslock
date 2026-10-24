"use client";

import dynamic from "next/dynamic";
import { CircleAlert, Search, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import { GRAPH, GROUP_META, type GraphLink, type GraphNode, type NodeGroup } from "@/lib/graph-data";
import { SectionHeading } from "./ui";

// Canvas-based library: disable SSR.
const ForceGraph2D = dynamic(() => import("./ForceGraphCanvas"), { ssr: false });

type SimNode = GraphNode & { x?: number; y?: number };
type SimLink = Omit<GraphLink, "source" | "target"> & { source: string | SimNode; target: string | SimNode };

/** Leaves room for the HUD, status strip and legend overlays. */
const FIT_PADDING = 90;
/** Below this zoom the fixed-size labels collide; small screens pan instead of shrinking further. */
const MIN_ZOOM = 0.85;

const endId = (end: string | SimNode): string => (typeof end === "object" ? end.id : end);

export function GraphExplorer() {
  // ForceGraph mutates node/link objects, so hand it its own copy.
  const data = useMemo(
    () => ({ nodes: GRAPH.nodes.map((n) => ({ ...n })), links: GRAPH.links.map((l) => ({ ...l })) }),
    [],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 520 });
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [query, setQuery] = useState("");
  const [drift, setDrift] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of GRAPH.links) {
      if (!map.has(link.source)) map.set(link.source, new Set());
      if (!map.has(link.target)) map.set(link.target, new Set());
      map.get(link.source)!.add(link.target);
      map.get(link.target)!.add(link.source);
    }
    return map;
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(GRAPH.nodes.filter((n) => `${n.label} ${n.id} ${n.source}`.toLowerCase().includes(q)).map((n) => n.id));
  }, [query]);

  const isHighlighted = useCallback(
    (nodeId: string) => {
      if (matches) return matches.has(nodeId);
      if (!hoverNode) return true;
      return hoverNode === nodeId || (neighbors.get(hoverNode)?.has(nodeId) ?? false);
    },
    [hoverNode, neighbors, matches],
  );

  const focus = useCallback((node: SimNode) => {
    setSelected(GRAPH.nodes.find((n) => n.id === node.id) ?? null);
    if (node.x !== undefined && node.y !== undefined) {
      fgRef.current?.centerAt(node.x, node.y, 600);
      fgRef.current?.zoom(1.8, 600);
    }
  }, []);

  const fitGraph = useCallback((ms: number) => {
    const graph = fgRef.current;
    const el = containerRef.current;
    const box = graph?.getGraphBbox();
    if (!graph || !el || !box) return;
    const pad = el.clientWidth < 640 ? 24 : FIT_PADDING;
    const spanX = Math.max(box.x[1] - box.x[0], 1);
    const spanY = Math.max(box.y[1] - box.y[0], 1);
    const fit = Math.min((el.clientWidth - pad * 2) / spanX, (el.clientHeight - pad * 2) / spanY);
    graph.centerAt((box.x[0] + box.x[1]) / 2, (box.y[0] + box.y[1]) / 2, ms);
    graph.zoom(Math.min(Math.max(fit, MIN_ZOOM), 2.5), ms);
  }, []);

  const resetView = useCallback(() => {
    setSelected(null);
    fitGraph(500);
  }, [fitGraph]);

  function onSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    const first = matches && data.nodes.find((n) => matches.has(n.id));
    if (first) focus(first as SimNode);
  }

  const driftNodes = GRAPH.nodes.filter((n) => n.drift);
  const errors = driftNodes.filter((n) => n.drift?.severity === "error").length;
  const warnings = driftNodes.length - errors;

  return (
    <section id="explorer" className="scroll-mt-20 border-t border-line py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading eyebrow="Lockfile explorer" title="See what your agents actually load">
          Every node is a component recorded in <code className="font-mono text-slate-200">harnesslock.lock</code>. Hover to trace connections,
          click for details, and flip the switch to see what <code className="font-mono text-slate-200">verify</code> flags.
        </SectionHeading>

        <div
          ref={containerRef}
          className="relative mt-12 h-[560px] overflow-hidden rounded-2xl border border-line bg-[#090B10]"
        >
          {/* Search & drift toggle HUD */}
          <div className="absolute left-4 top-4 z-10 flex flex-col gap-2 sm:flex-row">
            <form
              onSubmit={onSearchSubmit}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#121620]/80 px-4 py-2.5 shadow-2xl backdrop-blur-md"
            >
              <Search className="h-4 w-4 text-slate-400" />
              <label htmlFor="graph-search" className="sr-only">
                Search nodes
              </label>
              <input
                id="graph-search"
                type="text"
                placeholder="Search MCP, skill, file…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-48 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
              />
            </form>
            <button
              type="button"
              onClick={() => setDrift((d) => !d)}
              aria-pressed={drift}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm shadow-2xl backdrop-blur-md transition ${
                drift ? "border-red-500/40 bg-red-500/15 text-red-200" : "border-white/10 bg-[#121620]/80 text-slate-300 hover:text-white"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${drift ? "bg-red-400" : "bg-emerald-400"}`} />
              {drift ? "Drift simulated" : "Simulate drift"}
            </button>
          </div>

          {/* Status strip */}
          <div className="absolute bottom-4 left-4 z-10 rounded-xl border border-white/10 bg-[#121620]/80 px-4 py-2.5 font-mono text-xs backdrop-blur-md">
            {drift ? (
              <span className="text-red-300">
                Status: FAILED ({errors} errors, {warnings} warning)
              </span>
            ) : (
              <span className="text-emerald-300">Status: PASSED (0 errors, 0 warnings)</span>
            )}
          </div>

          {/* Legend */}
          <ul className="absolute bottom-4 right-4 z-10 hidden flex-wrap justify-end gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-[#121620]/80 px-4 py-2.5 text-xs text-slate-400 backdrop-blur-md lg:flex lg:max-w-md">
            {(Object.keys(GROUP_META) as NodeGroup[]).map((group) => (
              <li key={group} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: GROUP_META[group].color }} />
                {GROUP_META[group].label}
              </li>
            ))}
          </ul>

          {/* Detail panel */}
          {selected && (
            <div className="absolute right-4 top-4 z-10 w-[min(20rem,calc(100%-2rem))] rounded-2xl border border-white/10 bg-[#121620]/90 p-5 shadow-2xl backdrop-blur-xl">
              <div className="mb-3 flex items-center justify-between">
                <span
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs uppercase tracking-wider"
                  style={{ color: GROUP_META[selected.group].color }}
                >
                  {GROUP_META[selected.group].label}
                </span>
                <button type="button" onClick={resetView} aria-label="Close details" className="text-slate-400 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <h3 className="mb-1 break-words font-mono text-base font-semibold text-white">{selected.label}</h3>
              <p className="mb-4 break-words text-xs text-slate-400">{selected.source}</p>
              <div className="space-y-2 border-t border-white/10 pt-3 text-xs text-slate-300">
                <p>
                  <span className="text-slate-500">Locked: </span>
                  {selected.locked}
                </p>
                <p>
                  <span className="text-slate-500">Connected components: </span>
                  {neighbors.get(selected.id)?.size ?? 0}
                </p>
              </div>
              <div className="mt-3 border-t border-white/10 pt-3 text-xs">
                {drift && selected.drift ? (
                  <div className={selected.drift.severity === "error" ? "text-red-300" : "text-amber-300"}>
                    <p className="mb-1 flex items-center gap-1.5 font-mono font-semibold">
                      {selected.drift.severity === "error" ? <CircleAlert className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />}
                      {selected.drift.code}
                    </p>
                    <p className="leading-5">{selected.drift.message}</p>
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 text-emerald-300">
                    <ShieldCheck className="h-3.5 w-3.5" /> Matches harnesslock.lock
                  </p>
                )}
              </div>
            </div>
          )}

          {size.width > 0 && (
            <ForceGraph2D
              graphRef={fgRef}
              width={size.width}
              height={size.height}
              graphData={data}
              backgroundColor="#090B10"
              cooldownTicks={120}
              // Wheel zoom would hijack page scrolling; nodes can still be dragged and the canvas panned.
              enableZoomInteraction={false}
              // Hover, search and drift styling change after the simulation stops, so keep repainting.
              autoPauseRedraw={false}
              d3AlphaDecay={0.03}
              d3VelocityDecay={0.4}
              onEngineStop={() => fitGraph(400)}
              onNodeHover={(node) => setHoverNode(node ? String((node as SimNode).id) : null)}
              onNodeClick={(node) => focus(node as SimNode)}
              onBackgroundClick={resetView}
              linkColor={(link) => {
                const l = link as SimLink;
                if (drift && l.drifts) return "rgba(239, 68, 68, 0.75)";
                return "rgba(255, 255, 255, 0.14)";
              }}
              linkLineDash={(link) => (drift && (link as SimLink).drifts ? [4, 3] : null)}
              linkWidth={(link) => {
                const l = link as SimLink;
                const s = endId(l.source);
                const t = endId(l.target);
                if (hoverNode && (s === hoverNode || t === hoverNode)) return 2.5;
                return drift && l.drifts ? 1.8 : 1;
              }}
              nodeCanvasObject={(raw, ctx, globalScale) => {
                const node = raw as SimNode;
                if (node.x === undefined || node.y === undefined) return;
                const active = isHighlighted(node.id);
                const flagged = drift && node.drift;
                const color = GROUP_META[node.group].color;
                const radius = Math.sqrt(node.val) * 1.8;

                ctx.save();
                ctx.globalAlpha = active ? 1 : 0.15;

                if (hoverNode === node.id || selected?.id === node.id || flagged) {
                  ctx.shadowColor = flagged ? (node.drift?.severity === "error" ? "#ef4444" : "#f59e0b") : color;
                  ctx.shadowBlur = 18;
                }

                ctx.beginPath();
                ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
                ctx.fillStyle = color;
                ctx.fill();

                if (flagged) {
                  ctx.shadowBlur = 0;
                  ctx.lineWidth = 2 / globalScale + 1;
                  ctx.strokeStyle = node.drift?.severity === "error" ? "#ef4444" : "#f59e0b";
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, radius + 3, 0, 2 * Math.PI, false);
                  ctx.stroke();
                }

                const fontSize = 12 / globalScale;
                ctx.shadowBlur = 0;
                ctx.font = `500 ${fontSize}px Inter, sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillStyle = active ? "#E2E8F0" : "#475569";
                ctx.fillText(node.label, node.x, node.y + radius + 4 / globalScale);

                ctx.restore();
              }}
              nodePointerAreaPaint={(raw, color, ctx) => {
                const node = raw as SimNode;
                if (node.x === undefined || node.y === undefined) return;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x, node.y, Math.sqrt(node.val) * 1.8 + 4, 0, 2 * Math.PI, false);
                ctx.fill();
              }}
            />
          )}
        </div>
        <p className="mt-3 text-center text-xs text-slate-500">Example data from the README&apos;s sample repository · drag to pan, click a node for details.</p>
      </div>
    </section>
  );
}
