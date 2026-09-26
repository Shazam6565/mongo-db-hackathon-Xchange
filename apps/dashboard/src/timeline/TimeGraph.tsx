import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AppFrame } from "../AppFrame.js";
import { errorMessage } from "../catalog/api.js";
import { usePopoverDismiss } from "../catalog/hooks.js";
import { layers, limits, loadTimeline, presets, related, spanLabel, tickLabel, ticks, type LayerId, type TimelineItem } from "./model.js";
import "../catalog/catalog.css";
import "./timegraph.css";

type Data = Awaited<ReturnType<typeof loadTimeline>>;
type View = { start: number; end: number };
type Group = "layer" | "who";
type Lane = { id: string; label: string; hint: string; items: TimelineItem[]; note?: string };
type Mark = { x: number; items: TimelineItem[] };
// A plot drag pans time and scrolls the lanes, an axis drag pans time, an overview drag moves the window or one of its edges.
type Drag = { pointer: number; x: number; y: number; view: View; top: number; perPx: number; moved: boolean; target: "plot" | "axis" | "overview" | "start" | "end" };
type Hover = { left: number; width: number; top?: number; bottom?: number; items: TimelineItem[] };

// Lanes keep one compact height so many fit; any that do not scroll into view.
const LANE_H = 30, AXIS_H = 34, OVERVIEW_H = 34, CLUSTER_PX = 20;
const clusterRadius = (count: number) => Math.min(10, 6.5 + Math.log2(count) * 1.4);
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";
const smooth = (): ScrollBehavior => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
const layerOf = new Map(layers.map(layer => [layer.id, layer]));
const isLayer = (value: string): value is LayerId => layerOf.has(value as LayerId);
const clampView = ({ start, end }: View): View => {
  const span = Math.min(limits.maxSpan, Math.max(limits.minSpan, end - start)), mid = (start + end) / 2;
  return { start: mid - span / 2, end: mid + span / 2 };
};
const fullTime = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
const shortTime = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const dayLabel = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const shortDay = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
// The corner names the visible range: times within one day, dates across several.
const rangeLabel = ({ start, end }: View) => new Date(start).toDateString() === new Date(end).toDateString()
  ? [`${shortTime(start)} – ${shortTime(end)}`, dayLabel(start)] : [`${shortDay(start)} – ${shortDay(end)}`, `${shortTime(start)} – ${shortTime(end)}`];
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
  usePopoverDismiss();
  const initial = useMemo(readUrl, []);
  const [data, setData] = useState<Data>();
  const [error, setError] = useState(""), [loading, setLoading] = useState(false), [loadedAt, setLoadedAt] = useState(0);
  const [view, setView] = useState<View | undefined>(initial.view);
  const [group, setGroup] = useState<Group>(initial.group);
  const [hidden, setHidden] = useState<Set<LayerId>>(initial.hidden);
  const [selected, setSelected] = useState(""), [cluster, setCluster] = useState<TimelineItem[]>();
  const [hover, setHover] = useState<Hover>();
  // The lanes box scrolls the labels and the plot together: its width sets the time scale, its height how many lanes show.
  const [box, setBox] = useState({ width: 960, height: 400 }), [scrollTop, setScrollTop] = useState(0), [now, setNow] = useState(Date.now());
  const chart = useRef<HTMLDivElement>(null), lanesBox = useRef<HTMLDivElement>(null), plot = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null);
  const gutter = box.width < 640 ? 112 : 168, width = Math.max(200, box.width - gutter);
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
    const node = lanesBox.current; if (!node) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height }); });
    observer.observe(node); return () => observer.disconnect();
  }, []);
  useEffect(() => { lanesBox.current?.scrollTo({ top: 0 }); }, [group]);

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
  // Scrolling moves, as on the canvas: vertically through the lanes while they overflow and through time when they fit;
  // horizontal scrolling or Shift pans time. Ctrl/⌘ + scroll, or a pinch (Ctrl + wheel), zooms around the pointer.
  // The listener covers the whole chart, so the page never zooms or scrolls instead.
  useEffect(() => {
    const node = chart.current; if (!node) return;
    const wheel = (event: WheelEvent) => {
      const { view: current, width: plotWidth } = latest.current, lanes = lanesBox.current, area = plot.current;
      if (!current || !lanes || !area || !(event.target instanceof Element)) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? lanes.clientHeight : 1;
      let dx = event.deltaX * unit, dy = event.deltaY * unit;
      setHover(undefined);
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const x = event.clientX - area.getBoundingClientRect().left;
        // Pinch deltas are small and frequent; a mouse wheel notch is about 100. Both become gentle steps.
        zoomAt(x < 0 || event.target.closest(".tg-overview") ? .5 : Math.min(1, x / plotWidth), Math.min(2, Math.max(.5, Math.exp(dy * (Math.abs(dy) < 50 ? .01 : .002)))));
        return;
      }
      if (event.shiftKey && !dx) { dx = dy; dy = 0; }
      if (Math.abs(dy) > Math.abs(dx) && lanes.contains(event.target) && lanes.scrollHeight > lanes.clientHeight + 1) return;
      event.preventDefault();
      pan((Math.abs(dx) >= Math.abs(dy) ? dx : dy) / plotWidth);
    };
    const gestureStart = (event: Event) => event.preventDefault();
    node.addEventListener("wheel", wheel, { passive: false }); node.addEventListener("gesturestart", gestureStart);
    return () => { node.removeEventListener("wheel", wheel); node.removeEventListener("gesturestart", gestureStart); };
  }, [pan, zoomAt]);

  const failedBy = useMemo(() => new Map((data?.failed ?? []).map(source => [source.layer, source.error])), [data]);
  const lanes: Lane[] = useMemo(() => {
    if (group === "layer") return layers.filter(layer => !hidden.has(layer.id)).map(layer => ({ id: layer.id, label: layer.label, hint: layer.hint, note: failedBy.get(layer.id), items: items.filter(item => item.layer === layer.id) }));
    const milestones = items.filter(item => item.layer === "milestones");
    const byActor = new Map<string, TimelineItem[]>();
    for (const item of items) if (item.layer !== "milestones") { const who = item.actor || "Unattributed"; byActor.set(who, [...byActor.get(who) ?? [], item]); }
    return [...(milestones.length ? [{ id: "milestones", label: "Milestones", hint: layerOf.get("milestones")!.hint, items: milestones }] : []),
      ...[...byActor.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([who, list]) => ({
        id: `who:${who}`, label: who, hint: [...new Set(list.map(item => layerOf.get(item.layer)!.label))].join(" · "), items: list }))];
  }, [group, hidden, items, failedBy]);

  // The plot fills the lanes box so the grid reaches the overview; lanes whose middle is out of sight count as above or below.
  const plotH = Math.max(lanes.length * LANE_H, Math.floor(box.height)), top = Math.min(scrollTop, Math.max(0, lanes.length * LANE_H - box.height));
  const above = Math.floor((top + LANE_H / 2) / LANE_H), below = Math.max(0, lanes.length - Math.floor((top + box.height + LANE_H / 2) / LANE_H));
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
  const activeLane = selectedItem && lanes.find(lane => lane.items.some(item => item.id === selectedItem.id))?.id;
  const relatedItems = useMemo(() => selectedItem && data ? related(selectedItem, items) : [], [selectedItem, items, data]);
  const relatedIds = new Set(relatedItems.map(item => item.id));
  const position = (id: string) => {
    for (const [index, laneMarks] of marks.entries()) for (const mark of laneMarks) if (mark.items.some(item => item.id === id)) return { x: mark.x, y: index * LANE_H + LANE_H / 2 };
    return undefined;
  };

  const scrollLanes = (direction: 1 | -1) => lanesBox.current?.scrollBy({ top: direction * Math.max(LANE_H, box.height - 2 * LANE_H), behavior: smooth() });
  function revealLane(id: string) {
    const node = lanesBox.current, index = lanes.findIndex(lane => lane.items.some(item => item.id === id));
    if (!node || index < 0) return;
    const laneTop = index * LANE_H;
    if (laneTop < node.scrollTop) node.scrollTo({ top: laneTop, behavior: smooth() });
    else if (laneTop + LANE_H > node.scrollTop + node.clientHeight) node.scrollTo({ top: laneTop + LANE_H - node.clientHeight, behavior: smooth() });
  }
  function select(item: TimelineItem, reveal = false) {
    setSelected(item.id); setCluster(undefined);
    if (!reveal) return;
    if (view && (item.at < view.start || item.at > view.end)) centerOn(item.at);
    revealLane(item.id);
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
  // The tooltip is placed from the mark's position on screen, so it follows the lanes' scroll.
  function showTip(mark: Mark, y: number) {
    const frame = chart.current?.getBoundingClientRect(), area = plot.current?.getBoundingClientRect(); if (!frame || !area) return;
    const cx = area.left - frame.left + mark.x, cy = area.top - frame.top + y, count = mark.items.length;
    const tall = Math.min(6, count) * 40 + (count > 6 ? 26 : 10), tipWidth = Math.min(280, frame.width - 16), maxLeft = frame.width - tipWidth - 8;
    const place = { left: Math.max(Math.min(gutter, maxLeft), Math.min(maxLeft, cx - 20)), width: tipWidth, items: mark.items };
    setHover(cy + 14 + tall > frame.height - OVERVIEW_H ? { ...place, bottom: frame.height - cy + 14 } : { ...place, top: cy + 14 });
  }

  function pointerDown(event: ReactPointerEvent<HTMLElement | SVGSVGElement>, target: "plot" | "axis" | "overview") {
    const current = latest.current.view;
    if (!current || event.button !== 0 || (event.target as Element).closest("[data-mark]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const edge = (event.target as Element).closest<HTMLElement>("[data-edge]")?.dataset.edge;
    let base = current, perPx = -(current.end - current.start) / width;
    if (target === "overview") {
      const bounds = track.current?.getBoundingClientRect();
      perPx = bounds?.width ? (extentOverview.end - extentOverview.start) / bounds.width : 0;
      const t = bounds ? extentOverview.start + (event.clientX - bounds.left) * perPx : NaN, half = (current.end - current.start) / 2;
      // A press outside the window moves it there first; a drag carries on from the new place.
      if (!edge && Number.isFinite(t) && (t < current.start || t > current.end)) { base = clampView({ start: t - half, end: t + half }); setView(base); }
    }
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, view: base, top: lanesBox.current?.scrollTop ?? 0, perPx, moved: false, target: edge === "start" || edge === "end" ? edge : target };
  }
  function pointerMove(event: ReactPointerEvent<HTMLElement | SVGSVGElement>) {
    const active = drag.current; if (!active || active.pointer !== event.pointerId) return;
    const dx = event.clientX - active.x, dy = event.clientY - active.y;
    if (!active.moved && Math.hypot(dx, dy) < 3) return;
    active.moved = true; setHover(undefined);
    const { start, end } = active.view, shift = dx * active.perPx;
    if (active.target === "start") setView({ start: Math.min(end - limits.minSpan, Math.max(end - limits.maxSpan, start + shift)), end });
    else if (active.target === "end") setView({ start, end: Math.max(start + limits.minSpan, Math.min(start + limits.maxSpan, end + shift)) });
    else setView({ start: start + shift, end: end + shift });
    if (active.target === "plot" && lanesBox.current) lanesBox.current.scrollTop = active.top - dy;
  }
  function pointerUp(event: ReactPointerEvent<HTMLElement | SVGSVGElement>) {
    const active = drag.current; drag.current = null;
    if (active && !active.moved && active.target === "plot") { setSelected(""); setCluster(undefined); }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const dragHandlers = { onPointerMove: pointerMove, onPointerUp: pointerUp, onPointerCancel: () => { drag.current = null; } };
  // Double-click zooms in around the pointer, Shift + double-click zooms out; on a mark it zooms in around that record.
  function doubleClick(event: ReactMouseEvent<HTMLElement | SVGSVGElement>) {
    const mark = (event.target as Element).closest<SVGElement>("[data-mark]");
    if (mark) { const item = items.find(entry => entry.id === mark.dataset.mark); if (item) centerOn(item.at, span / 4); return; }
    const area = plot.current?.getBoundingClientRect(); if (!area) return;
    zoomAt(Math.min(1, Math.max(0, (event.clientX - area.left) / width)), event.shiftKey ? 2 : .5);
  }
  // Keys act while nothing else has focus or the chart does, so they never take over the toolbar, panel or dialogs.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const focus = document.activeElement;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (focus && focus !== document.body && (!chart.current?.contains(focus) || focus.closest("button,a,input,select,textarea,summary"))) return;
      const zoomIn = () => zoomAt(.5, .6), zoomOut = () => zoomAt(.5, 1 / .6);
      const keys: Record<string, () => void> = { "+": zoomIn, "=": zoomIn, "-": zoomOut, _: zoomOut, ArrowLeft: () => pan(-.15), ArrowRight: () => pan(.15),
        ArrowUp: () => lanesBox.current?.scrollBy({ top: -LANE_H }), ArrowDown: () => lanesBox.current?.scrollBy({ top: LANE_H }), PageUp: () => scrollLanes(-1), PageDown: () => scrollLanes(1),
        f: fit, n: () => centerOn(now), "]": () => step(1), "[": () => step(-1), Escape: () => { setSelected(""); setCluster(undefined); } };
      const action = keys[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (action) { event.preventDefault(); action(); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  });

  const axis = view ? ticks(view.start, view.end, width) : undefined;
  const nowX = view && now >= view.start && now <= view.end ? x(now) : undefined;
  // Day names share the top row with Now; one that would run into the next day or into Now is left out.
  const days = (axis?.days ?? []).map(day => ({ day, left: Math.max(0, x(day)) })).filter((entry, index, all) => entry.left < width - 60
    && (all[index + 1]?.left ?? Infinity) - entry.left >= 80 && (nowX === undefined || nowX < entry.left - 28 || nowX > entry.left + 70));
  const windowItem = items.find(item => item.id.startsWith("schedule:") && item.end);
  const extentOverview = useMemo(() => {
    const start = Math.min(extent.start, view?.start ?? extent.start), end = Math.max(extent.end, view?.end ?? extent.end, now);
    return { start, end: end > start ? end : start + 1 };
  }, [extent, view, now]);
  const ox = (t: number) => (t - extentOverview.start) / (extentOverview.end - extentOverview.start) * 100;
  const layerCounts = useMemo(() => new Map(layers.map(layer => [layer.id, (data?.items ?? []).filter(item => item.layer === layer.id).length])), [data]);
  const failed = (data?.failed ?? []).filter(source => !hidden.has(source.layer));
  const panel = selectedItem ?? (cluster ? cluster : undefined);
  const range = view ? rangeLabel(view) : ["…", ""];
  const toggleLayer = (id: LayerId) => setHidden(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return <div className="catalog-app timegraph-app">
    <AppFrame active="Timeline" data={data?.scope ? { ...data.health, scope: data.scope } : undefined} error={Boolean(error)} />
    <main className="tg-main">
      <div className="tg-toolbar">
        {modeSwitch}
        <div className="tg-segmented" role="group" aria-label="Group lanes by">{(["layer", "who"] as const).map(value => <button key={value} aria-pressed={group === value} onClick={() => setGroup(value)}>{value === "layer" ? "By layer" : "By who"}</button>)}</div>
        <details className="popover tg-layers-menu"><summary>Layers{hidden.size ? ` · ${layers.length - hidden.size} of ${layers.length}` : ""}</summary>
          <div className="popover-panel filter-panel tg-layer-panel">{layers.map(layer => <label key={layer.id} className={`layer-${layer.id}`} title={layer.hint}>
            <input type="checkbox" checked={!hidden.has(layer.id)} onChange={() => toggleLayer(layer.id)} /><span className="tg-swatch" aria-hidden="true" />
            <span>{layer.label}{failedBy.has(layer.id) && <small>{failedBy.get(layer.id)}</small>}</span><span className="tg-count">{layerCounts.get(layer.id) ?? 0}</span></label>)}
            <button className="text-button" disabled={!hidden.size} onClick={() => setHidden(new Set())}>Show all layers</button></div>
        </details>
        <span className="toolbar-spacer" />
        {actions}
      </div>
      {error && <div className="error-message" role="alert">{error} <button onClick={() => void load()}>Retry</button></div>}
      <div className={`tg-body ${panel ? "with-panel" : ""}`}>
        <div className="tg-chart" ref={chart} tabIndex={0} style={{ "--tg-gutter": `${gutter}px` } as CSSProperties}
          aria-label={`Timeline. Scroll to move through lanes and time, ${modKey} + scroll to zoom, drag to pan. Arrow keys move, brackets step through items.`}>
          <div className="tg-axis-row">
            <div className="tg-corner"><strong>{range[0]}</strong>{above > 0 ? <button className="tg-more" onClick={() => scrollLanes(-1)}>↑ {above} more lane{above === 1 ? "" : "s"}</button> : <span>{range[1]}</span>}</div>
            <svg className="tg-axis" width={width} height={AXIS_H} aria-hidden="true" onPointerDown={event => pointerDown(event, "axis")} {...dragHandlers} onDoubleClick={doubleClick}>
              {days.map(({ day, left }) => <text key={day} className="tg-day" x={left + 4} y={12}>{dayLabel(day)}</text>)}
              {axis?.values.map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={AXIS_H - 5} y2={AXIS_H} className="tg-tick" /><text x={x(t) + 3} y={AXIS_H - 8} className="tg-tick-label">{tickLabel(t, axis.step)}</text></g>)}
              {nowX !== undefined && <g className="tg-now"><line x1={nowX} x2={nowX} y1={AXIS_H - 7} y2={AXIS_H} /><text x={nowX + (nowX > width - 34 ? -26 : 4)} y={12}>Now</text></g>}
            </svg>
          </div>
          <div className="tg-lanes-frame">
            <div className="tg-lanes" ref={lanesBox} onScroll={event => { setScrollTop(event.currentTarget.scrollTop); setHover(undefined); }}>
              <div className="tg-lane-labels">{lanes.map(lane => <div key={lane.id} className={`tg-lane-label ${lane.id.startsWith("who:") ? "" : `layer-${lane.id}`} ${activeLane === lane.id ? "is-active" : ""}`} style={{ height: LANE_H }}
                title={`${lane.label} · ${lane.items.length} · ${lane.hint}${lane.note ? `\n${lane.note}` : ""}`}><strong>{lane.label}</strong><span>{lane.note && !lane.items.length ? "–" : lane.items.length}</span></div>)}</div>
              <div className="tg-plot" ref={plot} onPointerDown={event => pointerDown(event, "plot")} {...dragHandlers} onDoubleClick={doubleClick}>
                <svg width={width} height={plotH} role="img" aria-label={`${visibleItems.length} items between ${view ? fullTime(view.start) : ""} and ${view ? fullTime(view.end) : ""}`}>
                  {lanes.map((lane, index) => index % 2 ? <rect key={`band:${lane.id}`} className="tg-band" x={0} y={index * LANE_H} width={width} height={LANE_H} /> : null)}
                  {windowItem?.end && <rect className="tg-window" x={x(windowItem.at)} width={Math.max(0, x(windowItem.end) - x(windowItem.at))} y={0} height={plotH} />}
                  {axis?.values.map(t => <line key={t} className="tg-grid" x1={x(t)} x2={x(t)} y1={0} y2={plotH} />)}
                  {lanes.map((lane, index) => <line key={lane.id} className="tg-lane-rule" x1={0} x2={width} y1={(index + 1) * LANE_H - .5} y2={(index + 1) * LANE_H - .5} />)}
                  {lanes.map((lane, index) => lane.note && !lane.items.length ? <text key={`note:${lane.id}`} className="tg-lane-note" x={10} y={index * LANE_H + LANE_H / 2 + 4}>{lane.note}</text> : null)}
                  {lanes.map((lane, index) => lane.items.filter(item => item.end).map(item => {
                    const left = Math.max(-5, x(item.at)), right = Math.min(width + 5, x(item.end!)); if (right < 0 || left > width) return null;
                    const y = index * LANE_H + LANE_H / 2, schedule = item.id.startsWith("schedule:");
                    return <g key={`${item.id}:span`} className={`tg-span tone-${item.tone} ${schedule ? "is-window" : ""}`}>
                      <rect x={left} y={y - (schedule ? 8 : 2.5)} width={Math.max(2, right - left)} height={schedule ? 16 : 5} rx={schedule ? 4 : 2.5} />
                      {schedule && right - left > 90 && <text x={left + 8} y={y + 4}>{item.title}</text>}
                    </g>;
                  }))}
                  {selectedItem && relatedItems.map(item => { const from = position(selectedItem.id), to = position(item.id); if (!from || !to) return null;
                    const mid = (from.y + to.y) / 2; return <path key={`link:${item.id}`} className="tg-link" d={`M ${from.x} ${from.y} C ${from.x} ${mid}, ${to.x} ${mid}, ${to.x} ${to.y}`} />; })}
                  {marks.map((laneMarks, index) => laneMarks.map((mark, markIndex) => {
                    const y = index * LANE_H + LANE_H / 2, first = mark.items[0]!, single = mark.items.length === 1, diamond = first.id.startsWith("harness:") || first.id.startsWith("schedule:");
                    const isSelected = mark.items.some(item => item.id === selected), isRelated = mark.items.some(item => relatedIds.has(item.id));
                    const room = (laneMarks[markIndex + 1]?.x ?? width + 200) - mark.x - 16;
                    const label = single && room > 44 && mark.x >= 0 ? (first.title.length * 6.2 > room ? `${first.title.slice(0, Math.max(3, Math.floor(room / 6.2) - 1))}…` : first.title) : "";
                    return <g key={`${index}:${first.id}`} data-mark={single ? first.id : ""} className={`tg-mark tone-${first.tone} ${single ? "" : "is-cluster"} ${isSelected ? "is-selected" : ""} ${isRelated ? "is-related" : ""}`}
                      transform={`translate(${mark.x} ${y})`} onClick={() => openMark(mark)} onPointerEnter={() => showTip(mark, y)} onPointerLeave={() => setHover(undefined)}>
                      <rect className="tg-hit" x={-10} y={-10} width={20} height={20} />
                      {single ? diamond ? <path d="M 0 -6 L 6 0 L 0 6 L -6 0 Z" /> : <circle r={4.5} /> : <circle r={clusterRadius(mark.items.length)} />}
                      {!single && <text className="tg-count-label" y={3.5}>{mark.items.length}</text>}
                      {label && <text className="tg-label" x={9} y={4}>{label}</text>}
                    </g>;
                  }))}
                  {nowX !== undefined && <line className="tg-now-line" x1={nowX} x2={nowX} y1={0} y2={plotH} />}
                </svg>
                {!lanes.length && <p className="tg-empty">All layers are hidden. Turn one on under Layers.</p>}
              </div>
            </div>
            {above > 0 && <span className="tg-fade is-above" aria-hidden="true" />}
            {below > 0 && <span className="tg-fade is-below" aria-hidden="true" />}
          </div>
          {hover && <div className="tg-tooltip" style={{ left: hover.left, width: hover.width, top: hover.top, bottom: hover.bottom }} role="tooltip">
            {hover.items.slice(0, 6).map(item => <div key={item.id}><span>{shortTime(item.at)} · {layerOf.get(item.layer)?.label}</span>{item.title}</div>)}
            {hover.items.length > 6 && <div className="muted">and {hover.items.length - 6} more — click to {hover.items.length > 1 ? "zoom in or list them" : "open"}</div>}
          </div>}
          <div className="tg-overview">
            {below > 0 && <button className="tg-more is-below" onClick={() => scrollLanes(1)}>↓ {below} more lane{below === 1 ? "" : "s"}</button>}
            <div className="tg-overview-track" ref={track} aria-label="Overview. Drag the window to move through time, or pull an edge to zoom." onPointerDown={event => pointerDown(event, "overview")} {...dragHandlers}>
              {(data?.items ?? []).filter(item => !hidden.has(item.layer) && !item.id.startsWith("schedule:")).map(item => <span key={item.id} className={`tg-density tone-${item.tone}`}
                style={{ left: `${ox(item.at)}%`, top: `${3 + layers.findIndex(layer => layer.id === item.layer) * 4}px` }} />)}
              {now >= extentOverview.start && now <= extentOverview.end && <span className="tg-overview-now" style={{ left: `${ox(now)}%` }} />}
              {view && <span className="tg-brush" style={{ left: `${ox(view.start)}%`, width: `${Math.max(.6, ox(view.end) - ox(view.start))}%` }}>
                <span className="tg-brush-edge is-start" data-edge="start" title="Drag to change the start" /><span className="tg-brush-edge is-end" data-edge="end" title="Drag to change the end" /></span>}
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
      <footer className="tg-footer">
        <span>{loading && !data ? "Loading…" : `${visibleItems.filter(item => !item.id.startsWith("schedule:")).length} of ${items.filter(item => !item.id.startsWith("schedule:")).length} items in view`}{data?.truncated ? " · oldest activity not loaded" : ""}</span>
        {failed.map(source => <span key={source.layer} className="tg-warn" title={source.error}>{layerOf.get(source.layer)?.label} unavailable</span>)}
        <span>{loadedAt ? `Updated ${shortTime(loadedAt)}` : ""}<button className="text-button" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></span>
        <span className="toolbar-spacer" />
        <span className="tg-hint">Scroll to move · {modKey} + scroll or pinch to zoom · drag to pan · double-click zooms in</span>
        <div className="tg-nav" role="group" aria-label="Move through time">
          <button aria-label="Previous item" title="Previous item ( [ )" onClick={() => step(-1)}>‹</button><button aria-label="Next item" title="Next item ( ] )" onClick={() => step(1)}>›</button>
          <span className="tg-divider" aria-hidden="true" />
          <span className="tg-presets">{presets.map(preset => <button key={preset.label} aria-pressed={Math.abs(span - preset.span) < preset.span * .01} title={`Show ${preset.label === "Day" || preset.label === "Week" ? `a ${preset.label.toLowerCase()}` : preset.label}`}
            onClick={() => view && centerOn(Math.min((view.start + view.end) / 2, now), preset.span)}>{preset.label}</button>)}</span>
          <span className="tg-divider" aria-hidden="true" />
          <button aria-label="Zoom out" title="Zoom out ( − )" onClick={() => zoomAt(.5, 1 / .6)}>−</button><span className="tg-span-label" title="Visible time span">{view ? spanLabel(span) : "…"}</span><button aria-label="Zoom in" title="Zoom in ( + )" onClick={() => zoomAt(.5, .6)}>+</button>
          <button onClick={fit} title={`Fit everything (F) · Scroll to move · ${modKey} + scroll or pinch to zoom · Arrow keys move · [ ] step through items`}>Fit</button><button onClick={() => centerOn(now)} title="Centre on now (N)">Now</button>
        </div>
      </footer>
    </main>
  </div>;
}
