import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AppFrame } from "../AppFrame.js";
import { errorMessage } from "../catalog/api.js";
import { layers, limits, loadTimeline, presets, related, spanLabel, tickLabel, ticks, type LayerId, type TimelineItem } from "./model.js";
import "../catalog/catalog.css";
import "./timegraph.css";

type Data = Awaited<ReturnType<typeof loadTimeline>>;
type View = { start: number; end: number };
type Group = "layer" | "who";
type Lane = { id: string; label: string; hint: string; items: TimelineItem[] };
type Mark = { x: number; items: TimelineItem[] };
type Drag = { pointer: number; x: number; view: View; moved: boolean; overview?: boolean };

const AXIS_H = 46, OVERVIEW_H = 44, GUTTER = 176, CLUSTER_PX = 22;
const clusterRadius = (count: number) => Math.min(11, 7 + Math.log2(count) * 1.5);
// Keep the tooltip inside the chart: shift it left near the right edge, above the mark near the bottom.
function tooltipPlace(hover: { x: number; y: number; items: unknown[] }, width: number, height: number) {
  const tall = Math.min(6, hover.items.length) * 40 + (hover.items.length > 6 ? 26 : 10);
  return { left: Math.max(GUTTER, Math.min(width + GUTTER - 290, hover.x + GUTTER - 20)), top: hover.y + 18 + tall > height - 44 ? Math.max(4, hover.y - 18 - tall) : hover.y + 18 };
}
const layerOf = new Map(layers.map(layer => [layer.id, layer]));
const isLayer = (value: string): value is LayerId => layerOf.has(value as LayerId);
const clampView = ({ start, end }: View): View => {
  const span = Math.min(limits.maxSpan, Math.max(limits.minSpan, end - start)), mid = (start + end) / 2;
  return { start: mid - span / 2, end: mid + span / 2 };
};
const fullTime = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
const shortTime = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const openLabel = (item: TimelineItem) => item.layer === "git" ? "View commit" : item.layer === "canvases" ? "Open canvas" : item.id.startsWith("harness:") ? "Open harness" : "Open in Catalog";

function readUrl() {
  const query = new URLSearchParams(window.location.search);
  const from = Date.parse(query.get("from") ?? ""), to = Date.parse(query.get("to") ?? "");
  return {
    view: Number.isFinite(from) && Number.isFinite(to) && to > from ? clampView({ start: from, end: to }) : undefined,
    group: (query.get("group") === "who" ? "who" : "layer") as Group,
    hidden: new Set((query.get("hide") ?? "").split(",").filter(isLayer)),
  };
}

export function TimeGraph({ modeSwitch, actions, reloadToken = 0 }: { modeSwitch: ReactNode; actions?: ReactNode; reloadToken?: number }) {
  const initial = useMemo(readUrl, []);
  const [data, setData] = useState<Data>();
  const [error, setError] = useState(""), [loading, setLoading] = useState(false), [loadedAt, setLoadedAt] = useState(0);
  const [view, setView] = useState<View | undefined>(initial.view);
  const [group, setGroup] = useState<Group>(initial.group);
  const [hidden, setHidden] = useState<Set<LayerId>>(initial.hidden);
  const [selected, setSelected] = useState(""), [cluster, setCluster] = useState<TimelineItem[]>();
  const [hover, setHover] = useState<{ x: number; y: number; items: TimelineItem[] }>();
  const [width, setWidth] = useState(800), [height, setHeight] = useState(500), [now, setNow] = useState(Date.now());
  const chart = useRef<HTMLDivElement>(null), plot = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null);
  const latest = useRef({ view, width });
  latest.current = { view, width };

  const load = useCallback(async (quiet = false) => {
    const control = new AbortController();
    if (!quiet) setLoading(true);
    try { const next = await loadTimeline(control.signal); setData(next); setError(""); setLoadedAt(Date.now()); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (reloadToken) void load(true); }, [reloadToken, load]);
  // Agents write continuously; refresh quietly while the page is visible.
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()); if (document.visibilityState === "visible") void load(true); }, 30000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    const node = chart.current; if (!node) return;
    const observer = new ResizeObserver(([entry]) => { setWidth(Math.max(240, (entry?.contentRect.width ?? 800) - GUTTER)); setHeight(entry?.contentRect.height ?? 500); });
    observer.observe(node); return () => observer.disconnect();
  }, []);

  const items = useMemo(() => (data?.items ?? []).filter(item => !hidden.has(item.layer)), [data, hidden]);
  const extent = useMemo(() => {
    const own = items.filter(item => !item.id.startsWith("schedule:"));
    const times = (own.length ? own : items).flatMap(item => [item.at, item.end ?? item.at]);
    if (!times.length) return { start: now - 6 * 3600e3, end: now };
    const start = Math.min(...times), end = Math.max(...times), pad = Math.max((end - start) * .04, 5 * 60e3);
    return { start: start - pad, end: end + pad };
  }, [items, now]);
  const fit = useCallback(() => { setView(clampView(extent)); }, [extent]);
  useEffect(() => { if (!view && data) setView(clampView(extent)); }, [data, extent, view]);
  useEffect(() => {
    if (!view) return;
    const timer = setTimeout(() => {
      const query = new URLSearchParams(window.location.search);
      query.set("view", "timeline"); query.set("from", new Date(view.start).toISOString()); query.set("to", new Date(view.end).toISOString());
      if (group === "who") query.set("group", "who"); else query.delete("group");
      if (hidden.size) query.set("hide", [...hidden].join(",")); else query.delete("hide");
      window.history.replaceState(null, "", `/?${query}`);
    }, 300);
    return () => clearTimeout(timer);
  }, [view, group, hidden]);

  const zoomAt = useCallback((fraction: number, factor: number) => setView(current => {
    if (!current) return current;
    const span = current.end - current.start, next = Math.min(limits.maxSpan, Math.max(limits.minSpan, span * factor));
    const pivot = current.start + fraction * span;
    return { start: pivot - fraction * next, end: pivot - fraction * next + next };
  }), []);
  const pan = useCallback((fraction: number) => setView(current => current && { start: current.start + fraction * (current.end - current.start), end: current.end + fraction * (current.end - current.start) }), []);
  const centerOn = useCallback((t: number, span?: number) => setView(current => current && clampView({ start: t - (span ?? current.end - current.start) / 2, end: t + (span ?? current.end - current.start) / 2 })), []);
  // Wheel zooms around the pointer; horizontal scrolling or Shift pans. Pinch arrives as Ctrl+wheel.
  useEffect(() => {
    const node = plot.current; if (!node) return;
    const wheel = (event: WheelEvent) => {
      const { view: current, width: plotWidth } = latest.current;
      const x = event.clientX - node.getBoundingClientRect().left;
      if (!current || x < 0) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? plotWidth : 1;
      const dx = event.deltaX * unit, dy = event.deltaY * unit;
      if (event.shiftKey || Math.abs(dx) > Math.abs(dy)) pan((event.shiftKey && !dx ? dy : dx) / plotWidth);
      else zoomAt(Math.min(1, x / plotWidth), Math.exp(dy * (event.ctrlKey ? .01 : .0015)));
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [pan, zoomAt, data]);

  const lanes: Lane[] = useMemo(() => {
    if (group === "layer") return layers.filter(layer => !hidden.has(layer.id)).map(layer => ({ id: layer.id, label: layer.label, hint: layer.hint, items: items.filter(item => item.layer === layer.id) }));
    const milestones = items.filter(item => item.layer === "milestones");
    const byActor = new Map<string, TimelineItem[]>();
    for (const item of items) if (item.layer !== "milestones") { const who = item.actor || "Unattributed"; byActor.set(who, [...byActor.get(who) ?? [], item]); }
    return [...(milestones.length ? [{ id: "milestones", label: "Milestones", hint: layerOf.get("milestones")!.hint, items: milestones }] : []),
      ...[...byActor.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([who, list]) => ({
        id: `who:${who}`, label: who, hint: [...new Set(list.map(item => layerOf.get(item.layer)!.label))].join(" · "), items: list }))];
  }, [group, hidden, items]);

  // Lanes share the available height, so a few layers read large and many still fit.
  const LANE_H = Math.round(Math.min(84, Math.max(44, (height - AXIS_H - OVERVIEW_H) / Math.max(1, lanes.length))));
  const span = view ? view.end - view.start : 1;
  const x = useCallback((t: number) => view ? (t - view.start) / (view.end - view.start) * width : 0, [view, width]);
  // Marks closer than a few pixels merge into a cluster that stays inspectable.
  const marks = useMemo(() => lanes.map(lane => {
    const placed = lane.items.filter(item => !(item.id.startsWith("schedule:") && item.end)).map(item => ({ item, x: x(item.at) }))
      .filter(entry => entry.x >= -30 && entry.x <= width + 30).sort((a, b) => a.x - b.x);
    const groups: Mark[] = [];
    for (const entry of placed) {
      const last = groups[groups.length - 1];
      if (last && entry.x - last.x < CLUSTER_PX) last.items.push(entry.item); else groups.push({ x: entry.x, items: [entry.item] });
    }
    return groups;
  }), [lanes, x, width]);
  const visibleItems = marks.flat().flatMap(mark => mark.items);
  const selectedItem = data?.items.find(item => item.id === selected);
  const relatedItems = useMemo(() => selectedItem && data ? related(selectedItem, items) : [], [selectedItem, items, data]);
  const relatedIds = new Set(relatedItems.map(item => item.id));
  const position = (id: string) => {
    for (const [index, laneMarks] of marks.entries()) for (const mark of laneMarks) if (mark.items.some(item => item.id === id)) return { x: mark.x, y: index * LANE_H + LANE_H / 2 };
    return undefined;
  };

  function select(item: TimelineItem, reveal = false) {
    setSelected(item.id); setCluster(undefined);
    if (reveal && view && (item.at < view.start || item.at > view.end)) centerOn(item.at);
  }
  function openMark(mark: Mark) {
    if (mark.items.length === 1) { select(mark.items[0]!); return; }
    const times = mark.items.map(item => item.at), first = Math.min(...times), last = Math.max(...times);
    // Zoom in while that separates the marks; at the closest zoom, list them instead.
    if (last - first > limits.minSpan * .25 && span > limits.minSpan * 1.01) setView(clampView({ start: first - (last - first) * .3, end: last + (last - first) * .3 }));
    else { setCluster([...mark.items].sort((a, b) => a.at - b.at)); setSelected(""); }
  }
  function step(direction: 1 | -1) {
    const ordered = [...items].filter(item => !item.id.startsWith("schedule:")).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    if (!ordered.length) return;
    const index = ordered.findIndex(item => item.id === selected);
    const next = index < 0 ? (direction > 0 ? ordered.find(item => view && item.at >= view.start) ?? ordered[0] : [...ordered].reverse().find(item => view && item.at <= view.end) ?? ordered[ordered.length - 1])
      : ordered[Math.min(ordered.length - 1, Math.max(0, index + direction))];
    if (next) select(next, true);
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>, overview = false) {
    if (!view || event.button !== 0 || (event.target as Element).closest("[data-mark]")) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    if (overview) {
      const rect = event.currentTarget.getBoundingClientRect(), t = extentOverview.start + (event.clientX - rect.left) / rect.width * (extentOverview.end - extentOverview.start);
      if (t < view.start || t > view.end) centerOn(t);
    }
    drag.current = { pointer: event.pointerId, x: event.clientX, view: latest.current.view ?? view, moved: false, overview };
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const active = drag.current; if (!active || active.pointer !== event.pointerId) return;
    const dx = event.clientX - active.x; if (!active.moved && Math.abs(dx) < 3) return;
    active.moved = true;
    const rect = event.currentTarget.getBoundingClientRect();
    const perPx = active.overview ? (extentOverview.end - extentOverview.start) / rect.width : -(active.view.end - active.view.start) / width;
    setView({ start: active.view.start + dx * perPx, end: active.view.end + dx * perPx });
  }
  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const active = drag.current; drag.current = null;
    if (active && !active.moved && !active.overview) { setSelected(""); setCluster(undefined); }
    if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  const axis = view ? ticks(view.start, view.end, width) : undefined;
  const windowItem = items.find(item => item.id.startsWith("schedule:") && item.end);
  const extentOverview = useMemo(() => {
    const start = Math.min(extent.start, view?.start ?? extent.start), end = Math.max(extent.end, view?.end ?? extent.end, now);
    return { start, end: end > start ? end : start + 1 };
  }, [extent, view, now]);
  const ox = (t: number) => (t - extentOverview.start) / (extentOverview.end - extentOverview.start) * 100;
  const layerCounts = useMemo(() => new Map(layers.map(layer => [layer.id, (data?.items ?? []).filter(item => item.layer === layer.id).length])), [data]);
  const failed = (data?.failed ?? []).filter(source => !hidden.has(source.layer));
  const panel = selectedItem ?? (cluster ? cluster : undefined);

  return <div className="catalog-app timegraph-app">
    <AppFrame active="Timeline" data={data?.scope ? { ...data.health, scope: data.scope } : undefined} error={Boolean(error)} />
    <main className="tg-main">
      <div className="tg-toolbar">
        {modeSwitch}
        <div className="tg-segmented" role="group" aria-label="Group lanes by">{(["layer", "who"] as const).map(value => <button key={value} aria-pressed={group === value} onClick={() => setGroup(value)}>{value === "layer" ? "By layer" : "By who"}</button>)}</div>
        <div className="tg-layers" role="group" aria-label="Layers">{layers.map(layer => <button key={layer.id} className={`tg-chip layer-${layer.id}`} aria-pressed={!hidden.has(layer.id)} title={layer.hint}
          onClick={() => setHidden(current => { const next = new Set(current); if (next.has(layer.id)) next.delete(layer.id); else next.add(layer.id); return next; })}>
          <span className="tg-swatch" aria-hidden="true" />{layer.label}<span className="tg-count">{layerCounts.get(layer.id) ?? 0}</span></button>)}</div>
        <span className="toolbar-spacer" />
        <div className="tg-zoom" role="group" aria-label="Zoom">
          <button aria-label="Zoom out" onClick={() => zoomAt(.5, 1 / .6)}>−</button><button aria-label="Zoom in" onClick={() => zoomAt(.5, .6)}>+</button>
          {presets.map(preset => <button key={preset.label} onClick={() => view && centerOn(Math.min((view.start + view.end) / 2, now), preset.span)}>{preset.label}</button>)}
          <button onClick={fit}>Fit</button><button onClick={() => centerOn(now)}>Now</button>
        </div>
        <button onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        {actions}
      </div>
      {error && <div className="error-message" role="alert">{error} <button onClick={() => void load()}>Retry</button></div>}
      {failed.length > 0 && <p className="tg-note" role="status">{failed.map(source => `${layerOf.get(source.layer)?.label}: ${source.error}`).join(" · ")}</p>}
      <div className={`tg-body ${panel ? "with-panel" : ""}`}>
        <div className="tg-chart" ref={chart} tabIndex={0} aria-label="Timeline. Scroll to zoom, drag to pan, brackets step through items." onKeyDown={event => {
          if ((event.target as HTMLElement).closest("button,a,input,select")) return;
          const keys: Record<string, () => void> = { "+": () => zoomAt(.5, .6), "=": () => zoomAt(.5, .6), "-": () => zoomAt(.5, 1 / .6), ArrowLeft: () => pan(-.15), ArrowRight: () => pan(.15),
            f: fit, n: () => centerOn(now), "]": () => step(1), "[": () => step(-1), Escape: () => { setSelected(""); setCluster(undefined); } };
          const action = keys[event.key]; if (action) { event.preventDefault(); action(); }
        }}>
          <div className="tg-axis-row">
            <div className="tg-corner"><strong>{view ? spanLabel(span) : "…"}</strong><span>{view ? `${shortTime(view.start)} – ${shortTime(view.end)}` : ""}</span></div>
            <svg className="tg-axis" width={width} height={AXIS_H} aria-hidden="true">
              {axis?.days.map(day => { const left = Math.max(0, x(day)); return left < width - 40 ? <text key={day} className="tg-day" x={left + 4} y={15}>{new Date(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</text> : null; })}
              {axis?.values.map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={AXIS_H - 8} y2={AXIS_H} className="tg-tick" /><text x={x(t) + 3} y={AXIS_H - 12} className="tg-tick-label">{tickLabel(t, axis.step)}</text></g>)}
              {view && now >= view.start && now <= view.end && <g className="tg-now"><line x1={x(now)} x2={x(now)} y1={20} y2={AXIS_H} /><text x={x(now) + (x(now) > width - 40 ? -28 : 4)} y={30}>Now</text></g>}
            </svg>
          </div>
          <div className="tg-lanes">
            <div className="tg-lane-labels">{lanes.map(lane => <div key={lane.id} className={`tg-lane-label ${lane.id.startsWith("who:") ? "" : `layer-${lane.id}`}`} style={{ height: LANE_H }} title={lane.hint}>
              <strong>{lane.label}</strong><span>{lane.items.length} · {lane.hint}</span></div>)}</div>
            <div className="tg-plot" ref={plot} onPointerDown={event => pointerDown(event)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null; }}>
              <svg width={width} height={Math.max(LANE_H, lanes.length * LANE_H)} role="img" aria-label={`${visibleItems.length} items between ${view ? fullTime(view.start) : ""} and ${view ? fullTime(view.end) : ""}`}>
                {windowItem?.end && <rect className="tg-window" x={x(windowItem.at)} width={Math.max(0, x(windowItem.end) - x(windowItem.at))} y={0} height={lanes.length * LANE_H} />}
                {axis?.values.map(t => <line key={t} className="tg-grid" x1={x(t)} x2={x(t)} y1={0} y2={lanes.length * LANE_H} />)}
                {lanes.map((lane, index) => <line key={lane.id} className="tg-lane-rule" x1={0} x2={width} y1={(index + 1) * LANE_H} y2={(index + 1) * LANE_H} />)}
                {lanes.map((lane, index) => lane.items.filter(item => item.end).map(item => {
                  const left = Math.max(-5, x(item.at)), right = Math.min(width + 5, x(item.end!)); if (right < 0 || left > width) return null;
                  const y = index * LANE_H + LANE_H / 2, schedule = item.id.startsWith("schedule:");
                  return <g key={`${item.id}:span`} className={`tg-span tone-${item.tone} ${schedule ? "is-window" : ""}`}>
                    <rect x={left} y={y - (schedule ? 9 : 3)} width={Math.max(2, right - left)} height={schedule ? 18 : 6} rx={schedule ? 4 : 3} />
                    {schedule && right - left > 90 && <text x={left + 8} y={y + 4}>{item.title}</text>}
                  </g>;
                }))}
                {selectedItem && relatedItems.map(item => { const from = position(selectedItem.id), to = position(item.id); if (!from || !to) return null;
                  const mid = (from.y + to.y) / 2; return <path key={`link:${item.id}`} className="tg-link" d={`M ${from.x} ${from.y} C ${from.x} ${mid}, ${to.x} ${mid}, ${to.x} ${to.y}`} />; })}
                {marks.map((laneMarks, index) => laneMarks.map((mark, markIndex) => {
                  const y = index * LANE_H + LANE_H / 2, first = mark.items[0]!, single = mark.items.length === 1;
                  const isSelected = mark.items.some(item => item.id === selected), isRelated = mark.items.some(item => relatedIds.has(item.id));
                  const room = (laneMarks[markIndex + 1]?.x ?? width + 200) - mark.x - 16;
                  const label = single && room > 44 ? (first.title.length * 6.2 > room ? `${first.title.slice(0, Math.max(3, Math.floor(room / 6.2) - 1))}…` : first.title) : "";
                  return <g key={`${index}:${first.id}`} data-mark className={`tg-mark tone-${first.tone} ${single ? "" : "is-cluster"} ${isSelected ? "is-selected" : ""} ${isRelated ? "is-related" : ""}`}
                    transform={`translate(${mark.x} ${y})`} onClick={() => openMark(mark)}
                    onPointerEnter={() => setHover({ x: mark.x, y: y + AXIS_H, items: mark.items })} onPointerLeave={() => setHover(undefined)}>
                    {single ? <circle r={first.id.startsWith("harness:") || first.id.startsWith("schedule:") ? 0 : 5.5} /> : <circle r={clusterRadius(mark.items.length)} />}
                    {single && (first.id.startsWith("harness:") || first.id.startsWith("schedule:")) && <path d="M 0 -7 L 7 0 L 0 7 L -7 0 Z" />}
                    {!single && <text className="tg-count-label" y={4}>{mark.items.length}</text>}
                    {label && <text className="tg-label" x={10} y={4}>{label}</text>}
                  </g>;
                }))}
                {view && now >= view.start && now <= view.end && <line className="tg-now-line" x1={x(now)} x2={x(now)} y1={0} y2={lanes.length * LANE_H} />}
              </svg>
              {!lanes.length && <p className="tg-empty">All layers are hidden. Turn one on above.</p>}
            </div>
          </div>
          {hover && <div className="tg-tooltip" style={tooltipPlace(hover, width, height)} role="tooltip">
            {hover.items.slice(0, 6).map(item => <div key={item.id}><span>{shortTime(item.at)} · {layerOf.get(item.layer)?.label}</span>{item.title}</div>)}
            {hover.items.length > 6 && <div className="muted">and {hover.items.length - 6} more — click to {hover.items.length > 1 ? "zoom in or list them" : "open"}</div>}
          </div>}
          <div className="tg-overview" aria-label="Overview. Drag the window to move through time." onPointerDown={event => pointerDown(event, true)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null; }}>
            <div className="tg-overview-track">
              {(data?.items ?? []).filter(item => !hidden.has(item.layer) && !item.id.startsWith("schedule:")).map(item => <span key={item.id} className={`tg-density tone-${item.tone}`}
                style={{ left: `${ox(item.at)}%`, top: `${6 + layers.findIndex(layer => layer.id === item.layer) * 4}px` }} />)}
              {now >= extentOverview.start && now <= extentOverview.end && <span className="tg-overview-now" style={{ left: `${ox(now)}%` }} />}
              {view && <span className="tg-brush" style={{ left: `${ox(view.start)}%`, width: `${Math.max(.6, ox(view.end) - ox(view.start))}%` }} />}
            </div>
          </div>
        </div>
        {panel && <aside className="tg-panel" aria-label="Selected timeline item">
          <div className="panel-heading"><strong>{Array.isArray(panel) ? `${panel.length} items at ${shortTime(panel[0]!.at)}` : layerOf.get(panel.layer)?.label}</strong>
            <button className="icon-button" aria-label="Close details" onClick={() => { setSelected(""); setCluster(undefined); }}>×</button></div>
          {Array.isArray(panel) ? <ol className="tg-list">{panel.map(item => <li key={item.id}><button onClick={() => select(item)}><span className={`tg-dot tone-${item.tone}`} />{item.title}<small>{layerOf.get(item.layer)?.label} · {shortTime(item.at)}</small></button></li>)}</ol> : <>
            <h2>{panel.title}</h2>
            <p className="muted">{fullTime(panel.at)}{panel.end ? ` → ${fullTime(panel.end)}` : ""}</p>
            <div className="detail-tags"><span className={`status tone-${panel.tone}`}>{panel.kind.replaceAll("_", " ").replaceAll(".", " ")}</span>{panel.actor && <span className="tag">{panel.actor}</span>}</div>
            {panel.detail && <p className="record-prose">{panel.detail}</p>}
            {panel.href && <a className="tg-open" href={panel.href} {...(panel.external ? { target: "_blank", rel: "noreferrer" } : {})}>{openLabel(panel)} ↗</a>}
            <h3>Related {relatedItems.length ? `(${relatedItems.length})` : ""}</h3>
            {relatedItems.length ? <ol className="tg-list">{[...relatedItems].sort((a, b) => a.at - b.at).slice(0, 20).map(item => <li key={item.id}><button onClick={() => select(item, true)}><span className={`tg-dot tone-${item.tone}`} />{item.title}<small>{layerOf.get(item.layer)?.label} · {shortTime(item.at)}</small></button></li>)}</ol>
              : <p className="muted">No other record in view refers to this one.</p>}
            <p className="muted tg-fine">Related means the records reference each other. It does not show that one caused the other.</p>
          </>}
        </aside>}
      </div>
      <footer className="tg-footer"><span>{visibleItems.filter(item => !item.id.startsWith("schedule:")).length} of {items.filter(item => !item.id.startsWith("schedule:")).length} items in view{data?.truncated ? " · oldest activity not loaded" : ""}</span>
        <span className="tg-hint">Scroll to zoom · drag or Shift+scroll to pan · [ ] step through items · F fits</span><span>{loadedAt ? `Updated ${shortTime(loadedAt)}` : ""}</span></footer>
    </main>
  </div>;
}
