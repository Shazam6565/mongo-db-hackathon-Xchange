import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { Scope } from "@team-memory/contracts";
import { CanvasListSchema, type CanvasRecord } from "../../../../packages/contracts/src/canvas.js";
import { AppFrame } from "../AppFrame.js";
import { canWrite, useSession } from "../auth/SessionContext.js";
import { errorMessage, loadCatalog, request } from "../catalog/api.js";
import { projectItems } from "../catalog/model.js";
import { blankCanvas, CanvasEditor, type LeaveGuard } from "./CanvasEditor.js";
import { dropDraft, keepDraft, listDrafts, type LocalDraft } from "./drafts.js";
import "../catalog/catalog.css";
import "./canvas.css";

type Catalog = Awaited<ReturnType<typeof loadCatalog>>;
const openParam = () => new URLSearchParams(window.location.search).get("canvas") ?? "";
const canvasHref = (id?: string) => id ? `/?view=canvas&canvas=${encodeURIComponent(id)}` : "/?view=canvas";

export function CanvasApp() {
  const session = useSession();
  const writable = canWrite(session);
  const [scope, setScope] = useState<Scope>();
  const [canvases, setCanvases] = useState<CanvasRecord[]>();
  const [catalog, setCatalog] = useState<Catalog>();
  const [listError, setListError] = useState(""), [catalogError, setCatalogError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(openParam);
  const [drafts, setDrafts] = useState<LocalDraft[]>([]);
  const guard: LeaveGuard = useRef(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setListError("");
    const [list, records] = await Promise.allSettled([
      request("/v1/canvases", { signal }).then(value => CanvasListSchema.parse(value)),
      loadCatalog(signal ?? new AbortController().signal),
    ]);
    if (signal?.aborted) return;
    if (list.status === "fulfilled") { setScope(current => current?.teamId === list.value.scope.teamId && current.projectId === list.value.scope.projectId ? current : list.value.scope); setCanvases(list.value.canvases); }
    else setListError(errorMessage(list.reason));
    if (records.status === "fulfilled") {
      const mismatch = list.status === "fulfilled" && (records.value.scope.teamId !== list.value.scope.teamId || records.value.scope.projectId !== list.value.scope.projectId);
      if (mismatch) setCatalogError("Canvases and the catalog returned different projects. Refresh before placing records.");
      else { setCatalog(records.value); setCatalogError(""); }
    } else setCatalogError(errorMessage(records.reason));
    setLoading(false);
  }, []);
  useEffect(() => { const control = new AbortController(); void load(control.signal); return () => control.abort(); }, [load]);
  useEffect(() => { const changed = () => setOpenId(openParam()); window.addEventListener("popstate", changed); return () => window.removeEventListener("popstate", changed); }, []);
  useEffect(() => { if (scope && !openId) setDrafts(listDrafts(scope)); }, [scope, openId]);

  function open(id: string) { window.history.pushState(null, "", canvasHref(id)); setOpenId(id); }
  function close() { window.history.pushState(null, "", canvasHref()); setOpenId(""); void load(); }
  function create() {
    if (!scope) return;
    const id = crypto.randomUUID();
    keepDraft(scope, { id, baseRevision: 0, base: null, draft: blankCanvas() });
    open(id);
  }
  const records = useMemo(() => catalog ? projectItems(catalog.lessons, catalog.tickets) : undefined, [catalog]);
  return <div className="catalog-app canvas-app">
    <AppFrame active="Canvas" data={catalog} error={Boolean(listError || catalogError)} onNavigate={event => { const href = event.currentTarget.href; if (guard.current && !guard.current(() => window.location.assign(href))) event.preventDefault(); }} />
    {openId && scope ? <CanvasEditor key={openId} id={openId} scope={scope} records={records} recordsStatus={catalogError ? "Records unavailable" : "Records loading…"} writable={writable} guard={guard} onClose={close}
      onSaved={record => setCanvases(current => [record, ...(current ?? []).filter(item => item.id !== record.id)])} />
      : <CanvasGallery canvases={canvases} drafts={drafts} loading={loading} error={listError} writable={writable}
        onOpen={(event, id) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); open(id); }}
        onCreate={create} onRetry={() => void load()} onDropDraft={id => { if (scope) { dropDraft(scope, id); setDrafts(listDrafts(scope)); } }} />}
  </div>;
}

function CanvasGallery({ canvases, drafts, loading, error, writable, onOpen, onCreate, onRetry, onDropDraft }: {
  canvases?: CanvasRecord[]; drafts: LocalDraft[]; loading: boolean; error: string; writable: boolean;
  onOpen: (event: MouseEvent<HTMLAnchorElement>, id: string) => void; onCreate: () => void; onRetry: () => void; onDropDraft: (id: string) => void;
}) {
  const saved = new Set((canvases ?? []).map(item => item.id));
  const unsaved = drafts.filter(draft => !saved.has(draft.id) && draft.baseRevision === 0);
  const edited = new Set(drafts.map(draft => draft.id));
  const guides = (canvases ?? []).filter(item => item.canvas.kind === "guide").sort((a, b) => (a.canvas.order ?? 999) - (b.canvas.order ?? 999) || a.canvas.title.localeCompare(b.canvas.title));
  const boards = (canvases ?? []).filter(item => item.canvas.kind !== "guide");
  return <main className="canvas-home">
    <div className="canvas-home-heading">
      <div><h1>Canvases</h1><p className="muted">Shared maps of notes, tickets and lessons. People and agents edit the same documents; each save is a new revision.</p></div>
      {writable && <button className="primary" onClick={onCreate} disabled={!canvases}>+ New canvas</button>}
    </div>
    {error && <div className="error-message" role="alert">{error} <button onClick={onRetry}>Retry</button></div>}
    {!canvases && !error && <div className="empty-state" role="status">{loading ? "Loading canvases…" : "No canvases loaded."}</div>}
    {unsaved.length > 0 && <Section id="drafts" title="Not saved yet" count={unsaved.length} intro="New canvases kept only in this browser. Open one and save it to share it.">
      <ul className="canvas-cards">{unsaved.map(draft => <li key={draft.id} className="canvas-card is-draft">
        <a href={canvasHref(draft.id)} onClick={event => onOpen(event, draft.id)}><strong>{draft.draft.title || "Untitled canvas"}</strong><span className="card-text">{draft.draft.description || "No description yet."}</span><Counts canvas={draft.draft} /><span className="card-meta">Kept in this browser · {when(draft.keptAt)}</span></a>
        <button className="text-button" onClick={() => onDropDraft(draft.id)} aria-label={`Discard unsaved canvas ${draft.draft.title}`}>Discard</button>
      </li>)}</ul></Section>}
    {guides.length > 0 && <Section id="guides" title="Start here" count={guides.length} intro="Guides for people and agents joining this workspace. Read them in order.">
      <ol className="canvas-cards">{guides.map(item => <Card key={item.id} record={item} edited={edited.has(item.id)} onOpen={onOpen} />)}</ol></Section>}
    {canvases && <Section id="boards" title={guides.length ? "Team canvases" : "All canvases"} count={boards.length}>
      {boards.length ? <ul className="canvas-cards">{boards.map(item => <Card key={item.id} record={item} edited={edited.has(item.id)} onOpen={onOpen} />)}</ul>
        : <p className="muted">{writable ? "No working canvases yet. Create one to map a ticket, an investigation or a plan." : "No working canvases yet."}</p>}
    </Section>}
  </main>;
}
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
// Sections fold; which ones are folded is remembered in this browser.
const sectionsKey = "team-memory:canvas-sections:v1";
function foldedSections(): Record<string, boolean> {
  try { const value: unknown = JSON.parse(localStorage.getItem(sectionsKey) ?? "{}"); return value && typeof value === "object" ? value as Record<string, boolean> : {}; } catch { return {}; }
}
function Section({ id, title, count, intro, children }: { id: string; title: string; count: number; intro?: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => foldedSections()[id] !== false);
  return <details className="canvas-section" open={open} onToggle={event => {
    const next = event.currentTarget.open; setOpen(next);
    try { localStorage.setItem(sectionsKey, JSON.stringify({ ...foldedSections(), [id]: next })); } catch { /* not remembered */ }
  }}>
    <summary><h2>{title}</h2><span className="section-count">{count}</span>{intro && <span className="muted section-intro">{intro}</span>}</summary>
    {children}
  </details>;
}
function Card({ record, edited, onOpen }: { record: CanvasRecord; edited: boolean; onOpen: (event: MouseEvent<HTMLAnchorElement>, id: string) => void }) {
  const canvas = record.canvas;
  return <li className="canvas-card"><a href={canvasHref(record.id)} onClick={event => onOpen(event, record.id)}>
    <span className="card-top">{canvas.kind === "guide" && <span className="guide-badge">Guide{canvas.order ? ` ${canvas.order}` : ""}</span>}{edited && <span className="draft-badge">Unsaved changes</span>}</span>
    <strong>{canvas.title}</strong><span className="card-text">{canvas.description || "No description."}</span><Counts canvas={canvas} />
    <span className="card-meta">Rev {record.revision} · {record.editorLabel} · {when(record.updatedAt)}</span>
  </a></li>;
}
function Counts({ canvas }: { canvas: CanvasRecord["canvas"] }) {
  const notes = canvas.nodes.filter(node => node.kind === "note").length, placed = canvas.nodes.length - notes;
  const part = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return <span className="card-counts">{[part(notes, "note"), ...(placed ? [part(placed, "record")] : []), part(canvas.edges.length, "connection")].join(" · ")}</span>;
}
