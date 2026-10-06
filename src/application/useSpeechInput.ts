import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import {
  effectiveSpeechInputSetting,
  type SpeechInputSetting,
} from "../domain/speechDictationInputSetting";
import type {
  AudioInputDevicesPort,
  AudioInputDevicesSnapshot,
  SpeechInputSelectionPort,
} from "./speechDictationPorts";

const UNSUPPORTED: AudioInputDevicesSnapshot = { kind: "unsupported" };

export function useAudioInputDevices(
  port: AudioInputDevicesPort | null,
): AudioInputDevicesSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => (port === null ? unsubscribed : port.subscribe(listener)),
    [port],
  );
  const getSnapshot = useCallback(() => (port === null ? UNSUPPORTED : port.getSnapshot()), [port]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useSpeechInputSelection(
  port: SpeechInputSelectionPort | null,
  stored: SpeechInputSetting | undefined,
): void {
  useLayoutEffect(() => {
    port?.select(effectiveSpeechInputSetting(stored));
  }, [port, stored]);
}

function unsubscribed(): void {
  return undefined;
}
