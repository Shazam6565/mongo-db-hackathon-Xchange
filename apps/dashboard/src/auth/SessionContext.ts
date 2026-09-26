import { createContext, useContext } from "react";
import type { Session } from "./session.js";

type ReadySession = Extract<Session, { authenticated: true }>;
export const SessionContext = createContext<ReadySession>({ authenticated: true, mode: "local" });
export const useSession = () => useContext(SessionContext);
// Mirrors the API's role check so the UI does not offer writes the server will refuse.
export const canWrite = (session: ReadySession) => session.mode === "local" || session.role === "writer" || session.role === "evaluator";
export const canEvaluate = (session: ReadySession) => session.mode === "local" || session.role === "evaluator";
