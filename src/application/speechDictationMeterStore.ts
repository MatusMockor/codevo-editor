export type SpeechDictationMeter = Readonly<{ level: number; elapsedMs: number }>;

export interface SpeechDictationMeterStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => SpeechDictationMeter;
}

export interface SpeechDictationMeterPublisher extends SpeechDictationMeterStore {
  readonly publish: (meter: SpeechDictationMeter) => void;
  readonly reset: () => void;
}

export const SILENT_SPEECH_DICTATION_METER: SpeechDictationMeter = { level: 0, elapsedMs: 0 };

export function notifyQuietly(listener: () => void): void {
  try {
    listener();
  } catch {
    return;
  }
}

export function createSpeechDictationMeterStore(): SpeechDictationMeterPublisher {
  const listeners = new Set<() => void>();
  let snapshot = SILENT_SPEECH_DICTATION_METER;
  const publish = (meter: SpeechDictationMeter): void => {
    if (meter.level === snapshot.level && meter.elapsedMs === snapshot.elapsedMs) return;
    snapshot = meter;
    for (const listener of [...listeners]) notifyQuietly(listener);
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    publish,
    reset: () => publish(SILENT_SPEECH_DICTATION_METER),
  };
}
