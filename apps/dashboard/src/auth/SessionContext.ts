import { createContext, useContext } from "react";
import type { Session } from "./session.js";

export const SessionContext = createContext<Extract<Session, { authenticated: true }>>({ authenticated: true, mode: "local" });
export const useSession = () => useContext(SessionContext);
