import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CanvasInputSchema, CanvasListSchema, CanvasResponseSchema, type CanvasInput, type CanvasRecord, type CanvasReference, type CanvasNode } from "../../../../packages/contracts/src/canvas.js";
import { AppFrame } from "../AppFrame.js";
import { errorMessage, loadCatalog, request } from "../catalog/api.js";
import { projectItems, itemKey } from "../catalog/model.js";
import "../catalog/catalog.css";
import "./canvas.css";

type Data = Awaited<ReturnType<typeof loadCatalog>>;
type Viewport = { x: number; y: number; zoom: number };
type Gesture = { pointer: number; startX: number; startY: number; viewport: Viewport; draft: CanvasInput; nodeId?: string };
const clamp = (v: number) => Math.min(10000, Math.max(-10000, Math.round(v)));
const colors = ["neutral", "sage", "blue", "amber"] as const;

export function CanvasApp() {
  const [data, setData] = useState<Data>();
  const [canvases, setCanvases] = useState<CanvasRecord[]>([]);
  const [id, setId] = useState(new URLSearchParams(window.location.search).get("canvas") ?? "");
  const [saved, setSaved] = useState<CanvasRecord>();
  const [draft, setDraft] = useState<CanvasInput>();
  const [references, setReferences] = useState<CanvasReference[]>([]);
  const [selected, setSelected] = useState("");
  const [viewport, setViewport] = useState<Viewport>({ x: 50, y: 60, zoom: 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState(false);
  const [notice, setNotice] = useState("");
  const [edgeTo, setEdgeTo] = useState("");
  const [edgeLabel, setEdgeLabel] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const space = useRef(false);
  const operation = useRef<{ body: string; key: string } | null>(null);
  const dirty = Boolean(draft && (!saved || JSON.stringify(draft) !== JSON.stringify(saved.canvas)));
  useEffect(() => { if (dirty) setNotice(""); }, [dirty]);
  const records = data ? projectItems(data.lessons, data.tickets) : [];
  const node = draft?.nodes.find(item => item.id === selected);
  const reference = (item: CanvasNode) => item.kind === "record" ? references.find(ref => ref.kind === item.ref.kind && ref.id === item.ref.id) : undefined;
  const nodeTitle = (item: CanvasNode) => item.kind === "note" ? item.title : reference(item)?.title ?? "Record unavailable";

  const refreshList = useCallback(async (signal?: AbortSignal) => {
    const [catalog, list] = await Promise.all([loadCatalog(signal ?? new AbortController().signal), request("/v1/canvases", { signal }).then(value => CanvasListSchema.parse(value))]);
    if (catalog.scope.teamId !== list.scope.teamId || catalog.scope.projectId !== list.scope.projectId) throw new Error("The canvas and catalog returned different projects.");
    if (!signal?.aborted) { setData(catalog); setCanvases(list.canvases); setConnectionError(false); }
  }, []);
  useEffect(() => {
    const control = new AbortController(); setBusy(true);
    refreshList(control.signal).catch(err => { if (!control.signal.aborted) { setError(errorMessage(err)); setConnectionError(true); } }).finally(() => { if (!control.signal.aborted) setBusy(false); });
    return () => control.abort();
  }, [refreshList]);
  useEffect(() => {
    if (!id) return;
    const control = new AbortController(); setBusy(true); setError("");
    request(`/v1/canvases/${encodeURIComponent(id)}`, { signal: control.signal }).then(value => {
      const result = CanvasResponseSchema.parse(value);
      if (!control.signal.aborted) { setSaved(result.record); setDraft(result.record.canvas); setReferences(result.references); }
    }).catch(err => { if (!control.signal.aborted) setError(errorMessage(err)); }).finally(() => { if (!control.signal.aborted) setBusy(false); });
    return () => control.abort();
  // Loading a chosen record must not replace edits when the catalog refreshes.
  }, [id]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  function cancelGesture() {
    const active = gesture.current; if (!active) return;
    gesture.current = null; setViewport(active.viewport); if (active.nodeId) setDraft(active.draft);
    if (stage.current?.hasPointerCapture(active.pointer)) stage.current.releasePointerCapture(active.pointer);
  }
  useEffect(() => {
    const up = (event: KeyboardEvent) => { if (event.code === "Space") space.current = false; };
    const blur = () => { space.current = false; cancelGesture(); };
    window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);
  function update(next: CanvasInput) { setDraft(next); setNotice(""); setDiscarding(false); }
  function patchNode(patch: Partial<CanvasNode>) { if (draft) update({ ...draft, nodes: draft.nodes.map(item => item.id === selected ? { ...item, ...patch } as CanvasNode : item) }); }
  function choose(next: string) {
    if (dirty) { setError("Save or discard this draft before opening another canvas."); return; }
    setSaved(undefined); setDraft(undefined); setSelected(""); setError(""); setNotice(""); setId(next);
    const url = new URL(window.location.href); if (next) url.searchParams.set("canvas", next); else url.searchParams.delete("canvas"); window.history.replaceState(null, "", url);
  }
  function newCanvas() {
    if (dirty) { setError("Save or discard this draft before creating another canvas."); return; }
    choose(""); setDraft({ title: "New canvas", description: "", nodes: [], edges: [] }); setViewport({ x: 50, y: 60, zoom: 1 });
    operation.current = null; newId.current = "";
  }
  async function refresh() {
    if (dirty) { setError("Save or discard this draft before refreshing. Your changes are still here."); return; }
    setBusy(true); setError("");
    try {
      await refreshList();
      if (id) { const result = CanvasResponseSchema.parse(await request(`/v1/canvases/${encodeURIComponent(id)}`)); setSaved(result.record); setDraft(result.record.canvas); setReferences(result.references); }
    } catch (err) { setError(errorMessage(err)); setConnectionError(true); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!draft || busy) return;
    const valid = CanvasInputSchema.safeParse(draft);
    if (!valid.success) { setError(valid.error.issues.map(issue => issue.message).join(" ")); return; }
    const body = JSON.stringify({ expectedRevision: saved?.revision ?? 0, canvas: valid.data });
    if (operation.current?.body !== body) operation.current = { body, key: crypto.randomUUID() };
    // Keep both identifiers for an uncertain response; a retry cannot create a second canvas.
    const target = id || newId.current || crypto.randomUUID(); newId.current = target;
    setBusy(true); setError("");
    try {
      const result = CanvasResponseSchema.parse(await request(`/v1/canvases/${target}`, { method: "PUT", headers: { "content-type": "application/json", "idempotency-key": operation.current.key }, body }));
      setSaved(result.record); setDraft(result.record.canvas); setReferences(result.references); setNotice(`Saved · revision ${result.record.revision}`); operation.current = null; newId.current = "";
      setCanvases(current => [result.record, ...current.filter(item => item.id !== target)].slice(0, 100));
      setId(target); const url = new URL(window.location.href); url.searchParams.set("canvas", target); window.history.replaceState(null, "", url);
    } catch (err) { setError(`${errorMessage(err)} Your draft remains open. Download it before discarding and refreshing to merge with the latest version.`); }
    finally { setBusy(false); }
  }
  const newId = useRef("");
  function add(kind: "note" | string) {
    if (!draft) return;
    const position = { id: crypto.randomUUID(), x: clamp((100 - viewport.x) / viewport.zoom), y: clamp((100 - viewport.y) / viewport.zoom), color: "neutral" as const };
    let added: CanvasNode;
    if (kind === "note") added = { ...position, kind: "note", title: "New note", text: "" };
    else {
      const record = records.find(item => itemKey(item) === kind); if (!record || (record.kind !== "ticket" && record.kind !== "lesson")) return;
      const recordKind = record.kind;
      added = { ...position, kind: "record", ref: { kind: recordKind, id: record.id } };
      setReferences(current => [...current.filter(ref => !(ref.kind === recordKind && ref.id === record.id)), { kind: recordKind, id: record.id, title: record.title, description: record.description, status: record.status }]);
    }
    update({ ...draft, nodes: [...draft.nodes, added] }); setSelected(added.id);
  }
  function start(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draft || busy || (event.button !== 0 && event.button !== 1)) return;
    const target = event.target as HTMLElement;
    if (target.closest("a,button,input,select,textarea")) return;
    const nodeId = !space.current && event.button === 0 ? target.closest<HTMLElement>("[data-node]")?.dataset.node : undefined;
    if (nodeId) setSelected(nodeId); else if (!space.current && event.button === 0) setSelected("");
    event.preventDefault(); stage.current?.focus();
    gesture.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, viewport: { ...viewport }, draft: structuredClone(draft), nodeId };
    stage.current?.setPointerCapture(event.pointerId);
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const active = gesture.current; if (!active || active.pointer !== event.pointerId) return;
    const dx = event.clientX - active.startX, dy = event.clientY - active.startY;
    if (!active.nodeId) setViewport({ ...active.viewport, x: active.viewport.x + dx, y: active.viewport.y + dy });
    else setDraft({ ...active.draft, nodes: active.draft.nodes.map(item => item.id === active.nodeId ? { ...item, x: clamp(item.x + dx / active.viewport.zoom), y: clamp(item.y + dy / active.viewport.zoom) } : item) });
  }
  function zoom(value: number) {
    const next = Math.max(.25, Math.min(2, value)); const bounds = stage.current?.getBoundingClientRect(); if (!bounds) return;
    const x = bounds.width / 2, y = bounds.height / 2;
    setViewport({ zoom: next, x: x - (x - viewport.x) * next / viewport.zoom, y: y - (y - viewport.y) * next / viewport.zoom });
  }
  function fit() {
    const bounds = stage.current?.getBoundingClientRect(); if (!bounds || !draft?.nodes.length) { setViewport({ x: 50, y: 60, zoom: 1 }); return; }
    const left = Math.min(...draft.nodes.map(item => item.x)), top = Math.min(...draft.nodes.map(item => item.y));
    const width = Math.max(...draft.nodes.map(item => item.x + 240)) - left, height = Math.max(...draft.nodes.map(item => item.y + 160)) - top;
    const z = Math.max(.25, Math.min(1, (bounds.width - 80) / width, (bounds.height - 80) / height));
    setViewport({ zoom: z, x: (bounds.width - width * z) / 2 - left * z, y: (bounds.height - height * z) / 2 - top * z });
  }
  return <div className="catalog-app canvas-app"><AppFrame active="Canvas" data={data} error={connectionError} onNavigate={event => { if (dirty) { event.preventDefault(); setError("Save or discard this draft before leaving the canvas."); } }} />
    <main className="canvas-main"><div className="canvas-toolbar">
      <select aria-label="Open canvas" value={id} disabled={busy} onChange={event => choose(event.target.value)}><option value="">{draft && !saved ? "Unsaved canvas" : "Choose a canvas"}</option>{canvases.map(item => <option key={item.id} value={item.id}>{item.canvas.title}</option>)}</select>
      <button onClick={newCanvas} disabled={!data || busy}>+ New canvas</button><div className="toolbar-spacer" />
      <button onClick={() => void refresh()} disabled={busy}>Refresh</button>
      {draft && <><button onClick={() => { const blob = new Blob([JSON.stringify({ expectedRevision: saved?.revision ?? 0, canvas: draft }, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `canvas-${id || "draft"}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download draft</button><button disabled={!dirty || busy} onClick={() => setDiscarding(true)}>Discard</button><button className="primary" disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Working…" : "Save"}</button></>}
    </div>
    {error && <div className="error-message" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError("")}>×</button></div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {discarding && <div className="notice" role="alert">Discard your unsaved changes?<span><button onClick={() => setDiscarding(false)}>Keep editing</button><button onClick={() => { setDraft(saved?.canvas); setDiscarding(false); setError(""); operation.current = null; newId.current = ""; }}>Discard changes</button></span></div>}
    {!draft ? <div className="empty-state"><strong>{busy ? "Loading canvas…" : "Connect tickets, ideas and lessons"}</strong><p>Open a shared canvas or create one. Agents can contribute to the same document.</p>{!busy && <button onClick={newCanvas} disabled={!data}>New canvas</button>}</div> : <>
      <div className="canvas-tools"><input aria-label="Canvas name" maxLength={80} value={draft.title} disabled={busy} onChange={event => update({ ...draft, title: event.target.value })} /><span className="muted">{dirty ? "Unsaved" : `Revision ${saved?.revision ?? 0}`}</span>
        <button disabled={busy || draft.nodes.length >= 100} onClick={() => add("note")}>+ Note</button>
        <select aria-label="Add record" value="" disabled={busy || draft.nodes.length >= 100} onChange={event => add(event.target.value)}><option value="">+ Record</option>{records.map(item => <option key={itemKey(item)} value={itemKey(item)}>{item.kind} · {item.title}</option>)}</select>
      </div>
      <div className={`canvas-workspace ${node ? "with-inspector" : ""}`}>
        <div ref={stage} className="canvas-stage" role="region" aria-label="Canvas drawing area" tabIndex={0} onPointerDown={start} onPointerMove={move} onPointerCancel={cancelGesture} onLostPointerCapture={() => { if (gesture.current) cancelGesture(); }} onPointerUp={event => { gesture.current = null; if (stage.current?.hasPointerCapture(event.pointerId)) stage.current.releasePointerCapture(event.pointerId); }} onKeyDown={event => {
          if ((event.target as HTMLElement).closest("a,button,input,textarea,select")) return;
          if (event.code === "Space") { event.preventDefault(); space.current = true; }
          if (event.key === "Escape") { event.preventDefault(); if (gesture.current) cancelGesture(); else setSelected(""); }
          if (node && !busy && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); const n = event.shiftKey ? 40 : 10; patchNode({ x: clamp(node.x + (event.key === "ArrowRight" ? n : event.key === "ArrowLeft" ? -n : 0)), y: clamp(node.y + (event.key === "ArrowDown" ? n : event.key === "ArrowUp" ? -n : 0)) }); }
        }}>
          <div className="canvas-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
            <svg className="canvas-edges" aria-label="Connections"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#879b90" /></marker></defs>{draft.edges.map(edge => {
              const a = draft.nodes.find(item => item.id === edge.from)!, b = draft.nodes.find(item => item.id === edge.to)!;
              const vertical = Math.abs(b.y - a.y) > Math.abs(b.x - a.x), forward = vertical ? b.y >= a.y : b.x >= a.x;
              const x1 = a.x + (vertical ? 120 : forward ? 240 : 0), y1 = a.y + (vertical ? forward ? 160 : 0 : 80);
              const x2 = b.x + (vertical ? 120 : forward ? 0 : 240), y2 = b.y + (vertical ? forward ? 0 : 160 : 80);
              const bend = forward ? 70 : -70;
              const path = vertical ? `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}` : `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
              return <g key={edge.id}><path d={path} fill="none" stroke="#879b90" strokeWidth="1.5" markerEnd="url(#arrow)" /><text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 9} textAnchor="middle">{edge.label}</text></g>;
            })}</svg>
            {draft.nodes.map(item => <article key={item.id} data-node={item.id} className={`canvas-node color-${item.color} ${selected === item.id ? "is-selected" : ""}`} style={{ left: item.x, top: item.y }} tabIndex={0} aria-label={nodeTitle(item)} onFocus={() => setSelected(item.id)}>
              <span className="node-kind">{item.kind === "note" ? "Note" : `${item.ref.kind} · ${reference(item)?.status ?? "unavailable"}`}</span><strong>{nodeTitle(item)}</strong><p>{item.kind === "note" ? item.text || "Add a thought…" : reference(item)?.description}</p>
              {item.kind === "record" && <a href={`/?item=${encodeURIComponent(`${item.ref.kind}:${item.ref.id}`)}`} onClick={event => { if (dirty) { event.preventDefault(); setError("Save or discard this draft before opening the record."); } }}>Open record ↗</a>}
            </article>)}
          </div>
          {!draft.nodes.length && <div className="canvas-hint">Add a note or a catalog record to begin.</div>}
        </div>
        {node && <aside className="canvas-inspector" aria-label="Selected placement"><div className="panel-heading"><strong>{node.kind === "note" ? "Note" : "Record placement"}</strong><button aria-label="Close placement details" onClick={() => setSelected("")}>×</button></div>
          <fieldset disabled={busy}>
            {node.kind === "note" ? <><label>Title<input maxLength={80} value={node.title} onChange={event => patchNode({ title: event.target.value })} /></label><label>Text<textarea rows={6} maxLength={2000} value={node.text} onChange={event => patchNode({ text: event.target.value })} /></label></> : <><strong>{nodeTitle(node)}</strong><p className="record-prose">{reference(node)?.description}</p><p className="muted">This placement refers to the catalog record. Its content is read from the database.</p></>}
            <label>Color<select value={node.color} onChange={event => patchNode({ color: event.target.value as CanvasNode["color"] })}>{colors.map(color => <option key={color}>{color}</option>)}</select></label>
            <div className="form-row">{(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input type="number" min={-10000} max={10000} value={node[axis]} onChange={event => patchNode({ [axis]: clamp(Number(event.target.value)) })} /></label>)}</div>
            <label>Connect to<select value={edgeTo} onChange={event => setEdgeTo(event.target.value)}><option value="">Choose a placement</option>{draft.nodes.filter(item => item.id !== node.id).map(item => <option key={item.id} value={item.id}>{nodeTitle(item)}</option>)}</select></label>
            <label>Connection label<input maxLength={80} value={edgeLabel} onChange={event => setEdgeLabel(event.target.value)} placeholder="e.g. informed" /></label>
            <button disabled={!draft.nodes.some(item => item.id === edgeTo && item.id !== node.id) || draft.edges.length >= 200} onClick={() => { update({ ...draft, edges: [...draft.edges, { id: crypto.randomUUID(), from: node.id, to: edgeTo, label: edgeLabel }] }); setEdgeTo(""); setEdgeLabel(""); }}>Add connection</button>
            {draft.edges.filter(edge => edge.from === node.id || edge.to === node.id).map(edge => <div className="connection-row" key={edge.id}><span>{edge.label || "Connection"}</span><button aria-label={`Remove connection ${edge.label || edge.id}`} onClick={() => update({ ...draft, edges: draft.edges.filter(item => item.id !== edge.id) })}>×</button></div>)}
            <button className="remove-placement" onClick={() => { update({ ...draft, nodes: draft.nodes.filter(item => item.id !== node.id), edges: draft.edges.filter(edge => edge.from !== node.id && edge.to !== node.id) }); setSelected(""); }}>Remove placement</button>
          </fieldset><p className="muted">Connections are authored relationships, not proof of causality.</p>
        </aside>}
      </div>
      <footer className="canvas-footer"><span>Drag to move · Space + drag to pan · Escape to cancel</span><div><button aria-label="Zoom out" onClick={() => zoom(viewport.zoom - .1)}>−</button><span>{Math.round(viewport.zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => zoom(viewport.zoom + .1)}>+</button><button onClick={fit}>Fit</button></div></footer>
    </>}
    </main>
  </div>;
}
