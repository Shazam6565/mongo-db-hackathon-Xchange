import { createContext, useContext } from "react";
import type { Session } from "./session.js";

// A guest reads the shared workspace without signing in and cannot change it.
export type WorkspaceSession = Extract<Session, { authenticated: true }> | { authenticated: false; mode: "guest" };
export const SessionContext = createContext<WorkspaceSession>({ authenticated: true, mode: "local" });
export const useSession = () => useContext(SessionContext);
// Mirrors the API's role check so the UI does not offer writes the server will refuse.
export const canWrite = (session: WorkspaceSession) => session.mode === "local" || (session.mode === "team" && (session.role === "writer" || session.role === "evaluator"));
export const canEvaluate = (session: WorkspaceSession) => session.mode === "local" || (session.mode === "team" && session.role === "evaluator");
