export const SPEECH_INPUT_DEVICE_ID_MAX_LENGTH = 256;
export const SPEECH_INPUT_DEVICE_LABEL_MAX_LENGTH = 120;
export const SPEECH_INPUT_MAX_LISTED_DEVICES = 32;
export const SPEECH_INPUT_MAX_SCANNED_ENTRIES = 256;

export type SpeechInputDevice = Readonly<{ id: string; label: string }>;
export type SpeechInputDeviceSetting = Readonly<{ kind: "device"; id: string; label: string }>;
export type SpeechInputSetting = Readonly<{ kind: "system-default" }> | SpeechInputDeviceSetting;
export type SpeechDictationInputSetting = Readonly<{ speechDictationInput?: SpeechInputSetting }>;
export type SpeechInputDeviceListing = Readonly<{
  devices: readonly SpeechInputDevice[];
  truncated: boolean;
  concealed: boolean;
}>;
export type SpeechInputResolution =
  | Readonly<{ kind: "system-default" }>
  | Readonly<{ kind: "device"; device: SpeechInputDevice }>
  | Readonly<{ kind: "unavailable"; saved: SpeechInputDeviceSetting }>;

export const SYSTEM_DEFAULT_SPEECH_INPUT: SpeechInputSetting = { kind: "system-default" };

const SYSTEM_DEFAULT_KEYS: ReadonlySet<string> = new Set(["kind"]);
const DEVICE_KEYS: ReadonlySet<string> = new Set(["kind", "id", "label"]);
const PLATFORM_ALIAS_DEVICE_IDS: ReadonlySet<string> = new Set(["default", "communications"]);
const DEVICE_ID_PATTERN = /^[\x21-\x7e]+$/;
const LABEL_NOISE_PATTERN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu;
const LABEL_SCAN_LENGTH = SPEECH_INPUT_DEVICE_LABEL_MAX_LENGTH * 4;

export function parseSpeechInputDeviceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > SPEECH_INPUT_DEVICE_ID_MAX_LENGTH) return null;
  return DEVICE_ID_PATTERN.test(value) ? value : null;
}

export function normalizeSpeechInputLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.slice(0, LABEL_SCAN_LENGTH).replace(LABEL_NOISE_PATTERN, " ").trim();
  const bounded = Array.from(collapsed)
    .slice(0, SPEECH_INPUT_DEVICE_LABEL_MAX_LENGTH)
    .join("")
    .trim();
  return bounded.length === 0 ? null : bounded;
}

export function parseSpeechInputSetting(value: unknown): SpeechInputSetting | null {
  if (!isPlainRecord(value)) return null;
  if (value.kind === "system-default") {
    return hasOnlyKeys(value, SYSTEM_DEFAULT_KEYS) ? SYSTEM_DEFAULT_SPEECH_INPUT : null;
  }
  if (value.kind !== "device" || !hasOnlyKeys(value, DEVICE_KEYS)) return null;
  const id = parseSpeechInputDeviceId(value.id);
  const label = normalizeSpeechInputLabel(value.label);
  if (id === null || label === null || label !== value.label) return null;
  return { kind: "device", id, label };
}

export function normalizeSpeechDictationInputSetting(value: unknown): SpeechDictationInputSetting {
  const input = parseSpeechInputSetting(value);
  if (input === null) return {};
  return { speechDictationInput: input };
}

export function effectiveSpeechInputSetting(stored: unknown): SpeechInputSetting {
  return parseSpeechInputSetting(stored) ?? SYSTEM_DEFAULT_SPEECH_INPUT;
}

export function speechInputSettingForDevice(device: SpeechInputDevice): SpeechInputDeviceSetting {
  return { kind: "device", id: device.id, label: device.label };
}

export function listSpeechInputDevices(entries: readonly unknown[]): SpeechInputDeviceListing {
  const scanned = entries.slice(0, SPEECH_INPUT_MAX_SCANNED_ENTRIES).filter(isAudioInputEntry);
  const parsed = scanned.map(audioInputDevice);
  const found = new Map<string, SpeechInputDevice>();
  for (const device of parsed) {
    if (device !== null && !found.has(device.id)) found.set(device.id, device);
  }
  const devices = [...found.values()];
  return {
    devices: devices.slice(0, SPEECH_INPUT_MAX_LISTED_DEVICES).sort(compareDevices),
    truncated:
      entries.length > SPEECH_INPUT_MAX_SCANNED_ENTRIES ||
      devices.length > SPEECH_INPUT_MAX_LISTED_DEVICES,
    concealed: parsed.includes(null),
  };
}

export function resolveSpeechInput(
  setting: SpeechInputSetting,
  devices: readonly SpeechInputDevice[],
): SpeechInputResolution {
  if (setting.kind === "system-default") return { kind: "system-default" };
  const sameId = devices.find((device) => device.id === setting.id);
  if (sameId !== undefined) return { kind: "device", device: sameId };
  const sameLabel = devices.filter((device) => device.label === setting.label);
  const [only] = sameLabel;
  if (only !== undefined && sameLabel.length === 1) return { kind: "device", device: only };
  return { kind: "unavailable", saved: setting };
}

function isAudioInputEntry(entry: unknown): entry is Readonly<{ kind: "audioinput" }> {
  if (typeof entry !== "object" || entry === null) return false;
  return "kind" in entry && entry.kind === "audioinput";
}

function audioInputDevice(entry: object): SpeechInputDevice | null {
  const id = "deviceId" in entry ? parseSpeechInputDeviceId(entry.deviceId) : null;
  const label = "label" in entry ? normalizeSpeechInputLabel(entry.label) : null;
  if (id === null || label === null || PLATFORM_ALIAS_DEVICE_IDS.has(id)) return null;
  return { id, label };
}

function compareDevices(left: SpeechInputDevice, right: SpeechInputDevice): number {
  const byLabel = left.label.localeCompare(right.label, "en", {
    numeric: true,
    sensitivity: "base",
  });
  if (byLabel !== 0) return byLabel;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}
