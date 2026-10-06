import type {
  AudioInputDevicesSnapshot,
  AudioInputLockReason,
} from "../../application/speechDictationPorts";
import {
  SPEECH_INPUT_MAX_LISTED_DEVICES,
  SYSTEM_DEFAULT_SPEECH_INPUT,
  resolveSpeechInput,
  speechInputSettingForDevice,
  type SpeechInputDevice,
  type SpeechInputSetting,
} from "../../domain/speechDictationInputSetting";
import type { SettingsSelectOption } from "./primitives/SettingsSelect";

export type DictationMicrophoneRowModel =
  | Readonly<{ kind: "readout"; text: string; description: string }>
  | Readonly<{ kind: "access"; action: string; busy: boolean; description: string }>
  | Readonly<{
      kind: "select";
      options: readonly SettingsSelectOption[];
      value: string;
      disabled: boolean;
      description: string;
    }>;

type ReadySnapshot = Extract<AudioInputDevicesSnapshot, { kind: "ready" }>;
type LockedSnapshot = Extract<AudioInputDevicesSnapshot, { kind: "locked" }>;

export const DICTATION_MICROPHONE_DESCRIPTION = "Microphone used when dictating into the composer.";
export const SYSTEM_DEFAULT_MICROPHONE_LABEL = "System default";

const SYSTEM_DEFAULT_VALUE = "system-default";
const DEVICE_VALUE_PREFIX = "device:";
const SYSTEM_DEFAULT_OPTION: SettingsSelectOption = {
  label: SYSTEM_DEFAULT_MICROPHONE_LABEL,
  value: SYSTEM_DEFAULT_VALUE,
};
const LOCK_DESCRIPTIONS: Readonly<Record<AudioInputLockReason, string>> = {
  "permission-required": "Allow microphone access to choose a device.",
  "permission-denied":
    "Microphone access is blocked. Allow Codevo under Privacy & Security in System Settings, then try again.",
  "no-microphone": "No microphone found. Connect one, then try again.",
  "listing-failed": "Could not list microphones. Try again.",
};
const TRUNCATED_NOTE = `Showing the first ${SPEECH_INPUT_MAX_LISTED_DEVICES} microphones.`;

export function dictationMicrophoneRowModel(
  snapshot: AudioInputDevicesSnapshot,
  setting: SpeechInputSetting,
): DictationMicrophoneRowModel {
  switch (snapshot.kind) {
    case "unsupported":
      return {
        kind: "readout",
        text: "Not available",
        description: "Choosing a microphone is not available here.",
      };
    case "loading":
      return loadingModel(setting);
    case "locked":
      return lockedModel(snapshot, setting);
    case "ready":
      return readyModel(snapshot, setting);
    default:
      return unreachable(snapshot);
  }
}

export function dictationMicrophoneChoice(
  value: string,
  devices: readonly SpeechInputDevice[],
): SpeechInputSetting | null {
  if (value === SYSTEM_DEFAULT_VALUE) return SYSTEM_DEFAULT_SPEECH_INPUT;
  const device = devices.find((candidate) => deviceValue(candidate.id) === value);
  return device === undefined ? null : speechInputSettingForDevice(device);
}

function loadingModel(setting: SpeechInputSetting): DictationMicrophoneRowModel {
  return {
    kind: "select",
    options: [SYSTEM_DEFAULT_OPTION, ...savedOptions(setting)],
    value: settingValue(setting),
    disabled: true,
    description: DICTATION_MICROPHONE_DESCRIPTION,
  };
}

function lockedModel(
  snapshot: LockedSnapshot,
  setting: SpeechInputSetting,
): DictationMicrophoneRowModel {
  return {
    kind: "access",
    action: snapshot.reason === "permission-required" ? "Allow access" : "Try again",
    busy: snapshot.requesting,
    description: sentences(LOCK_DESCRIPTIONS[snapshot.reason], savedNote(setting)),
  };
}

function readyModel(
  snapshot: ReadySnapshot,
  setting: SpeechInputSetting,
): DictationMicrophoneRowModel {
  const resolution = resolveSpeechInput(setting, snapshot.devices);
  const options = [SYSTEM_DEFAULT_OPTION, ...snapshot.devices.map(deviceOption)];
  const truncated = snapshot.truncated ? TRUNCATED_NOTE : null;
  switch (resolution.kind) {
    case "system-default":
      return selectModel(
        options,
        SYSTEM_DEFAULT_VALUE,
        sentences(DICTATION_MICROPHONE_DESCRIPTION, truncated),
      );
    case "device":
      return selectModel(
        options,
        deviceValue(resolution.device.id),
        sentences(DICTATION_MICROPHONE_DESCRIPTION, truncated),
      );
    case "unavailable":
      return selectModel(
        [...options, unavailableOption(resolution.saved)],
        deviceValue(resolution.saved.id),
        sentences(unavailableNote(resolution.saved), truncated),
      );
    default:
      return unreachable(resolution);
  }
}

function selectModel(
  options: readonly SettingsSelectOption[],
  value: string,
  description: string,
): DictationMicrophoneRowModel {
  return { kind: "select", options, value, disabled: false, description };
}

function deviceOption(device: SpeechInputDevice): SettingsSelectOption {
  return { label: device.label, value: deviceValue(device.id) };
}

function savedOptions(setting: SpeechInputSetting): readonly SettingsSelectOption[] {
  return setting.kind === "device" ? [deviceOption(setting)] : [];
}

function unavailableOption(saved: SpeechInputDevice): SettingsSelectOption {
  return { disabled: true, label: `${saved.label} (not connected)`, value: deviceValue(saved.id) };
}

function unavailableNote(saved: SpeechInputDevice): string {
  return `${saved.label} is not connected. Dictation uses the system default until it is back.`;
}

function settingValue(setting: SpeechInputSetting): string {
  return setting.kind === "device" ? deviceValue(setting.id) : SYSTEM_DEFAULT_VALUE;
}

function savedNote(setting: SpeechInputSetting): string | null {
  return setting.kind === "device" ? `Dictation is set to ${setting.label}.` : null;
}

function deviceValue(id: string): string {
  return `${DEVICE_VALUE_PREFIX}${id}`;
}

function sentences(...parts: readonly (string | null)[]): string {
  return parts.filter((part) => part !== null).join(" ");
}

function unreachable(value: never): never {
  throw new TypeError(`Unsupported microphone row variant: ${JSON.stringify(value)}`);
}
