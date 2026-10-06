import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { SpeechDictationState, SpeechLanguage } from "../domain/speechDictation";
import { SpeechDictationCoordinator } from "./speechDictationCoordinator";
import type { SpeechDictationMeter, SpeechDictationMeterStore } from "./speechDictationMeterStore";
import type { SpeechDictationPorts } from "./speechDictationPorts";

export type UseSpeechDictationOptions = Readonly<{
  ownerId: string;
  serverIds: readonly string[];
  language: SpeechLanguage;
  ports: SpeechDictationPorts;
  onTranscript: (text: string) => void;
}>;

export type SpeechDictationController = Readonly<{
  state: SpeechDictationState;
  meter: SpeechDictationMeterStore;
  start: () => void;
  stop: () => void;
  cancel: () => void;
}>;

export function useSpeechDictation(options: UseSpeechDictationOptions): SpeechDictationController {
  const { ownerId, language, onTranscript } = options;
  const { capture, transcriber } = options.ports;
  const serverIds = useStableSpeechServerIds(options.serverIds);
  const [initialBinding] = useState(() => ({ ownerId, serverIds, language, onTranscript }));
  const coordinator = useMemo(
    () => new SpeechDictationCoordinator({ capture, transcriber }, initialBinding),
    [capture, transcriber, initialBinding],
  );
  useLayoutEffect(() => {
    coordinator.bind({ ownerId, serverIds, language, onTranscript });
  }, [coordinator, ownerId, serverIds, language, onTranscript]);
  useLayoutEffect(() => coordinator.cancel, [coordinator]);
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getState);
  return useMemo(
    () => ({
      state,
      meter: coordinator.meter,
      start: coordinator.start,
      stop: coordinator.stop,
      cancel: coordinator.cancel,
    }),
    [coordinator, state],
  );
}

export function useStableSpeechServerIds(serverIds: readonly string[]): readonly string[] {
  const [stable, setStable] = useState(serverIds);
  if (sameServerIds(stable, serverIds)) return stable;
  setStable(serverIds);
  return serverIds;
}

function sameServerIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((serverId, index) => serverId === right[index]);
}

export function useSpeechDictationMeter(meter: SpeechDictationMeterStore): SpeechDictationMeter {
  return useSyncExternalStore(meter.subscribe, meter.getSnapshot);
}
