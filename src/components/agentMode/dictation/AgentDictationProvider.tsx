import { useMemo, type ReactNode } from "react";
import type { SpeechDictationPorts } from "../../../application/speechDictationPorts";
import { useStableSpeechServerIds } from "../../../application/useSpeechDictation";
import type { SpeechLanguage } from "../../../domain/speechDictation";
import { effectiveSpeechDictationLanguage } from "../../../domain/speechDictationLanguageSetting";
import {
  AgentDictationContext,
  systemLocale,
  type AgentDictationCommandPort,
  type AgentDictationEnvironment,
} from "./agentDictationContext";

export interface AgentDictationProviderProps {
  readonly ports: SpeechDictationPorts | null;
  readonly serverIds: readonly string[];
  readonly language: SpeechLanguage | undefined;
  readonly commands: AgentDictationCommandPort | null;
  readonly visible: boolean;
  readonly locale?: string;
  readonly children: ReactNode;
}

export function AgentDictationProvider({
  ports,
  serverIds,
  language,
  commands,
  visible,
  locale = systemLocale(),
  children,
}: AgentDictationProviderProps) {
  const effectiveLanguage = effectiveSpeechDictationLanguage(language, locale);
  const stableServerIds = useStableSpeechServerIds(serverIds);
  const value = useMemo<AgentDictationEnvironment | null>(() => {
    if (ports === null) return null;
    return { ports, serverIds: stableServerIds, language: effectiveLanguage, commands, visible };
  }, [ports, stableServerIds, effectiveLanguage, commands, visible]);
  return <AgentDictationContext.Provider value={value}>{children}</AgentDictationContext.Provider>;
}
