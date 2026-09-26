import { ActivityRecordSchema, type ActivityRecord } from "../../../../packages/contracts/src/activity.js";
import { AddActivity } from "../activity/AddActivity.js";
import { LessonSchema } from "@team-memory/contracts";
import { AppFrame } from "../AppFrame.js";
import { canWrite, useSession } from "../auth/SessionContext.js";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { TicketRecordSchema, type TicketRecord } from "../../../../packages/contracts/src/tickets.js";
import { AddTicket } from "./AddTicket.js";
import { ItemDetails } from "./ItemDetails.js";
import { errorMessage, loadCatalog, request } from "./api.js";
import { columns, defaultView, filterItems, itemKey, label, projectItems, readView, statuses, type CatalogItem, type ColumnId, type TableView } from "./model.js";
import "./catalog.css";

type Data = Awaited<ReturnType<typeof loadCatalog>>;
const pageSize = 20;
function useQuery() {
  const [search, setSearch] = useState(window.location.search);
  useEffect(() => { const changed = () => setSearch(window.location.search); window.addEventListener("popstate", changed); return () => window.removeEventListener("popstate", changed); }, []);
  const update = useCallback((change: (params: URLSearchParams) => void, replace = false) => {
    const params = new URLSearchParams(window.location.search); change(params);
    const next = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
    if (replace) window.history.replaceState(null, "", next); else window.history.pushState(null, "", next);
    setSearch(window.location.search);
  }, []);
  return { query: useMemo(() => new URLSearchParams(search), [search]), update };
}
function setFacet(query: URLSearchParams, facet: string, value: string, checked: boolean) {
  const values = new Set(query.getAll(facet)); if (checked) values.add(value); else values.delete(value);
  query.delete(facet); values.forEach(v => query.append(facet, v)); query.delete("page");
}

export function Catalog() {
  const writable = canWrite(useSession());
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      document.querySelectorAll<HTMLDetailsElement>("details.popover[open]").forEach(menu => { if (!menu.contains(target)) menu.open = false; });
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !(event.target instanceof Element)) return;
      const menu = event.target.closest<HTMLDetailsElement>("details.popover[open]");
      if (menu) { menu.open = false; menu.querySelector<HTMLElement>("summary")?.focus(); event.preventDefault(); }
    }
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, []);
  const [data, setData] = useState<Data>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addingActivity, setAddingActivity] = useState(false);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<TableView>(defaultView);
  const [extraItem, setExtraItem] = useState<CatalogItem>();
  const [detailError, setDetailError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const activityButton = useRef<HTMLButtonElement>(null);
  const { query, update } = useQuery();
  const selection = query.get("item");
  const storageKey = data ? `team-memory:catalog:v1:${encodeURIComponent(data.scope.teamId)}:${encodeURIComponent(data.scope.projectId)}` : null;

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    setLoading(true); setError("");
    try { const result = await loadCatalog(active.signal); if (!active.signal.aborted) { setData(result); setExtraItem(undefined); } }
    catch (failure) { if (!active.signal.aborted) setError(errorMessage(failure)); }
    finally { if (!active.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); return () => controller.current?.abort(); }, [refresh]);
  useEffect(() => {
    if (!storageKey) return;
    try { const value = JSON.parse(localStorage.getItem(storageKey) ?? "null"); setView(value?.version === 1 ? readView(value.view) : defaultView); }
    catch { setView(defaultView); }
  }, [storageKey]);
  function changeView(next: TableView) {
    setView(next);
    if (storageKey) try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, view: next })); }
    catch { setNotice("Column preferences could not be saved in this browser."); }
  }
  const items = useMemo(() => data ? projectItems(data.lessons, data.tickets, data.activity) : [], [data]);
  const matching = useMemo(() => filterItems(items, query), [items, query]);
  const selected = items.find(item => itemKey(item) === selection) ?? (extraItem && itemKey(extraItem) === selection ? extraItem : undefined);
  useEffect(() => {
    setDetailError("");
    if (!data || !selection || selected || loading) return;
    if (!/^(ticket|lesson|observation|decision|application|outcome|correction):/.test(selection)) { setDetailError("Unknown record type."); return; }
    const active = new AbortController();
    request(`/v1/${selection.startsWith("ticket:") ? "tickets" : selection.startsWith("lesson:") ? "lessons" : "activity"}/${encodeURIComponent(selection.slice(selection.indexOf(":") + 1))}`, { signal: active.signal })
      .then(value => { if (!active.signal.aborted) setExtraItem(selection.startsWith("ticket:") ? projectItems([], [TicketRecordSchema.parse(value)])[0] : selection.startsWith("lesson:") ? projectItems([LessonSchema.parse(value)], [])[0] : projectItems([], [], [ActivityRecordSchema.parse(value)])[0]); })
      .catch(failure => { if (!active.signal.aborted) setDetailError(errorMessage(failure)); });
    return () => active.abort();
  }, [data, selection, selected, loading]);
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));
  const rawPage = Number(query.get("page") ?? 1);
  const page = Math.min(pageCount, Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1);
  const shown = matching.slice((page - 1) * pageSize, page * pageSize);
  const visibleColumns = view.order.map(id => columns.find(column => column.id === id)!).filter(column => !view.hidden.includes(column.id));
  const sort = columns.find(column => column.id === query.get("sort"))?.id ?? "updatedAt";
  const order = query.get("order") === "asc" ? "asc" : "desc";
  const filtered = Boolean(query.get("q") || query.getAll("type").length || query.getAll("status").length);
  function clearFilters() { update(params => { ["q", "type", "status", "page"].forEach(key => params.delete(key)); }); }
  function closeDetails() {
    const link = selection ? document.getElementById(`item-${selection}`) : null;
    update(params => params.delete("item")); link?.focus();
  }
  function openItem(event: MouseEvent<HTMLAnchorElement>, item: CatalogItem) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); update(params => params.set("item", itemKey(item)));
  }
  function itemHref(item: CatalogItem) { const params = new URLSearchParams(query); params.set("item", itemKey(item)); return `?${params}`; }
  function saved(ticket: TicketRecord) {
    setAdding(false);
    setData(current => current ? { ...current, tickets: [ticket, ...current.tickets.filter(t => t.id !== ticket.id)].slice(0, 100) } : current);
    setNotice(`Added ${ticket.key}.`);
    update(params => { ["q", "type", "status", "page"].forEach(key => params.delete(key)); params.set("item", `ticket:${ticket.id}`); });
  }
  return <div className="catalog-app">
    <a className="skip-link" href="#catalog-content">Skip to catalog</a>
    <AppFrame active="Catalog" data={data} error={Boolean(error)} />
    <main id="catalog-content" className="catalog-main" tabIndex={-1}>
      <div className="catalog-toolbar">
        <label className="search-field"><span className="sr-only">Search recent items</span><span aria-hidden="true">⌕</span><input type="search" placeholder="Search recent items…" value={query.get("q") ?? ""} onChange={event => update(params => { if (event.target.value) params.set("q", event.target.value); else params.delete("q"); params.delete("page"); }, true)} /></label>
        <details className="popover"><summary>Type{query.getAll("type").length ? ` · ${query.getAll("type").length}` : ""}</summary><div className="popover-panel filter-panel">{["ticket", "lesson", "observation", "decision", "application", "outcome", "correction"].map(kind => <label key={kind}><input type="checkbox" checked={query.getAll("type").includes(kind)} onChange={event => update(params => setFacet(params, "type", kind, event.target.checked))} />{label(kind)}</label>)}</div></details>
        <details className="popover"><summary>Status{query.getAll("status").length ? ` · ${query.getAll("status").length}` : ""}</summary><div className="popover-panel filter-panel">{statuses.map(status => <label key={status}><input type="checkbox" checked={query.getAll("status").includes(status)} onChange={event => update(params => setFacet(params, "status", status, event.target.checked))} />{label(status)}</label>)}</div></details>
        <div className="toolbar-spacer" />
        <details className="popover columns-popover"><summary>Columns</summary><div className="popover-panel columns-panel">
          <div className="panel-heading"><strong>Columns</strong><button onClick={() => changeView(defaultView)}>Reset</button></div>
          <label className="wrap-toggle"><input type="checkbox" checked={view.wrap} onChange={event => changeView({ ...view, wrap: event.target.checked })} />Wrap text</label>
          {view.order.map((id, index) => { const column = columns.find(c => c.id === id)!; return <div className="column-setting" key={id}>
            <label><input type="checkbox" checked={!view.hidden.includes(id)} disabled={id === "title"} onChange={event => changeView({ ...view, hidden: event.target.checked ? view.hidden.filter(value => value !== id) : [...view.hidden, id] })} />{column.label}</label>
            <div className="column-moves">{([-1, 1] as const).map(direction => <button key={direction} className="icon-button" disabled={index + direction < 0 || index + direction >= view.order.length} aria-label={`Move ${column.label} ${direction === -1 ? "left" : "right"}`} onClick={() => { const next = [...view.order]; [next[index], next[index + direction]] = [next[index + direction]!, next[index]!]; changeView({ ...view, order: next }); }}>{direction === -1 ? "←" : "→"}</button>)}</div>
            <input type="range" aria-label={`${column.label} width`} min={100} max={600} step={10} value={view.widths[id] ?? column.width} onChange={event => changeView({ ...view, widths: { ...view.widths, [id]: Number(event.target.value) } })} />
          </div>; })}<p className="muted">Saved in this browser for this project.</p>
        </div></details>
        <button onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        {writable && <><button ref={activityButton} onClick={() => setAddingActivity(true)} disabled={!data || loading || Boolean(error)}>+ New record</button>
        <button ref={addButton} className="primary" onClick={() => setAdding(true)} disabled={!data || loading || Boolean(error)}>+ Add ticket</button></>}
      </div>
      {filtered && <div className="active-filters" aria-label="Active filters">
        {query.get("q") && <button onClick={() => update(params => { params.delete("q"); params.delete("page"); })}>Search: {query.get("q")} ×</button>}
        {["type", "status"].flatMap(facet => query.getAll(facet).map(value => <button key={`${facet}:${value}`} aria-label={`Remove ${label(value)} ${facet} filter`} onClick={() => update(params => setFacet(params, facet, value, false))}>{label(value)} ×</button>))}
        <button className="text-button" onClick={clearFilters}>Clear all</button>
      </div>}
      {notice && <div className="notice" role="status">{notice}<button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice("")}>×</button></div>}
      {error && <div className="error-message" role="alert">{error} <button onClick={() => void refresh()}>Retry</button></div>}
      <div className={`catalog-workspace ${selection ? "has-details" : ""}`}>
        <div className="catalog-table-area" aria-busy={loading}>
          <div className={`table-scroll ${view.wrap ? "" : "compact"}`} tabIndex={0} role="region" aria-label="Catalog records">
            <table style={{ width: visibleColumns.reduce((sum, col) => sum + (view.widths[col.id] ?? col.width), 0) }}>
              <caption className="sr-only">Recent catalog records</caption>
              <colgroup>{visibleColumns.map(col => <col key={col.id} style={{ width: view.widths[col.id] ?? col.width }} />)}</colgroup>
              <thead><tr>{visibleColumns.map(col => <th key={col.id} scope="col" aria-sort={sort === col.id ? order === "asc" ? "ascending" : "descending" : "none"}><button onClick={() => update(params => { params.set("sort", col.id); params.set("order", sort === col.id && order === "asc" ? "desc" : "asc"); params.delete("page"); })}>{col.label}<span aria-hidden="true">{sort === col.id ? order === "asc" ? " ↑" : " ↓" : ""}</span></button></th>)}</tr></thead>
              <tbody>{!error && shown.map(item => <tr key={itemKey(item)} className={selection === itemKey(item) ? "selected-row" : ""}>{visibleColumns.map(col => <td key={col.id}>
                {col.id === "title" ? <><a id={`item-${itemKey(item)}`} className="item-link" href={itemHref(item)} onClick={event => openItem(event, item)}>{item.title}</a>{item.record.kind === "lesson" && item.record.value.origin === "demo" && <span className="sample-label">Sample</span>}</> : <Cell item={item} column={col.id} />}
              </td>)}</tr>)}</tbody>
            </table>
            {!loading && !error && matching.length === 0 && <div className="empty-state"><strong>{filtered ? "No matching items" : "Your catalog is empty"}</strong><p>{filtered ? "Try another search or clear the filters." : writable ? "Add a ticket or observation to get started. Shared lessons will appear here too." : "Tickets, lessons and activity will appear here once teammates add them."}</p>{filtered ? <button onClick={clearFilters}>Clear filters</button> : writable && <button onClick={() => setAdding(true)}>Add ticket</button>}</div>}
            {loading && !data && <div className="empty-state" role="status">Loading catalog…</div>}
          </div>
          <footer className="table-footer"><span>{error ? "Catalog unavailable" : `${matching.length} ${filtered ? "matching" : "recent"} item${matching.length === 1 ? "" : "s"}`}</span><span className="window-note">Latest 100 tickets, lessons and activity</span><div className="pagination"><button aria-label="Previous page" disabled={page <= 1} onClick={() => update(params => params.set("page", String(page - 1)))}>←</button><span>{page} / {pageCount}</span><button aria-label="Next page" disabled={page >= pageCount} onClick={() => update(params => params.set("page", String(page + 1)))}>→</button></div></footer>
        </div>
        {selection && (selected && !error ? <ItemDetails item={selected} onClose={closeDetails} onEvaluated={() => void refresh()} /> : <aside className="item-details"><button onClick={closeDetails}>Close details</button><p role={detailError ? "alert" : "status"}>{error ? "Refresh the catalog to inspect this record." : detailError || "Loading record…"}</p></aside>)}
      </div>
    </main>
    {addingActivity && data && <AddActivity onClose={() => { setAddingActivity(false); activityButton.current?.focus(); }} onSaved={(record: ActivityRecord) => { setAddingActivity(false); setData(current => current ? { ...current, activity: [record, ...current.activity.filter(item => item.id !== record.id)].slice(0, 100) } : current); setNotice(`Added ${label(record.kind).toLowerCase()}.`); update(params => { ["q", "type", "status", "page"].forEach(key => params.delete(key)); params.set("item", `${record.kind}:${record.id}`); }); }} />}
    {adding && data && <AddTicket storage={data.storage} onClose={() => { setAdding(false); addButton.current?.focus(); }} onSaved={saved} />}
  </div>;
}
function Cell({ item, column }: { item: CatalogItem; column: ColumnId }) {
  switch (column) {
    case "kind": return <span className="type-label">{label(item.kind)}</span>;
    case "status": return <span className={`status status-${item.status}`}>{label(item.status)}</span>;
    case "appliesTo": return <span className="cell-text">{item.appliesTo.join(", ") || "—"}</span>;
    case "updatedAt": return <time dateTime={item.updatedAt} title={new Date(item.updatedAt).toLocaleString()}>{new Date(item.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time>;
    default: return <span className="cell-text">{item[column] || "—"}</span>;
  }
}
