import { describe, expect, it } from "vitest";
import {
  canStartSpeechDictation,
  defaultSpeechLanguage,
  initialSpeechDictationState,
  isSpeechDictationActive,
  parseSpeechLanguage,
  reduceSpeechDictation,
  speechDictationAvailability,
  type SpeechDictationEvent,
  type SpeechDictationState,
} from "./speechDictation";

const run = (state: SpeechDictationState, ...events: SpeechDictationEvent[]) =>
  events.reduce(reduceSpeechDictation, state);
const idle: SpeechDictationState = { kind: "idle" };
const recording = run(idle, { type: "start" }, { type: "capture-ready" });

describe("speech language", () => {
  it.each(["sk", "en", "cs"])("parses the closed language %s", (language) => {
    expect(parseSpeechLanguage(language)).toBe(language);
  });
  it.each(["SK", "de", "", " sk", null, undefined, 1, {}, ["sk"]])(
    "rejects unsupported language %j",
    (language) => {
      expect(parseSpeechLanguage(language)).toBeNull();
    },
  );
  it.each([
    ["sk", "sk"],
    ["sk-SK", "sk"],
    ["SK_sk", "sk"],
    ["cs-CZ", "cs"],
    ["cs", "cs"],
    ["en-US", "en"],
    ["en", "en"],
    ["de-DE", "en"],
    ["skx", "en"],
    ["", "en"],
    ["  cs-CZ ", "cs"],
  ])("defaults locale %j to %s", (locale, language) => {
    expect(defaultSpeechLanguage(locale)).toBe(language);
  });
});

describe("speech dictation availability", () => {
  it("reports missing microphone capture before a missing server", () => {
    expect(speechDictationAvailability({ captureSupported: false, serverId: null })).toEqual({
      kind: "unavailable",
      reason: "capture-unsupported",
    });
    expect(speechDictationAvailability({ captureSupported: true, serverId: null })).toEqual({
      kind: "unavailable",
      reason: "no-speech-server",
    });
    expect(speechDictationAvailability({ captureSupported: true, serverId: "a" })).toEqual({
      kind: "available",
    });
  });
  it("starts idle only when available", () => {
    expect(initialSpeechDictationState({ kind: "available" })).toEqual(idle);
    expect(
      initialSpeechDictationState({ kind: "unavailable", reason: "no-speech-server" }),
    ).toEqual({ kind: "unavailable", reason: "no-speech-server" });
  });
});

describe("speech dictation lifecycle", () => {
  it("walks the successful path", () => {
    expect(run(idle, { type: "start" })).toEqual({ kind: "starting" });
    expect(recording).toEqual({ kind: "recording" });
    const finishing = run(recording, { type: "capture-ended", outcome: "completed" });
    expect(finishing).toEqual({ kind: "finishing", outcome: "completed" });
    expect(run(finishing, { type: "drained" })).toEqual(idle);
  });
  it("keeps the limit outcome truthful until the remaining segments are delivered", () => {
    const finishing = run(recording, { type: "capture-ended", outcome: "limit-reached" });
    expect(finishing).toEqual({ kind: "finishing", outcome: "limit-reached" });
    expect(run(finishing, { type: "drained" })).toEqual({
      kind: "failed",
      reason: "limit-reached",
    });
  });
  it("ends a lost microphone as a failure after draining", () => {
    expect(
      run(recording, { type: "capture-ended", outcome: "microphone-failed" }, { type: "drained" }),
    ).toEqual({ kind: "failed", reason: "microphone-failed" });
  });
  it("returns to idle when stopped before the microphone opened", () => {
    expect(run(idle, { type: "start" }, { type: "capture-ended", outcome: "completed" })).toEqual(
      idle,
    );
  });
  it.each([
    "permission-denied",
    "microphone-failed",
    "server-busy",
    "transcription-failed",
    "server-disconnected",
    "limit-reached",
  ] as const)("fails an active session with %s", (reason) => {
    expect(run(idle, { type: "start" }, { type: "fail", reason })).toEqual({
      kind: "failed",
      reason,
    });
    expect(run(recording, { type: "fail", reason })).toEqual({ kind: "failed", reason });
  });
  it("restarts from a failure and resets it on demand", () => {
    const failed = run(recording, { type: "fail", reason: "server-busy" });
    expect(canStartSpeechDictation(failed)).toBe(true);
    expect(run(failed, { type: "start" })).toEqual({ kind: "starting" });
    expect(run(failed, { type: "reset" })).toEqual(idle);
  });
  it("ignores events that do not belong to the current state", () => {
    expect(run(idle, { type: "capture-ready" })).toBe(idle);
    expect(run(idle, { type: "drained" })).toBe(idle);
    expect(run(idle, { type: "fail", reason: "server-busy" })).toBe(idle);
    expect(run(idle, { type: "capture-ended", outcome: "limit-reached" })).toBe(idle);
    expect(run(recording, { type: "start" })).toBe(recording);
    expect(run(recording, { type: "capture-ready" })).toBe(recording);
    expect(run(recording, { type: "drained" })).toBe(recording);
  });
  it("moves every state to unavailable and only an unavailable state back to idle", () => {
    const unavailable = run(recording, {
      type: "availability",
      availability: { kind: "unavailable", reason: "no-speech-server" },
    });
    expect(unavailable).toEqual({ kind: "unavailable", reason: "no-speech-server" });
    expect(run(unavailable, { type: "start" })).toBe(unavailable);
    expect(run(unavailable, { type: "reset" })).toBe(unavailable);
    expect(
      run(unavailable, {
        type: "availability",
        availability: { kind: "unavailable", reason: "no-speech-server" },
      }),
    ).toBe(unavailable);
    expect(run(unavailable, { type: "availability", availability: { kind: "available" } })).toEqual(
      idle,
    );
    expect(run(recording, { type: "availability", availability: { kind: "available" } })).toBe(
      recording,
    );
  });
  it("classifies active states", () => {
    expect(isSpeechDictationActive(idle)).toBe(false);
    expect(isSpeechDictationActive({ kind: "starting" })).toBe(true);
    expect(isSpeechDictationActive(recording)).toBe(true);
    expect(isSpeechDictationActive({ kind: "finishing", outcome: "completed" })).toBe(true);
    expect(isSpeechDictationActive({ kind: "failed", reason: "server-busy" })).toBe(false);
    expect(isSpeechDictationActive({ kind: "unavailable", reason: "no-speech-server" })).toBe(
      false,
    );
  });
  it("rejects an unknown event fail-closed", () => {
    expect(() =>
      reduceSpeechDictation(idle, { type: "resume" } as unknown as SpeechDictationEvent),
    ).toThrow(TypeError);
  });
});
