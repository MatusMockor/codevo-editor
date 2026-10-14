import { createContext } from "react";
import type { AgentThreadRequestFeed } from "../../application/agentThreadRequestPorts";

export const AgentThreadRequestFeedContext = createContext<AgentThreadRequestFeed | null>(null);
