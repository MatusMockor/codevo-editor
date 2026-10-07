import { describe, expect, it } from "vitest";
import { normalizeAppSettings } from "./settings";
import {
  SPEECH_INPUT_DEVICE_ID_MAX_LENGTH,
  SPEECH_INPUT_DEVICE_LABEL_MAX_LENGTH,
  SPEECH_INPUT_MAX_LISTED_DEVICES,
  SPEECH_INPUT_MAX_SCANNED_ENTRIES,
  SYSTEM_DEFAULT_SPEECH_INPUT,
  effectiveSpeechInputSetting,
  listSpeechInputDevices,
  normalizeSpeechDictationInputSetting,
  normalizeSpeechInputLabel,
  parseSpeechInputSetting,
  resolveSpeechInput,
  speechInputSettingForDevice,
  type SpeechInputSetting,
} from "./speechDictationInputSetting";

const STUDIO: SpeechInputSetting = { kind: "device", id: "studio-1", label: "Studio Mic" };

function entry(deviceId: unknown, label: unknown, kind: unknown = "audioinput") {
  return { kind, deviceId, label };
}

describe("speech input setting parsing", () => {
  it("accepts the system default and a bounded device identity", () => {
    expect(parseSpeechInputSetting({ kind: "system-default" })).toEqual(
      SYSTEM_DEFAULT_SPEECH_INPUT,
    );
    expect(
      parseSpeechInputSetting({ kind: "device", id: "studio-1", label: "Studio Mic" }),
    ).toEqual(STUDIO);
  });

  it.each([
    null,
    undefined,
    7,
    "studio-1",
    ["device"],
    {},
    { kind: "speaker" },
    { kind: "system-default", id: "studio-1" },
    { kind: "device" },
    { kind: "device", id: "studio-1" },
    { kind: "device", id: "", label: "Studio Mic" },
    { kind: "device", id: 7, label: "Studio Mic" },
    { kind: "device", id: "studio 1", label: "Studio Mic" },
    { kind: "device", id: "studio\u00001", label: "Studio Mic" },
    { kind: "device", id: "x".repeat(SPEECH_INPUT_DEVICE_ID_MAX_LENGTH + 1), label: "Studio Mic" },
    { kind: "device", id: "studio-1", label: "" },
    { kind: "device", id: "studio-1", label: "   " },
    { kind: "device", id: "studio-1", label: " Studio Mic" },
    { kind: "device", id: "studio-1", label: "Studio\nMic" },
    { kind: "device", id: "studio-1", label: 7 },
    {
      kind: "device",
      id: "studio-1",
      label: "x".repeat(SPEECH_INPUT_DEVICE_LABEL_MAX_LENGTH + 1),
    },
    { kind: "device", id: "studio-1", label: "Studio Mic", groupId: "group-1" },
  ])("rejects the malformed value %j", (value) => {
    expect(parseSpeechInputSetting(value)).toBeNull();
    expect(normalizeSpeechDictationInputSetting(value)).toEqual({});
    expect(effectiveSpeechInputSetting(value)).toEqual(SYSTEM_DEFAULT_SPEECH_INPUT);
  });

  it("rejects a value that is not a plain record", () => {
    class Device {
      readonly kind = "device";
      readonly id = "studio-1";
      readonly label = "Studio Mic";
    }

    expect(parseSpeechInputSetting(new Device())).toBeNull();
  });

  it("keeps a valid device through app settings normalization and drops a malformed one", () => {
    expect(normalizeAppSettings({ speechDictationInput: STUDIO }).speechDictationInput).toEqual(
      STUDIO,
    );
    expect(
      normalizeAppSettings({ speechDictationInput: { kind: "device", id: "studio-1" } }),
    ).not.toHaveProperty("speechDictationInput");
    expect(normalizeAppSettings({})).not.toHaveProperty("speechDictationInput");
  });
});

describe("speech input label normalization", () => {
  it("collapses whitespace and control characters and bounds the length", () => {
    expect(normalizeSpeechInputLabel("  Studio\t\u0000 Mic\n")).toBe("Studio Mic");
    expect(normalizeSpeechInputLabel("x".repeat(500))).toHaveLength(
      SPEECH_INPUT_DEVICE_LABEL_MAX_LENGTH,
    );
    expect(normalizeSpeechInputLabel("\u0000 \n")).toBeNull();
    expect(normalizeSpeechInputLabel(7)).toBeNull();
  });

  it("does not split a surrogate pair at the bound", () => {
    const label = normalizeSpeechInputLabel("🎤".repeat(SPEECH_INPUT_DEVICE_LABEL_MAX_LENGTH + 5));

    expect(Array.from(label ?? "")).toHaveLength(SPEECH_INPUT_DEVICE_LABEL_MAX_LENGTH);
    expect(label?.endsWith("🎤")).toBe(true);
  });
});

describe("speech input device listing", () => {
  it("lists labelled audio inputs by label and ignores other kinds and platform aliases", () => {
    const listing = listSpeechInputDevices([
      entry("camera-1", "FaceTime HD Camera", "videoinput"),
      entry("studio-1", "Studio Mic"),
      entry("default", "Default - Studio Mic"),
      entry("communications", "Communications - Studio Mic"),
      entry("built-in-1", "MacBook Pro Microphone"),
      entry("speaker-1", "Speakers", "audiooutput"),
      entry("studio-1", "Studio Mic"),
      null,
      "studio-2",
    ]);

    expect(listing.devices).toEqual([
      { id: "built-in-1", label: "MacBook Pro Microphone" },
      { id: "studio-1", label: "Studio Mic" },
    ]);
    expect(listing.truncated).toBe(false);
  });

  it("reports concealed inputs instead of listing blank entries", () => {
    expect(listSpeechInputDevices([entry("", "")])).toEqual({
      devices: [],
      truncated: false,
      concealed: true,
    });
    expect(listSpeechInputDevices([entry("studio-1", "")]).concealed).toBe(true);
    expect(listSpeechInputDevices([entry("", "Studio Mic")]).devices).toEqual([]);
  });

  it("reports no concealed inputs when there is no audio input at all", () => {
    expect(listSpeechInputDevices([entry("camera-1", "Camera", "videoinput")])).toEqual({
      devices: [],
      truncated: false,
      concealed: false,
    });
  });

  it("caps the listed devices and says so", () => {
    const entries = Array.from({ length: SPEECH_INPUT_MAX_LISTED_DEVICES + 3 }, (_, index) =>
      entry(`mic-${index}`, `Microphone ${index}`),
    );
    const listing = listSpeechInputDevices(entries);

    expect(listing.devices).toHaveLength(SPEECH_INPUT_MAX_LISTED_DEVICES);
    expect(listing.truncated).toBe(true);
    expect(
      listSpeechInputDevices(entries.slice(0, SPEECH_INPUT_MAX_LISTED_DEVICES)).truncated,
    ).toBe(false);
  });

  it("bounds the scanned entries", () => {
    const entries = Array.from({ length: SPEECH_INPUT_MAX_SCANNED_ENTRIES + 1 }, () =>
      entry("camera-1", "Camera", "videoinput"),
    );
    entries.push(entry("studio-1", "Studio Mic"));

    expect(listSpeechInputDevices(entries)).toEqual({
      devices: [],
      truncated: true,
      concealed: false,
    });
  });

  it("bounds listed labels", () => {
    const [device] = listSpeechInputDevices([entry("studio-1", "x".repeat(900))]).devices;

    expect(device?.label).toHaveLength(SPEECH_INPUT_DEVICE_LABEL_MAX_LENGTH);
  });
});

describe("speech input resolution", () => {
  const devices = [
    { id: "built-in-1", label: "MacBook Pro Microphone" },
    { id: "studio-1", label: "Studio Mic" },
  ];

  it("resolves the system default without looking at devices", () => {
    expect(resolveSpeechInput(SYSTEM_DEFAULT_SPEECH_INPUT, [])).toEqual({ kind: "system-default" });
  });

  it("prefers the saved id over the label", () => {
    const saved: SpeechInputSetting = { kind: "device", id: "studio-1", label: "Old name" };

    expect(resolveSpeechInput(saved, devices)).toEqual({ kind: "device", device: devices[1] });
  });

  it("re-identifies a device whose id changed by its exact label", () => {
    const saved: SpeechInputSetting = { kind: "device", id: "studio-old", label: "Studio Mic" };

    expect(resolveSpeechInput(saved, devices)).toEqual({ kind: "device", device: devices[1] });
  });

  it("does not guess between devices sharing the saved label", () => {
    const saved: SpeechInputSetting = { kind: "device", id: "usb-old", label: "USB Audio" };
    const twins = [
      { id: "usb-1", label: "USB Audio" },
      { id: "usb-2", label: "USB Audio" },
    ];

    expect(resolveSpeechInput(saved, twins)).toEqual({ kind: "unavailable", saved });
  });

  it("reports a missing device as unavailable", () => {
    const saved: SpeechInputSetting = { kind: "device", id: "gone-1", label: "Gone Mic" };

    expect(resolveSpeechInput(saved, devices)).toEqual({ kind: "unavailable", saved });
    expect(resolveSpeechInput(saved, [])).toEqual({ kind: "unavailable", saved });
  });

  it("builds a device setting from a listed device", () => {
    expect(speechInputSettingForDevice({ id: "studio-1", label: "Studio Mic" })).toEqual(STUDIO);
  });
});
