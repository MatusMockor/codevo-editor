import { createContext } from "react";
import type { AgentElapsedTicker } from "./agentElapsedTicker";

export const AgentElapsedTickerContext = createContext<AgentElapsedTicker | null>(null);
