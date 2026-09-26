import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import type { Scope } from "@team-memory/contracts";
import { CanvasInputSchema, CanvasResponseSchema, type CanvasInput, type CanvasNode, type CanvasRecord, type CanvasReference } from "../../../../packages/contracts/src/canvas.js";
import { mergeCanvas, sameContent, type CanvasMerge } from "../../../../packages/contracts/src/canvas-merge.js";
import { useSession } from "../auth/SessionContext.js";
import { ApiError, errorMessage, request } from "../catalog/api.js";
import type { CatalogItem } from "../catalog/model.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { dropDraft, keepDraft, readDraft, type LocalDraft } from "./drafts.js";

type Viewport = { x: number; y: number; zoom: number };
type Gesture = { pointer: number; startX: number; startY: number; viewport: Viewport; draft: CanvasInput; nodeId?: string; moved: boolean };
// base is the saved content the draft started from; it lets a later save combine with other writers.
type Doc = { saved?: CanvasRecord; baseRevision: number; base: CanvasInput | null; draft: CanvasInput; references: CanvasReference[] };
type Notice = { tone: "ok" | "warn"; text: string };
type Resolved = { title: string; description: string; status: string; key?: string };
export type LeaveGuard = MutableRefObject<((go: () => void) => boolean) | null>;

const NODE_W = 240, NODE_H = 160;
const clamp = (v: number) => Math.min(10000, Math.max(-10000, Math.round(v)));
const colors = ["neutral", "sage", "blue", "amber"] as const;
export const blankCanvas = (): CanvasInput => ({ title: "Untitled canvas", description: "", nodes: [], edges: [] });
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const list = (items: string[]) => items.length <= 3 ? items.join(", ") : `${items.slice(0, 3).join(", ")} and ${items.length - 3} more`;
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function CanvasEditor({ id, scope, records, recordsStatus, writable, onClose, onSaved, guard }: {
  id: string; scope: Scope; records?: CatalogItem[]; recordsStatus: string; writable: boolean;
  onClose: () => void; onSaved: (record: CanvasRecord) => void; guard: LeaveGuard;
}) {
  const session = useSession();
  const [doc, setDoc] = useState<Doc>();
  const [phase, setPhase] = useState<"loading" | "ready" | "missing" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false), [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(""), [retry, setRetry] = useState(false), [notice, setNotice] = useState<Notice>();
  const [kept, setKept] = useState(true), [denied, setDenied] = useState(false);
  const [ask, setAsk] = useState<"discard" | { leave: () => void } | null>(null);
  const [selected, setSelected] = useState(""), [flagged, setFlagged] = useState("");
  const [viewport, setViewport] = useState<Viewport>({ x: 50, y: 60, zoom: 1 });
  const [edgeTo, setEdgeTo] = useState(""), [edgeLabel, setEdgeLabel] = useState("");
  const stage = useRef<HTMLDivElement>(null), gesture = useRef<Gesture | null>(null), space = useRef(false);
  const operation = useRef<{ body: string; key: string } | null>(null);
  const fitted = useRef(false), closing = useRef(false);
  const editable = writable && !denied;
  const busy = saving || refreshing;
  const draft = doc?.draft;
  const dirty = Boolean(doc && (!doc.saved || !sameContent(doc.draft, doc.saved.canvas)));
  const node = draft?.nodes.find(item => item.id === selected);

  // Catalog records resolve placements the server has not returned yet, such as a record just added.
  const catalog = useMemo(() => new Map<string, Resolved>((records ?? []).flatMap(item => item.kind === "ticket" || item.kind === "lesson"
    ? [[`${item.kind}:${item.id}`, { title: item.title, description: item.description, status: item.status, key: item.kind === "ticket" ? item.reference : undefined }] as const] : [])), [records]);
  const resolve = useCallback((item: CanvasNode, references = doc?.references ?? []): Resolved | undefined => {
    if (item.kind !== "record") return undefined;
    const key = `${item.ref.kind}:${item.ref.id}`, known = catalog.get(key);
    const served = references.find(ref => ref.kind === item.ref.kind && ref.id === item.ref.id);
    return served ? { ...served, key: known?.key } : known;
  }, [catalog, doc?.references]);
  const titleOf = (item: CanvasNode, references?: CanvasReference[]) => item.kind === "note" ? item.title || "Untitled note" : resolve(item, references)?.title ?? "Record unavailable";
  const nameIn = (canvas: CanvasInput, references: CanvasReference[]) => (nodeId: string) => {
    const item = canvas.nodes.find(value => value.id === nodeId);
    return item ? `“${titleOf(item, references)}”` : "a placement";
  };

  // Keep unsaved work in this browser; the shared copy changes only on Save.
  const latest = useRef({ doc, dirty, editable });
  latest.current = { doc, dirty, editable };
  const flush = useCallback(() => {
    const { doc: current, dirty: changed, editable: canKeep } = latest.current;
    if (!current || !canKeep || closing.current) return true;
    if (!changed) { dropDraft(scope, id); return true; }
    const ok = keepDraft(scope, { id, baseRevision: current.baseRevision, base: current.base, draft: current.draft });
    setKept(ok); return ok;
  }, [id, scope]);
  useEffect(() => { if (!doc) return; const timer = setTimeout(flush, 250); return () => clearTimeout(timer); }, [doc, flush]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (latest.current.dirty && latest.current.editable && !flush()) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("pagehide", flush); window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("pagehide", flush); window.removeEventListener("beforeunload", unload); flush(); };
  }, [flush]);
  // Leaving is always allowed once the draft is kept. Only a browser that cannot keep it asks first.
  const allowLeave = useCallback((go: () => void) => {
    if (!latest.current.dirty || !latest.current.editable || flush()) return true;
    setAsk({ leave: go }); return false;
  }, [flush]);
  useEffect(() => { guard.current = allowLeave; return () => { guard.current = null; }; }, [allowLeave, guard]);

  function mergedNotice(lead: string, record: CanvasRecord, merged: CanvasMerge): Notice {
    const theirs = `${record.editorLabel}'s revision ${record.revision}${merged.theirs ? ` (${merged.theirs} change${merged.theirs === 1 ? "" : "s"})` : ""}`;
    const both = merged.conflicts.length ? ` You both changed ${list(merged.conflicts)}; your version is kept.` : "";
    return { tone: both ? "warn" : "ok", text: `${lead} ${theirs}.${both} Review, then save.` };
  }
  function restore(record: CanvasRecord, references: CanvasReference[], local: LocalDraft | null): { doc: Doc; notice?: Notice } {
    const clean: Doc = { saved: record, baseRevision: record.revision, base: record.canvas, draft: record.canvas, references };
    if (!local || sameContent(local.draft, record.canvas)) { if (local) dropDraft(scope, id); return { doc: clean }; }
    if (local.baseRevision === record.revision) return { doc: { ...clean, draft: local.draft }, notice: { tone: "ok", text: `Restored your unsaved changes from ${clock(local.keptAt)}. Save to share them, or discard them.` } };
    const merged = mergeCanvas(local.base ?? blankCanvas(), local.draft, record.canvas, nodeId => nameIn(local.draft.nodes.some(item => item.id === nodeId) ? local.draft : record.canvas, references)(nodeId));
    return { doc: { ...clean, draft: merged.canvas }, notice: mergedNotice(`Restored your unsaved changes from ${clock(local.keptAt)} and combined them with`, record, merged) };
  }

  useEffect(() => {
    const control = new AbortController();
    setPhase("loading"); setError(""); setNotice(undefined); fitted.current = false; closing.current = false;
    request(`/v1/canvases/${encodeURIComponent(id)}`, { signal: control.signal }).then(value => {
      const result = CanvasResponseSchema.parse(value);
      if (control.signal.aborted) return;
      const restored = restore(result.record, result.references, writable ? readDraft(scope, id) : null);
      setDoc(restored.doc); setNotice(restored.notice); setPhase("ready");
    }).catch(failure => {
      if (control.signal.aborted) return;
      const missing = failure instanceof ApiError && failure.status === 404;
      const local = missing && writable ? readDraft(scope, id) : null;
      if (local) {
        // A new canvas, or one whose saved copy is gone (for example temporary storage restarted).
        setDoc({ baseRevision: 0, base: null, draft: local.draft, references: [] }); setPhase("ready");
        if (local.baseRevision > 0) setNotice({ tone: "warn", text: "The saved copy of this canvas is no longer available. Your unsaved version is here; save it to recreate the canvas." });
      } else if (missing) setPhase("missing");
      else { setError(errorMessage(failure)); setPhase("failed"); }
    });
    return () => control.abort();
  // Reload only for a different canvas or an explicit retry; a catalog refresh must not replace edits.
  }, [id, scope.teamId, scope.projectId, writable, attempt]);

  useLayoutEffect(() => { if (phase === "ready" && !fitted.current && stage.current) { fitted.current = true; fit(); } });

  function change(next: CanvasInput) { setDoc(current => current && { ...current, draft: next }); setNotice(undefined); setFlagged(""); }
  function patchNode(patch: Partial<CanvasNode>) { if (draft) change({ ...draft, nodes: draft.nodes.map(item => item.id === selected ? { ...item, ...patch } as CanvasNode : item) }); }
  function problem(canvas: CanvasInput): { message: string; node?: string } | { valid: CanvasInput } {
    if (!canvas.title.trim()) return { message: "Name this canvas before saving." };
    const untitled = canvas.nodes.find(item => item.kind === "note" && !item.title.trim());
    if (untitled) return { message: "Every note needs a title. Add one to the highlighted note.", node: untitled.id };
    const unavailable = records && canvas.nodes.find(item => item.kind === "record" && !resolve(item));
    if (unavailable) return { message: "A placed record is no longer available in this project. Remove the highlighted placement to save.", node: unavailable.id };
    const parsed = CanvasInputSchema.safeParse(canvas);
    if (!parsed.success) { const issue = parsed.error.issues[0]; return { message: `This canvas can't be saved yet: ${issue?.message ?? "invalid content"}${issue?.path.length ? ` (${issue.path.join(".")})` : ""}.` }; }
    return { valid: parsed.data };
  }

  async function save(): Promise<boolean> {
    if (!doc || busy || !editable) return false;
    if (!dirty) { setNotice({ tone: "ok", text: "Nothing new to save." }); return true; }
    const check = problem(doc.draft);
    if ("message" in check) { setError(check.message); if (check.node) { setFlagged(check.node); setSelected(check.node); } return false; }
    return commit(doc, check.valid, false);
  }
  async function commit(current: Doc, canvas: CanvasInput, combined: boolean): Promise<boolean> {
    const body = JSON.stringify({ expectedRevision: current.baseRevision, canvas });
    // An identical retry reuses its key, so an uncertain response can never save twice.
    if (operation.current?.body !== body) operation.current = { body, key: crypto.randomUUID() };
    setSaving(true); setError(""); setRetry(false);
    try {
      const result = CanvasResponseSchema.parse(await request(`/v1/canvases/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json", "idempotency-key": operation.current.key, ...(session.mode === "local" ? { "x-engineer-id": "local-ui" } : {}) }, body }));
      operation.current = null; dropDraft(scope, id);
      setDoc({ saved: result.record, baseRevision: result.record.revision, base: result.record.canvas, draft: result.record.canvas, references: result.references });
      setNotice({ tone: "ok", text: combined ? `Saved revision ${result.record.revision}, combined with the other writer's changes.` : `Saved · revision ${result.record.revision}` });
      onSaved(result.record); return true;
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409 && !combined) {
        // Another writer saved first: combine both sets of changes instead of blocking.
        try {
          const latestSaved = CanvasResponseSchema.parse(await request(`/v1/canvases/${encodeURIComponent(id)}`));
          const merged = mergeCanvas(current.base ?? blankCanvas(), canvas, latestSaved.record.canvas, nodeId => nameIn(canvas.nodes.some(item => item.id === nodeId) ? canvas : latestSaved.record.canvas, latestSaved.references)(nodeId));
          const next: Doc = { saved: latestSaved.record, baseRevision: latestSaved.record.revision, base: latestSaved.record.canvas, draft: merged.canvas, references: latestSaved.references };
          setDoc(next);
          const valid = CanvasInputSchema.safeParse(merged.canvas);
          if (!merged.conflicts.length && valid.success) return await commit(next, valid.data, true);
          setNotice(mergedNotice("Someone saved while you were editing. Your changes were combined with", latestSaved.record, merged));
        } catch (inner) { setError(`${errorMessage(inner)} Your changes are kept in this browser.`); }
      } else if (failure instanceof ApiError && failure.status === 403) {
        setDenied(true); setError("This team credential can view canvases but not change them. Your changes stay in this browser; ask the owner for writer access.");
      } else { setError(`${errorMessage(failure)} ${kept ? "Your changes are kept in this browser; save again when the API is back." : "Save again before leaving this page."}`); setRetry(true); }
      return false;
    } finally { setSaving(false); }
  }
  async function refresh() {
    if (!doc || busy) return;
    setRefreshing(true); setError("");
    try {
      const result = CanvasResponseSchema.parse(await request(`/v1/canvases/${encodeURIComponent(id)}`));
      const record = result.record;
      if (!dirty) {
        setDoc({ saved: record, baseRevision: record.revision, base: record.canvas, draft: record.canvas, references: result.references });
        setNotice({ tone: "ok", text: record.revision === doc.baseRevision ? "Up to date." : `Loaded revision ${record.revision} by ${record.editorLabel}.` });
      } else if (record.revision === doc.baseRevision) {
        setDoc({ ...doc, saved: record, references: result.references });
        setNotice({ tone: "ok", text: "No one else has saved since you started. Your changes are still here." });
      } else {
        const merged = mergeCanvas(doc.base ?? blankCanvas(), doc.draft, record.canvas, nodeId => nameIn(doc.draft.nodes.some(item => item.id === nodeId) ? doc.draft : record.canvas, result.references)(nodeId));
        setDoc({ saved: record, baseRevision: record.revision, base: record.canvas, draft: merged.canvas, references: result.references });
        setNotice(mergedNotice("Combined your unsaved changes with", record, merged));
      }
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 404 && !doc.saved) setNotice({ tone: "ok", text: "This canvas has not been saved yet. Save to share it." });
      else setError(errorMessage(failure));
    } finally { setRefreshing(false); }
  }
  function discard() {
    setAsk(null); operation.current = null; dropDraft(scope, id); setError(""); setFlagged("");
    if (!doc?.saved) { closing.current = true; onClose(); return; }
    setDoc({ ...doc, draft: doc.saved.canvas, base: doc.saved.canvas, baseRevision: doc.saved.revision });
    setNotice({ tone: "ok", text: `Discarded your changes. Showing revision ${doc.saved.revision}.` });
  }
  function download() {
    if (!doc) return;
    const blob = new Blob([JSON.stringify({ expectedRevision: doc.baseRevision, canvas: doc.draft }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `canvas-${doc.draft.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "draft"}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function leaveTo(event: MouseEvent<HTMLAnchorElement>) {
    const href = event.currentTarget.href;
    if (!allowLeave(() => { closing.current = true; window.location.assign(href); })) event.preventDefault();
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); }
      if (event.code === "Space" && event.type === "keyup") space.current = false;
    };
    const blur = () => { space.current = false; cancelGesture(); };
    window.addEventListener("keydown", key); window.addEventListener("keyup", key); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("keyup", key); window.removeEventListener("blur", blur); };
  });

  function add(kind: string) {
    if (!draft || !editable) return;
    const bounds = stage.current?.getBoundingClientRect();
    const cx = bounds ? bounds.width / 2 - NODE_W / 2 * viewport.zoom : 100, cy = bounds ? bounds.height / 2 - NODE_H / 2 * viewport.zoom : 100;
    const offset = (draft.nodes.length % 5) * 24;
    const position = { id: crypto.randomUUID(), x: clamp((cx - viewport.x) / viewport.zoom + offset), y: clamp((cy - viewport.y) / viewport.zoom + offset), color: "neutral" as const };
    let added: CanvasNode;
    if (kind === "note") added = { ...position, kind: "note", title: "New note", text: "" };
    else {
      const [recordKind, recordId] = [kind.slice(0, kind.indexOf(":")), kind.slice(kind.indexOf(":") + 1)];
      if ((recordKind !== "ticket" && recordKind !== "lesson") || !catalog.has(kind)) return;
      added = { ...position, kind: "record", ref: { kind: recordKind, id: recordId }, color: recordKind === "ticket" ? "blue" : "sage" };
    }
    change({ ...draft, nodes: [...draft.nodes, added] }); setSelected(added.id);
  }
  function cancelGesture() {
    const active = gesture.current; if (!active) return;
    gesture.current = null; setViewport(active.viewport);
    if (active.nodeId && active.moved) setDoc(current => current && { ...current, draft: active.draft });
    if (stage.current?.hasPointerCapture(active.pointer)) stage.current.releasePointerCapture(active.pointer);
  }
  function start(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draft || (event.button !== 0 && event.button !== 1)) return;
    const target = event.target as HTMLElement;
    if (target.closest("a,button,input,select,textarea")) return;
    const nodeId = !space.current && event.button === 0 ? target.closest<HTMLElement>("[data-node]")?.dataset.node : undefined;
    if (nodeId) setSelected(nodeId); else if (!space.current && event.button === 0) setSelected("");
    event.preventDefault(); stage.current?.focus({ preventScroll: true });
    gesture.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, viewport: { ...viewport }, draft: structuredClone(draft), nodeId: editable && !busy ? nodeId : undefined, moved: false };
    stage.current?.setPointerCapture(event.pointerId);
  }
  function track(event: ReactPointerEvent<HTMLDivElement>) {
    const active = gesture.current; if (!active || active.pointer !== event.pointerId) return;
    const dx = event.clientX - active.startX, dy = event.clientY - active.startY;
    // A little movement during a click must not move a placement or mark the canvas as changed.
    if (!active.moved && Math.hypot(dx, dy) < 4) return;
    if (!active.moved && active.nodeId) { setNotice(undefined); setFlagged(""); }
    active.moved = true;
    const moving = active.nodeId;
    if (!moving) setViewport({ ...active.viewport, x: active.viewport.x + dx, y: active.viewport.y + dy });
    else setDoc(current => current && { ...current, draft: { ...active.draft, nodes: active.draft.nodes.map(item => item.id === moving ? { ...item, x: clamp(item.x + dx / active.viewport.zoom), y: clamp(item.y + dy / active.viewport.zoom) } : item) } });
  }
  function finish(event: ReactPointerEvent<HTMLDivElement>) {
    track(event); gesture.current = null;
    if (stage.current?.hasPointerCapture(event.pointerId)) stage.current.releasePointerCapture(event.pointerId);
  }
  function zoom(value: number) {
    const next = Math.max(.25, Math.min(2, value)); const bounds = stage.current?.getBoundingClientRect(); if (!bounds) return;
    const x = bounds.width / 2, y = bounds.height / 2;
    setViewport({ zoom: next, x: x - (x - viewport.x) * next / viewport.zoom, y: y - (y - viewport.y) * next / viewport.zoom });
  }
  function fit() {
    const bounds = stage.current?.getBoundingClientRect(), nodes = latest.current.doc?.draft.nodes ?? [];
    if (!bounds || !nodes.length) { setViewport({ x: 50, y: 60, zoom: 1 }); return; }
    const left = Math.min(...nodes.map(item => item.x)), top = Math.min(...nodes.map(item => item.y));
    const width = Math.max(...nodes.map(item => item.x + NODE_W)) - left, height = Math.max(...nodes.map(item => item.y + NODE_H)) - top;
    const z = Math.max(.25, Math.min(1, (bounds.width - 80) / width, (bounds.height - 80) / height));
    setViewport({ zoom: z, x: (bounds.width - width * z) / 2 - left * z, y: (bounds.height - height * z) / 2 - top * z });
  }

  if (phase !== "ready" || !doc || !draft) return <main className="canvas-main"><div className="canvas-toolbar"><button onClick={onClose}>← Canvases</button></div>
    <div className="empty-state" role={phase === "failed" ? "alert" : "status"}>{phase === "loading" ? "Opening canvas…" : phase === "missing" ? <><strong>This canvas is not available</strong><p>It may belong to another project, or it was never saved.</p><button onClick={onClose}>Back to canvases</button></> : <><strong>Could not open this canvas</strong><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>Retry</button></>}</div>
  </main>;

  const guide = draft.kind === "guide";
  const state = !editable ? "View only" : saving ? "Saving…" : !doc.saved ? "Not saved yet" : dirty ? kept ? "Unsaved · kept in this browser" : "Unsaved · save before leaving" : `Saved · revision ${doc.saved.revision}`;
  const stateDetail = [doc.saved && `Revision ${doc.saved.revision} saved by ${doc.saved.editorLabel} at ${clock(doc.saved.updatedAt)}.`,
    !editable ? (denied ? "This credential cannot change canvases." : "Your role can view canvases but not change them.") : dirty ? kept ? "Your changes are kept in this browser until you save or discard them." : "This browser cannot keep drafts; save before leaving." : ""].filter(Boolean).join(" ");
  const recordChoices = [...catalog.entries()].map(([key, value]) => ({ key, value, placed: draft.nodes.some(item => item.kind === "record" && `${item.ref.kind}:${item.ref.id}` === key) }));
  const connected = node ? draft.edges.filter(edge => edge.from === node.id || edge.to === node.id) : [];
  const nodeById = (nodeId: string) => draft.nodes.find(item => item.id === nodeId);
  return <main className="canvas-main">
    <div className="canvas-toolbar">
      <button onClick={() => { if (allowLeave(onClose)) onClose(); }} aria-label="Back to all canvases">← Canvases</button>
      {editable ? <input className="canvas-title" aria-label="Canvas name" maxLength={80} value={draft.title} disabled={busy} placeholder="Name this canvas" onChange={event => change({ ...draft, title: event.target.value })} /> : <h1 className="canvas-title">{draft.title}</h1>}
      {guide && <span className="guide-badge">Guide{draft.order ? ` ${draft.order}` : ""}</span>}
      <span className={`save-state ${!editable ? "is-view" : dirty ? kept ? "is-dirty" : "is-risk" : "is-saved"}`} role="status" title={stateDetail}>{state}</span>
      <div className="toolbar-spacer" />
      <button onClick={() => void refresh()} disabled={busy} title="Load the latest saved version. Unsaved changes are combined, not replaced.">{refreshing ? "Refreshing…" : "Refresh"}</button>
      {editable && <><button disabled={!dirty || busy} onClick={() => setAsk("discard")}>Discard</button>
        <button className="primary" disabled={!dirty || busy} onClick={() => void save()} title={`Save (${isMac ? "⌘" : "Ctrl+"}S)`}>{saving ? "Saving…" : "Save"}</button></>}
    </div>
    <div className="canvas-tools">
      {editable ? <textarea className="canvas-description" aria-label="Canvas purpose" rows={2} maxLength={2000} value={draft.description} disabled={busy} placeholder="What this canvas is for and how to read it, so others can use it" onChange={event => change({ ...draft, description: event.target.value })} />
        : <p className="canvas-description">{draft.description || "No description."}</p>}
      {editable && <>
        <label className="compact-field">Shown as<select value={guide ? "guide" : "board"} disabled={busy} onChange={event => { const { kind: _kind, order, ...rest } = draft; change(event.target.value === "guide" ? { ...rest, kind: "guide", order: order ?? 1 } : rest); }}><option value="board">Board</option><option value="guide">Guide</option></select></label>
        {guide && <label className="compact-field">Order<input type="number" min={1} max={999} value={draft.order ?? 1} disabled={busy} onChange={event => change({ ...draft, order: Math.min(999, Math.max(1, Math.round(Number(event.target.value) || 1))) })} /></label>}
        <button disabled={busy || draft.nodes.length >= 100} onClick={() => add("note")}>+ Note</button>
        <select aria-label="Place a catalog record" value="" disabled={busy || draft.nodes.length >= 100 || !records} onChange={event => add(event.target.value)}>
          <option value="">{records ? "+ Record" : recordsStatus}</option>
          {(["ticket", "lesson"] as const).map(kind => <optgroup key={kind} label={kind === "ticket" ? "Tickets" : "Lessons"}>{recordChoices.filter(choice => choice.key.startsWith(`${kind}:`)).map(choice => <option key={choice.key} value={choice.key} disabled={choice.placed}>{choice.value.key ? `${choice.value.key} · ` : ""}{choice.value.title}{kind === "lesson" ? ` (${choice.value.status})` : ""}{choice.placed ? " — placed" : ""}</option>)}</optgroup>)}
        </select>
      </>}
    </div>
    {error && <div className="error-message" role="alert">{error}{retry && !busy && editable && dirty && <button onClick={() => void save()}>Save again</button>}<button className="icon-button" aria-label="Dismiss error" onClick={() => setError("")}>×</button></div>}
    {notice && <div className={`notice ${notice.tone === "warn" ? "is-warn" : ""}`} role="status">{notice.text}<button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice(undefined)}>×</button></div>}
    <div className={`canvas-workspace ${node ? "with-inspector" : ""}`}>
      <div ref={stage} className={`canvas-stage ${editable ? "" : "is-view"}`} role="region" aria-label="Canvas drawing area" tabIndex={0} onPointerDown={start} onPointerMove={track} onPointerUp={finish} onPointerCancel={cancelGesture} onLostPointerCapture={() => { if (gesture.current) cancelGesture(); }} onKeyDown={event => {
        if ((event.target as HTMLElement).closest("a,button,input,textarea,select")) return;
        if (event.code === "Space") { event.preventDefault(); space.current = true; }
        if (event.key === "Escape") { event.preventDefault(); if (gesture.current) cancelGesture(); else setSelected(""); }
        if (node && editable && !busy && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); const n = event.shiftKey ? 40 : 10; patchNode({ x: clamp(node.x + (event.key === "ArrowRight" ? n : event.key === "ArrowLeft" ? -n : 0)), y: clamp(node.y + (event.key === "ArrowDown" ? n : event.key === "ArrowUp" ? -n : 0)) }); }
      }}>
        <div className="canvas-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
          <svg className="canvas-edges" aria-label="Connections"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#879b90" /></marker></defs>{draft.edges.map(edge => {
            const a = nodeById(edge.from), b = nodeById(edge.to); if (!a || !b) return null;
            const vertical = Math.abs(b.y - a.y) > Math.abs(b.x - a.x), forward = vertical ? b.y >= a.y : b.x >= a.x;
            const x1 = a.x + (vertical ? NODE_W / 2 : forward ? NODE_W : 0), y1 = a.y + (vertical ? forward ? NODE_H : 0 : NODE_H / 2);
            const x2 = b.x + (vertical ? NODE_W / 2 : forward ? 0 : NODE_W), y2 = b.y + (vertical ? forward ? 0 : NODE_H : NODE_H / 2);
            const bend = forward ? 70 : -70;
            const path = vertical ? `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}` : `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
            return <g key={edge.id}><path d={path} fill="none" stroke="#879b90" strokeWidth="1.5" markerEnd="url(#arrow)" /><text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 9} textAnchor="middle">{edge.label}</text></g>;
          })}</svg>
          {draft.nodes.map(item => { const ref = resolve(item), title = titleOf(item);
            // Cards have a fixed size; give the text the lines a one- or two-line title and the record link leave free.
            const lines = (item.kind === "record" && ref ? 3 : 5) - (title.length > 26 ? 1 : 0); return <article key={item.id} data-node={item.id} className={`canvas-node color-${item.color} ${selected === item.id ? "is-selected" : ""} ${flagged === item.id ? "is-flagged" : ""} ${item.kind === "record" && !ref ? "is-missing" : ""}`} style={{ left: item.x, top: item.y }} tabIndex={0} aria-label={title} onFocus={() => setSelected(item.id)}>
            <span className="node-kind">{item.kind === "note" ? "Note" : `${item.ref.kind}${ref?.key ? ` · ${ref.key}` : ""} · ${ref?.status.replaceAll("_", " ") ?? "unavailable"}`}</span><strong>{title}</strong><p style={{ WebkitLineClamp: lines }}>{item.kind === "note" ? item.text || (editable ? "Add a thought…" : "") : ref?.description ?? "This record is not available in this project."}</p>
            {item.kind === "record" && ref && <a href={`/?item=${encodeURIComponent(`${item.ref.kind}:${item.ref.id}`)}`} onClick={leaveTo}>Open record ↗</a>}
          </article>; })}
        </div>
        {!draft.nodes.length && <div className="canvas-hint">{editable ? "Add a note or place a catalog record to begin." : "This canvas is empty."}</div>}
      </div>
      {node && <aside className="canvas-inspector" aria-label="Selected placement"><div className="panel-heading"><strong>{node.kind === "note" ? "Note" : "Record placement"}</strong><button className="icon-button" aria-label="Close placement details" onClick={() => setSelected("")}>×</button></div>
        {editable ? <fieldset disabled={busy}>
          {node.kind === "note" ? <><label>Title<input maxLength={80} value={node.title} onChange={event => patchNode({ title: event.target.value })} placeholder="Required" aria-invalid={flagged === node.id && !node.title.trim()} /></label><label>Text<textarea rows={7} maxLength={2000} value={node.text} onChange={event => patchNode({ text: event.target.value })} /></label></>
            : <RecordSummary title={titleOf(node)} resolved={resolve(node)} href={`/?item=${encodeURIComponent(`${node.ref.kind}:${node.ref.id}`)}`} onOpen={leaveTo} />}
          <label>Color<select value={node.color} onChange={event => patchNode({ color: event.target.value as CanvasNode["color"] })}>{colors.map(color => <option key={color}>{color}</option>)}</select></label>
          <div className="form-row">{(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input type="number" min={-10000} max={10000} value={node[axis]} onChange={event => patchNode({ [axis]: clamp(Number(event.target.value)) })} /></label>)}</div>
          <label>Connect to<select value={edgeTo} onChange={event => setEdgeTo(event.target.value)}><option value="">Choose a placement</option>{draft.nodes.filter(item => item.id !== node.id).map(item => <option key={item.id} value={item.id}>{titleOf(item)}</option>)}</select></label>
          <label>Connection label<input maxLength={80} value={edgeLabel} onChange={event => setEdgeLabel(event.target.value)} placeholder="A verb, e.g. informs" /></label>
          <button disabled={!draft.nodes.some(item => item.id === edgeTo && item.id !== node.id) || draft.edges.length >= 200} onClick={() => { change({ ...draft, edges: [...draft.edges, { id: crypto.randomUUID(), from: node.id, to: edgeTo, label: edgeLabel.trim() }] }); setEdgeTo(""); setEdgeLabel(""); }}>Add connection</button>
          <Connections edges={connected} nodeId={node.id} name={nodeId => { const other = nodeById(nodeId); return other ? titleOf(other) : "Unknown"; }} onRemove={edgeId => change({ ...draft, edges: draft.edges.filter(item => item.id !== edgeId) })} />
          <button className="remove-placement" onClick={() => { change({ ...draft, nodes: draft.nodes.filter(item => item.id !== node.id), edges: draft.edges.filter(edge => edge.from !== node.id && edge.to !== node.id) }); setSelected(""); }}>Remove placement</button>
        </fieldset> : <div className="inspector-read">
          {node.kind === "note" ? <><h2>{titleOf(node)}</h2><p className="record-prose">{node.text || "No text."}</p></> : <RecordSummary title={titleOf(node)} resolved={resolve(node)} href={`/?item=${encodeURIComponent(`${node.ref.kind}:${node.ref.id}`)}`} onOpen={leaveTo} />}
          <Connections edges={connected} nodeId={node.id} name={nodeId => { const other = nodeById(nodeId); return other ? titleOf(other) : "Unknown"; }} />
        </div>}
        <p className="muted">Connections are authored relationships, not proof of causality.</p>
      </aside>}
    </div>
    <footer className="canvas-footer"><span>{editable ? `Drag to move · Space + drag to pan · Arrows nudge · ${isMac ? "⌘" : "Ctrl+"}S saves` : "Drag to pan · Select a card to read it in full"}</span><div><button className="text-button" onClick={download} title="Download this canvas as a write-canvas JSON file for agents">Download JSON</button><button aria-label="Zoom out" onClick={() => zoom(viewport.zoom - .1)}>−</button><span>{Math.round(viewport.zoom * 100)}%</span><button aria-label="Zoom in" onClick={() => zoom(viewport.zoom + .1)}>+</button><button onClick={fit}>Fit</button></div></footer>
    {ask === "discard" && <ConfirmDialog title="Discard unsaved changes?" cancelLabel="Keep editing" onCancel={() => setAsk(null)} actions={[{ label: doc.saved ? "Discard changes" : "Discard canvas", tone: "danger", onClick: discard }]}>
      <p>{doc.saved ? `“${doc.saved.canvas.title}” returns to revision ${doc.saved.revision}. The copy kept in this browser is removed too.` : `“${draft.title || "Untitled canvas"}” has never been saved. Discarding removes it from this browser.`}</p>
    </ConfirmDialog>}
    {ask && ask !== "discard" && <ConfirmDialog title="Leave without saving?" cancelLabel="Stay" busy={saving} onCancel={() => setAsk(null)} actions={[
      { label: "Leave without saving", tone: "danger", onClick: () => { const go = ask.leave; setAsk(null); closing.current = true; go(); } },
      { label: "Save and leave", tone: "primary", onClick: () => { const go = ask.leave; void save().then(ok => { setAsk(null); if (ok) { closing.current = true; go(); } }); } },
    ]}><p>This browser cannot keep unsaved drafts right now, so leaving would lose your changes to “{draft.title || "Untitled canvas"}”.</p></ConfirmDialog>}
  </main>;
}

function RecordSummary({ title, resolved, href, onOpen }: { title: string; resolved?: Resolved; href: string; onOpen: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  return <div className="record-summary"><h2>{title}</h2>
    {resolved ? <><p className="muted">{resolved.key ? `${resolved.key} · ` : ""}{resolved.status.replaceAll("_", " ")}</p><p className="record-prose">{resolved.description || "No description."}</p><a href={href} onClick={onOpen}>Open record ↗</a></>
      : <p className="muted">This record is not available in this project. Remove the placement to save the canvas.</p>}
    <p className="muted">Content comes from the catalog record and updates there, not here.</p>
  </div>;
}
function Connections({ edges, nodeId, name, onRemove }: { edges: CanvasInput["edges"]; nodeId: string; name: (id: string) => string; onRemove?: (id: string) => void }) {
  if (!edges.length) return null;
  return <div className="connection-list">{edges.map(edge => <div className="connection-row" key={edge.id}>
    <span>{edge.from === nodeId ? "→" : "←"} {name(edge.from === nodeId ? edge.to : edge.from)}{edge.label ? <span className="muted"> · {edge.label}</span> : null}</span>
    {onRemove && <button className="icon-button" aria-label={`Remove connection ${edge.label || edge.id}`} onClick={() => onRemove(edge.id)}>×</button>}
  </div>)}</div>;
}
