import { useCallback, useEffect, useMemo, useState } from "react";

/** Table state lives in the address bar: search, facets, sort, page and the selected item survive reloads and links. */
export function useQuery() {
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
export function setFacet(query: URLSearchParams, facet: string, value: string, checked: boolean) {
  const values = new Set(query.getAll(facet)); if (checked) values.add(value); else values.delete(value);
  query.delete(facet); values.forEach(v => query.append(facet, v)); query.delete("page");
}
/** Closes open toolbar popovers on an outside pointer press or Escape. */
export function usePopoverDismiss() {
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
}
