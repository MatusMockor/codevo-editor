import { useSpeechInputSelection } from "../../../application/useSpeechInput";
import type { SpeechInputSetting } from "../../../domain/speechDictationInputSetting";
import { useRemoteRunnerContext } from "../../remoteRunner/remoteRunnerContext";

export function useAgentDictationInput(stored: SpeechInputSetting | undefined): void {
  const selection = useRemoteRunnerContext()?.speechDictation?.input?.selection ?? null;
  useSpeechInputSelection(selection, stored);
}
