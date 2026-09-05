import { useCallback, useState, type KeyboardEvent } from "react";
import { shortcutFromKeyboardEvent, type KeymapCommandId } from "../../../domain/keymap";
import { shortcutStrokeFromKeyboardEvent } from "../../../domain/shortcutSequence";

export interface KeybindingRecording {
  readonly commandId: KeymapCommandId;
  readonly firstStroke: string | null;
  readonly value: string;
}

export interface KeybindingRecorder {
  readonly recording: KeybindingRecording | null;
  cancel(): void;
  capture(event: KeyboardEvent<HTMLInputElement>): void;
  recordingFor(commandId: KeymapCommandId): KeybindingRecording | null;
  save(): void;
  start(commandId: KeymapCommandId): void;
}

export type KeybindingCommit = (commandId: KeymapCommandId, shortcut: string) => void;

function isSafeBareFirstStroke(key: string): boolean {
  return /^F(?:[1-9]|1\d|2[0-4])$/iu.test(key);
}

export function useKeybindingRecorder(commit: KeybindingCommit): KeybindingRecorder {
  const [recording, setRecording] = useState<KeybindingRecording | null>(null);

  const cancel = useCallback(() => setRecording(null), []);

  const start = useCallback(
    (commandId: KeymapCommandId) => setRecording({ commandId, firstStroke: null, value: "" }),
    [],
  );

  const save = useCallback(() => {
    if (recording === null || recording.value === "") return;

    commit(recording.commandId, recording.value);
    setRecording(null);
  }, [commit, recording]);

  const capture = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (recording === null) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setRecording(null);
        return;
      }

      const captured = capturedStroke(event, recording.firstStroke);

      if (captured === null) return;

      event.preventDefault();
      event.stopPropagation();

      if (recording.firstStroke !== null) {
        setRecording({
          commandId: recording.commandId,
          firstStroke: null,
          value: `${recording.firstStroke} ${captured}`,
        });
        return;
      }

      setRecording({ commandId: recording.commandId, firstStroke: captured, value: captured });
    },
    [recording],
  );

  const recordingFor = useCallback(
    (commandId: KeymapCommandId) =>
      recording !== null && recording.commandId === commandId ? recording : null,
    [recording],
  );

  return { cancel, capture, recording, recordingFor, save, start };
}

function capturedStroke(
  event: KeyboardEvent<HTMLInputElement>,
  firstStroke: string | null,
): string | null {
  const stroke = shortcutStrokeFromKeyboardEvent(event);

  if (firstStroke !== null) {
    return stroke?.value ?? null;
  }

  const captured = shortcutFromKeyboardEvent(event);

  if (captured !== null) return captured;

  if (stroke !== null && isSafeBareFirstStroke(event.key)) return stroke.value;

  return null;
}
