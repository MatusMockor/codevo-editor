import { createContext } from "react";
import type { AgentQuestionAttachmentsPort } from "../../../application/agentQuestionAttachments";

export const AgentQuestionAttachmentsContext = createContext<AgentQuestionAttachmentsPort | null>(
  null,
);
