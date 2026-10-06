import { createContext, useContext } from "react";
import type { AgentViewCommandBridge } from "../../../application/agentViewCommandBridge";
import type { SpeechDictationPorts } from "../../../application/speechDictationPorts";
import type { SpeechLanguage } from "../../../domain/speechDictation";

export type AgentDictationCommandPort = Pick<AgentViewCommandBridge, "bindDictation">;

export type AgentDictationEnvironment = Readonly<{
  ports: SpeechDictationPorts;
  serverIds: readonly string[];
  language: SpeechLanguage;
  commands: AgentDictationCommandPort | null;
  visible: boolean;
}>;

export const AgentDictationContext = createContext<AgentDictationEnvironment | null>(null);

export function useAgentDictationEnvironment(): AgentDictationEnvironment | null {
  return useContext(AgentDictationContext);
}

export function systemLocale(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.language;
}
