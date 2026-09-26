import type { MouseEvent } from "react";
export function AppFrame({ active, data, error, onNavigate }: { active: "Catalog" | "Canvas" | "Timeline" | "Harness" | "About"; data?: { storage: string; storageLabel?: string; scope: { teamId: string; projectId: string } }; error?: boolean; onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  return <header className="app-frame"><a className="brand" href="/" onClick={onNavigate} aria-label="Team Memory catalog"><span className="brand-mark" aria-hidden="true">tm</span><span className="brand-name">Team Memory</span></a>
    <nav aria-label="Workspace">{(["Catalog", "Canvas", "Timeline", "Harness", "About"] as const).map(name => <a key={name} href={name === "Catalog" ? "/" : name === "About" ? "/about" : `/?view=${name.toLowerCase()}`} onClick={onNavigate} aria-current={active === name ? "page" : undefined}>{name}</a>)}</nav>
    {data && <span className="project-scope" title={`${data.scope.teamId} / ${data.scope.projectId}`}>{data.scope.projectId}</span>}
    <span className="storage-label" title={data?.storage === "memory" ? "Records reset when the API restarts." : "Database connection checked when this view loads or refreshes."}><span className={`storage-dot ${data && !error ? "connected" : ""}`} />{error ? "Connection issue" : !data ? "Connecting…" : data.storage === "memory" ? "Temporary storage" : data.storageLabel ?? "MongoDB"}</span>
  </header>;
}
