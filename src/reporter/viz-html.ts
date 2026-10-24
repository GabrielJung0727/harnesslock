import type { VizGraph } from "../core/viz-model.js";

/**
 * Renders the `harnesslock viz` graph as ONE self-contained HTML file: no CDN, no network, no
 * external fonts. Config-derived strings are untrusted, so the data is embedded as JSON with every
 * `<` escaped (no `</script>` breakout) and the client only ever writes it via `textContent`.
 */

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
/** "\" + "u" — built at runtime so no tool or editor can collapse the escape sequence. */
const U = String.fromCharCode(92) + "u";

/** JSON safe to place inside a <script> element: no "</script>" breakout, no raw line separators. */
export function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, `${U}003c`)
    .replace(/>/g, `${U}003e`)
    .replace(/&/g, `${U}0026`)
    .split(LINE_SEPARATOR)
    .join(`${U}2028`)
    .split(PARAGRAPH_SEPARATOR)
    .join(`${U}2029`);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

const STYLE = `
:root {
  --ink: #090b10; --panel: rgba(18, 22, 32, 0.9); --line: rgba(255, 255, 255, 0.09);
  --text: #e2e8f0; --muted: #94a3b8; --dim: #64748b;
  --ok: #10b981; --warn: #f59e0b; --err: #ef4444;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--ink); color: var(--text); font-family: var(--sans); overflow: hidden; }
canvas { display: block; position: fixed; inset: 0; cursor: grab; }
canvas.dragging { cursor: grabbing; }
canvas.pointer { cursor: pointer; }
.hud { position: fixed; z-index: 2; background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: 0 20px 50px rgba(0,0,0,.45); }
header.hud { top: 16px; left: 16px; right: 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 10px 14px; }
.brand { font-weight: 600; white-space: nowrap; }
.brand small { color: var(--dim); font-weight: 400; margin-left: 6px; font-family: var(--mono); font-size: 11px; }
.status { font-family: var(--mono); font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); white-space: nowrap; }
.status.ok { color: var(--ok); border-color: rgba(16,185,129,.35); background: rgba(16,185,129,.08); }
.status.warn { color: var(--warn); border-color: rgba(245,158,11,.35); background: rgba(245,158,11,.08); }
.status.err { color: #fca5a5; border-color: rgba(239,68,68,.45); background: rgba(239,68,68,.1); }
.meta { color: var(--dim); font-size: 12px; font-family: var(--mono); }
.spacer { flex: 1; }
input[type=search] { background: rgba(0,0,0,.35); border: 1px solid var(--line); border-radius: 10px; color: var(--text);
  padding: 7px 10px; font-size: 13px; width: 210px; outline: none; }
input[type=search]:focus { border-color: rgba(16,185,129,.6); }
button { font: inherit; font-size: 13px; color: var(--text); background: rgba(255,255,255,.05); border: 1px solid var(--line);
  border-radius: 10px; padding: 6px 11px; cursor: pointer; }
button:hover { background: rgba(255,255,255,.1); }
#issues-only[aria-pressed=true] { border-color: rgba(239,68,68,.5); background: rgba(239,68,68,.14); color: #fecaca; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--ok); outline-offset: 2px; }
#legend { left: 16px; bottom: 16px; padding: 10px 12px; display: flex; flex-wrap: wrap; gap: 6px; max-width: min(560px, calc(100% - 32px)); }
#legend button { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; font-size: 12px; color: var(--muted); }
#legend button[aria-pressed=false] { opacity: .4; }
#legend i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
#issues { right: 16px; bottom: 16px; width: min(380px, calc(100% - 32px)); max-height: 38vh; overflow: auto; padding: 12px; }
#issues h2, #panel h2 { margin: 0 0 8px; font-size: 13px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .08em; }
#issues ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
#issues li button { width: 100%; text-align: left; display: grid; gap: 2px; padding: 8px 10px; }
#issues .code { font-family: var(--mono); font-size: 11px; }
#issues .msg { font-size: 12px; color: var(--text); }
.sev-error { color: #fca5a5; } .sev-warning { color: #fcd34d; } .sev-info { color: var(--muted); }
#panel { top: 84px; right: 16px; width: min(380px, calc(100% - 32px)); max-height: calc(100vh - 100px); overflow: auto; padding: 16px; display: none; }
#panel.open { display: block; }
body.detail-open #issues { display: none; }
#panel .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
#panel .chip { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line); }
#panel h3 { margin: 4px 0 12px; font-family: var(--mono); font-size: 15px; word-break: break-word; }
#panel dl { margin: 0; display: grid; gap: 8px; font-size: 12px; }
#panel dt { color: var(--dim); }
#panel dd { margin: 2px 0 0; white-space: pre-wrap; word-break: break-word; font-family: var(--mono); font-size: 12px; }
#panel .issue { margin-top: 12px; padding: 10px; border-radius: 10px; border: 1px solid var(--line); font-size: 12px; }
#panel .issue.error { border-color: rgba(239,68,68,.4); background: rgba(239,68,68,.08); }
#panel .issue.warning { border-color: rgba(245,158,11,.4); background: rgba(245,158,11,.08); }
#panel .issue p { margin: 4px 0 0; white-space: pre-wrap; word-break: break-word; }
#panel .issue .k { color: var(--dim); }
#panel .okline { margin-top: 12px; color: var(--ok); font-size: 12px; }
.note { position: fixed; top: 80px; left: 16px; z-index: 2; font-size: 12px; color: #fcd34d; background: rgba(245,158,11,.1);
  border: 1px solid rgba(245,158,11,.3); border-radius: 10px; padding: 8px 12px; max-width: 520px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 760px) { #issues { display: none; } #legend { bottom: 8px; left: 8px; } header.hud { left: 8px; right: 8px; top: 8px; } input[type=search] { width: 150px; } }
`;

/* The client script is plain ES2017 without template literals (it lives inside a TS template string). */
const SCRIPT = `
(function () {
  "use strict";
  var data = JSON.parse(document.getElementById("hl-data").textContent);
  var GROUPS = {
    lock: { label: "Lockfile", color: "#e2e8f0" },
    agent: { label: "Agent", color: "#6366f1" },
    instruction: { label: "Instruction", color: "#38bdf8" },
    mcp: { label: "MCP server", color: "#10b981" },
    permission: { label: "Permission", color: "#f472b6" },
    skill: { label: "Skill", color: "#f59e0b" },
    hook: { label: "Hook", color: "#fb923c" },
    rule: { label: "Rule", color: "#a3e635" },
    scope: { label: "User scope", color: "#a855f7" }
  };
  var STATUS_COLOR = { error: "#ef4444", warning: "#f59e0b" };
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var canvas = document.getElementById("graph");
  var ctx = canvas.getContext("2d");
  var dpr = 1, width = 0, height = 0;
  var view = { x: 0, y: 0, k: 1 };
  var hover = null, selected = null, query = "", issuesOnly = false;
  var hiddenGroups = {};

  // ---- model -------------------------------------------------------------------------------
  var nodes = data.nodes.map(function (n, i) {
    var angle = (i / data.nodes.length) * Math.PI * 2;
    var ring = n.group === "lock" ? 0 : n.group === "agent" ? 140 : 300;
    return Object.assign({}, n, { x: Math.cos(angle) * ring + (i % 7), y: Math.sin(angle) * ring + (i % 5), vx: 0, vy: 0, r: Math.sqrt(n.size) * 2.4 });
  });
  var byId = {};
  nodes.forEach(function (n) { byId[n.id] = n; });
  var links = data.links.filter(function (l) { return byId[l.source] && byId[l.target]; }).map(function (l) {
    return Object.assign({}, l, { s: byId[l.source], t: byId[l.target] });
  });
  var neighbors = {};
  nodes.forEach(function (n) { neighbors[n.id] = {}; });
  links.forEach(function (l) { neighbors[l.s.id][l.t.id] = true; neighbors[l.t.id][l.s.id] = true; });

  // ---- force simulation (small graphs: O(n^2) repulsion is fine) ---------------------------
  var alpha = 1;
  function tick() {
    if (alpha < 0.004) return false;
    var i, j, a, b, dx, dy, d2, d, f;
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      for (j = i + 1; j < nodes.length; j++) {
        b = nodes[j];
        dx = b.x - a.x; dy = b.y - a.y;
        d2 = dx * dx + dy * dy || 0.01;
        d = Math.sqrt(d2);
        f = (2400 * alpha) / d2;
        var min = a.r + b.r + 26;
        if (d < min) f += ((min - d) / d) * 0.5;
        dx *= f / d; dy *= f / d;
        a.vx -= dx; a.vy -= dy; b.vx += dx; b.vy += dy;
      }
    }
    links.forEach(function (l) {
      dx = l.t.x - l.s.x; dy = l.t.y - l.s.y;
      d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      var rest = 58 + l.s.r + l.t.r + (l.kind === "grants" ? -14 : 0);
      f = ((d - rest) / d) * 0.06 * alpha;
      dx *= f; dy *= f;
      l.s.vx += dx; l.s.vy += dy; l.t.vx -= dx; l.t.vy -= dy;
    });
    nodes.forEach(function (n) {
      n.vx -= n.x * 0.004 * alpha; n.vy -= n.y * 0.004 * alpha;
      if (n.fixed) { n.vx = 0; n.vy = 0; return; }
      n.vx *= 0.62; n.vy *= 0.62;
      n.x += n.vx; n.y += n.vy;
    });
    alpha *= 0.985;
    return true;
  }
  // Settle most of the layout before the first frame so the graph appears already arranged.
  for (var warm = 0; warm < 260; warm++) tick();

  // ---- view --------------------------------------------------------------------------------
  function resize() {
    dpr = window.devicePixelRatio || 1;
    width = window.innerWidth; height = window.innerHeight;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = width + "px"; canvas.style.height = height + "px";
  }
  function fit() {
    var visible = nodes.filter(isVisible);
    if (!visible.length) return;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    visible.forEach(function (n) {
      minX = Math.min(minX, n.x - n.r - 40); maxX = Math.max(maxX, n.x + n.r + 40);
      minY = Math.min(minY, n.y - n.r - 20); maxY = Math.max(maxY, n.y + n.r + 30);
    });
    // Keep the graph clear of the header, legend and (on wide screens) the findings panel.
    var top = 90, bottom = 80, left = width > 900 ? 40 : 12;
    var right = width > 760 ? Math.min(400, width * 0.38) : 12;
    var k = Math.min((width - left - right) / (maxX - minX), (height - top - bottom) / (maxY - minY));
    view.k = Math.max(0.35, Math.min(k, 1.8));
    view.x = left + (width - left - right) / 2 - ((minX + maxX) / 2) * view.k;
    view.y = top + (height - top - bottom) / 2 - ((minY + maxY) / 2) * view.k;
  }
  function toWorld(px, py) { return { x: (px - view.x) / view.k, y: (py - view.y) / view.k }; }

  // ---- filtering ---------------------------------------------------------------------------
  function matches(n) {
    if (!query) return true;
    var hay = (n.label + " " + n.id + " " + n.details.map(function (d) { return d[1]; }).join(" ")).toLowerCase();
    return hay.indexOf(query) !== -1;
  }
  function isVisible(n) { return !hiddenGroups[n.group]; }
  function isActive(n) {
    if (!isVisible(n)) return false;
    if (issuesOnly && n.issues.length === 0 && !hasIssueNeighbor(n)) return false;
    if (query) return matches(n);
    var focus = hover || selected;
    if (!focus) return true;
    return focus === n || neighbors[focus.id][n.id] === true;
  }
  function hasIssueNeighbor(n) {
    for (var id in neighbors[n.id]) if (byId[id].issues.length) return true;
    return false;
  }

  // ---- drawing -----------------------------------------------------------------------------
  function draw(time) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.k, view.k);

    links.forEach(function (l) {
      if (!isVisible(l.s) || !isVisible(l.t)) return;
      var active = isActive(l.s) && isActive(l.t);
      var bad = STATUS_COLOR[l.status];
      ctx.globalAlpha = active ? 1 : 0.08;
      ctx.strokeStyle = bad ? bad : l.kind === "sync" ? "rgba(56,189,248,0.55)" : "rgba(255,255,255,0.16)";
      ctx.lineWidth = (bad ? 1.8 : 1) / Math.sqrt(view.k);
      ctx.setLineDash(bad || l.kind === "sync" ? [5, 4] : []);
      ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y); ctx.stroke();
    });
    ctx.setLineDash([]);

    var pulse = reduceMotion ? 0.5 : (Math.sin(time / 320) + 1) / 2;
    nodes.forEach(function (n) {
      if (!isVisible(n)) return;
      var active = isActive(n);
      var color = GROUPS[n.group].color;
      var bad = STATUS_COLOR[n.status];
      ctx.globalAlpha = active ? (n.status === "skipped" ? 0.45 : 1) : 0.1;
      if (bad && active) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 5 + pulse * 7, 0, Math.PI * 2);
        ctx.fillStyle = bad; ctx.globalAlpha = 0.12 + (1 - pulse) * 0.18; ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (n === hover || n === selected) { ctx.shadowColor = bad || color; ctx.shadowBlur = 18; }
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      ctx.shadowBlur = 0;
      if (bad) { ctx.lineWidth = 2.2 / Math.sqrt(view.k); ctx.strokeStyle = bad; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2); ctx.stroke(); }
      if (n === selected) { ctx.lineWidth = 1.5 / view.k; ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 7, 0, Math.PI * 2); ctx.stroke(); }

      var fontSize = 12 / view.k;
      ctx.font = "500 " + fontSize + "px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillStyle = active ? (bad ? "#fecaca" : "#e2e8f0") : "#334155";
      var label = n.label.length > 42 ? n.label.slice(0, 40) + "…" : n.label;
      ctx.fillText(label, n.x, n.y + n.r + 5 / view.k);
    });
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  var userMoved = false;
  function frame(time) {
    var moving = tick();
    if (moving && !userMoved) fit();
    draw(time);
    requestAnimationFrame(frame);
  }

  // ---- interaction -------------------------------------------------------------------------
  function nodeAt(px, py) {
    var p = toWorld(px, py);
    for (var i = nodes.length - 1; i >= 0; i--) {
      var n = nodes[i];
      if (!isVisible(n)) continue;
      var dx = n.x - p.x, dy = n.y - p.y, r = n.r + 6 / view.k;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  }
  var drag = null;
  canvas.addEventListener("pointerdown", function (e) {
    canvas.setPointerCapture(e.pointerId);
    var n = nodeAt(e.clientX, e.clientY);
    drag = { node: n, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    if (n) n.fixed = true;
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!drag) {
      var n = nodeAt(e.clientX, e.clientY);
      if (n !== hover) { hover = n; canvas.classList.toggle("pointer", !!n); }
      return;
    }
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (!drag.moved) return;
    userMoved = true;
    if (drag.node) {
      var p = toWorld(e.clientX, e.clientY);
      drag.node.x = p.x; drag.node.y = p.y;
      alpha = Math.max(alpha, 0.25);
    } else {
      view.x = drag.vx + dx; view.y = drag.vy + dy;
    }
  });
  canvas.addEventListener("pointerup", function (e) {
    if (!drag) return;
    if (drag.node) drag.node.fixed = false;
    if (!drag.moved) select(nodeAt(e.clientX, e.clientY));
    drag = null;
    canvas.classList.remove("dragging");
  });
  canvas.addEventListener("pointerleave", function () { if (!drag) hover = null; });
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    userMoved = true;
    var factor = Math.exp(-e.deltaY * 0.0015);
    var k = Math.max(0.2, Math.min(4, view.k * factor));
    var p = toWorld(e.clientX, e.clientY);
    view.k = k;
    view.x = e.clientX - p.x * k; view.y = e.clientY - p.y * k;
  }, { passive: false });
  window.addEventListener("resize", function () { resize(); if (!userMoved) fit(); });

  function focusNode(n) {
    select(n);
    userMoved = true;
    view.k = Math.max(view.k, 1.2);
    view.x = width / 2 - n.x * view.k;
    view.y = height / 2 - n.y * view.k;
  }

  // ---- DOM (text only: values come from untrusted config files) ----------------------------
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) for (var key in attrs) node.setAttribute(key, attrs[key]);
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  var panel = document.getElementById("panel");
  function select(n) {
    selected = n;
    panel.textContent = "";
    // The detail panel takes the findings list's place on the right.
    document.body.classList.toggle("detail-open", !!n);
    if (!n) { panel.classList.remove("open"); return; }
    var top = el("div", { class: "top" });
    var chip = el("span", { class: "chip" }, GROUPS[n.group].label);
    chip.style.color = GROUPS[n.group].color;
    var close = el("button", { type: "button", "aria-label": "Close details" }, "✕");
    close.addEventListener("click", function () { select(null); });
    top.appendChild(chip); top.appendChild(close);
    panel.appendChild(top);
    panel.appendChild(el("h3", null, n.label));
    var dl = el("dl");
    n.details.forEach(function (d) {
      var row = el("div");
      row.appendChild(el("dt", null, d[0]));
      row.appendChild(el("dd", null, d[1]));
      dl.appendChild(row);
    });
    var linked = Object.keys(neighbors[n.id]).length;
    var row = el("div"); row.appendChild(el("dt", null, "Connected components")); row.appendChild(el("dd", null, linked)); dl.appendChild(row);
    panel.appendChild(dl);
    if (n.issues.length === 0) {
      panel.appendChild(el("p", { class: "okline" }, n.status === "skipped" ? "○ Skipped on this machine" : "✓ Matches harnesslock.lock"));
    }
    n.issues.forEach(function (issue) {
      var box = el("div", { class: "issue " + issue.severity });
      box.appendChild(el("strong", { class: "sev-" + issue.severity }, (issue.severity === "error" ? "✕ " : "⚠ ") + issue.code));
      box.appendChild(el("p", null, issue.message));
      [["expected", issue.expected], ["actual", issue.actual], ["fix", issue.remediation]].forEach(function (pair) {
        if (!pair[1]) return;
        var p = el("p");
        p.appendChild(el("span", { class: "k" }, pair[0] + ": "));
        p.appendChild(document.createTextNode(pair[1]));
        box.appendChild(p);
      });
      panel.appendChild(box);
    });
    panel.classList.add("open");
  }

  // Header
  var meta = data.meta;
  document.getElementById("project").textContent = meta.project;
  document.getElementById("generated").textContent = meta.mode + " · " + meta.generatedAt.replace("T", " ").slice(0, 16);
  var status = document.getElementById("status");
  if (meta.mode === "scan-only") { status.textContent = "scan only · no harnesslock.yaml"; status.className = "status warn"; }
  else if (meta.summary.errors > 0) { status.textContent = "FAILED · " + meta.summary.errors + " errors, " + meta.summary.warnings + " warnings"; status.className = "status err"; }
  else if (meta.summary.warnings > 0) { status.textContent = "PASSED · " + meta.summary.warnings + " warnings"; status.className = "status warn"; }
  else { status.textContent = "PASSED · 0 errors, 0 warnings"; status.className = "status ok"; }
  if (meta.note) { var note = el("div", { class: "note", role: "note" }, meta.note); document.body.appendChild(note); }

  // Search / toggles
  var search = document.getElementById("search");
  search.addEventListener("input", function () { query = search.value.trim().toLowerCase(); });
  search.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var hit = nodes.filter(function (n) { return isVisible(n) && matches(n); })[0];
    if (hit) focusNode(hit);
  });
  var issuesBtn = document.getElementById("issues-only");
  issuesBtn.addEventListener("click", function () {
    issuesOnly = !issuesOnly;
    issuesBtn.setAttribute("aria-pressed", String(issuesOnly));
  });
  document.getElementById("fit").addEventListener("click", function () { userMoved = false; fit(); });
  window.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== search) { e.preventDefault(); search.focus(); }
    if (e.key === "Escape") { select(null); search.blur(); }
  });

  // Legend (toggles groups)
  var legend = document.getElementById("legend");
  Object.keys(GROUPS).forEach(function (group) {
    if (!nodes.some(function (n) { return n.group === group; })) return;
    var b = el("button", { type: "button", "aria-pressed": "true" });
    var dot = el("i"); dot.style.background = GROUPS[group].color;
    b.appendChild(dot); b.appendChild(document.createTextNode(GROUPS[group].label));
    b.addEventListener("click", function () {
      hiddenGroups[group] = !hiddenGroups[group];
      b.setAttribute("aria-pressed", String(!hiddenGroups[group]));
    });
    legend.appendChild(b);
  });

  // Issues list
  var issuesBox = document.getElementById("issues");
  var all = [];
  nodes.forEach(function (n) { n.issues.forEach(function (i) { all.push({ node: n, issue: i }); }); });
  all.sort(function (a, b) { return (a.issue.severity === "error" ? 0 : 1) - (b.issue.severity === "error" ? 0 : 1); });
  if (all.length === 0) {
    issuesBox.appendChild(el("h2", null, "Findings"));
    issuesBox.appendChild(el("p", { class: "meta" }, meta.mode === "scan-only" ? "Run harnesslock init && harnesslock lock to verify." : "No drift. Everything matches harnesslock.lock."));
  } else {
    issuesBox.appendChild(el("h2", null, "Findings (" + all.length + ")"));
    var ol = el("ol");
    all.forEach(function (item) {
      var li = el("li");
      var b = el("button", { type: "button" });
      b.appendChild(el("span", { class: "code sev-" + item.issue.severity }, (item.issue.severity === "error" ? "✕ " : "⚠ ") + item.issue.code + " · " + item.node.label));
      b.appendChild(el("span", { class: "msg" }, item.issue.message));
      b.addEventListener("click", function () { focusNode(item.node); });
      li.appendChild(b); ol.appendChild(li);
    });
    issuesBox.appendChild(ol);
  }

  // Accessible text alternative of the graph.
  var sr = document.getElementById("sr-summary");
  sr.textContent = nodes.length + " components, " + links.length + " connections, " + all.length + " findings.";

  resize();
  fit();
  requestAnimationFrame(frame);
})();
`;

export function renderVizHtml(graph: VizGraph): string {
  const title = `HarnessLock · ${graph.meta.project}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%94%92%3C/text%3E%3C/svg%3E">
<style>${STYLE}</style>
</head>
<body>
<canvas id="graph" aria-label="Agent configuration graph" role="img"></canvas>
<p id="sr-summary" class="sr"></p>
<header class="hud">
  <span class="brand">🔒 HarnessLock <small>v${escapeHtml(graph.meta.version)}</small></span>
  <span id="status" class="status"></span>
  <span class="meta"><span id="project"></span> · <span id="generated"></span></span>
  <span class="spacer"></span>
  <label class="sr" for="search">Search components</label>
  <input id="search" type="search" placeholder="Search  ( / )" autocomplete="off">
  <button id="issues-only" type="button" aria-pressed="false">Issues only</button>
  <button id="fit" type="button">Fit</button>
</header>
<aside id="panel" class="hud" aria-live="polite"></aside>
<nav id="legend" class="hud" aria-label="Component types"></nav>
<section id="issues" class="hud" aria-label="Findings"></section>
<script id="hl-data" type="application/json">${embedJson(graph)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
