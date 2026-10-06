import { describe, expect, it } from "vitest";
import { RemoteRunnerRequestRejectedError } from "./remoteRunnerErrors";
import { validateRemoteRunnerValue } from "./remoteRunnerValidation";
import {
  SPEECH_MAX_TRANSCRIPT_CHARACTERS,
  classifySpeechTranscriptionError,
  isSpeechTranscriptText,
  parseSpeechTranscription,
} from "./speechTranscription";

const base64 = Buffer.alloc(640).toString("base64");
const request = { serverId: "server-a", language: "sk", base64 };
const descriptor = {
  protocolVersion: 1,
  runnerId: "runner-a",
  name: "Server",
  capabilities: { taskExecution: true, eventReplay: true },
};
const accepts = (direction: "request" | "response", value: unknown) => {
  try {
    validateRemoteRunnerValue("transcribeSpeech", direction, value);
    return true;
  } catch {
    return false;
  }
};

describe("speech transcription error classification", () => {
  it.each([
    "Runner speech transcription failed: busy (HTTP 429).",
    "Runner speech transcription failed: busy (HTTP 503).",
    "Runner is busy; retry shortly",
    "  Runner is busy; retry shortly ",
  ])("maps %j to server busy", (message) => {
    expect(classifySpeechTranscriptionError(message)).toBe("server-busy");
    expect(classifySpeechTranscriptionError(new Error(message))).toBe("server-busy");
  });
  it.each([
    "Server is not connected",
    "Server connection changed during request",
    "Server connection was superseded",
    "Runner connection changed during request.",
    "Runner connection is closed.",
    "Runner connection is closed. Reconnect the server.",
    "Runner connection unavailable.",
    "Runner connection was superseded.",
    "Runner connections are shutting down",
    "Runner identity changed. Reconnect the server before continuing.",
  ])("maps %j to server disconnected", (message) => {
    expect(classifySpeechTranscriptionError(message)).toBe("server-disconnected");
    expect(classifySpeechTranscriptionError(new Error(message))).toBe("server-disconnected");
  });
  it.each([
    "Runner speech transcription failed: not_found (HTTP 404).",
    "Runner speech transcription failed: invalid_input (HTTP 400).",
    "Runner speech transcription failed: too_large (HTTP 413).",
    "Runner speech transcription failed: unsupported_media (HTTP 415).",
    "Runner speech transcription failed: speech_unavailable (HTTP 503).",
    "Runner speech transcription failed: busy_elsewhere (HTTP 503).",
    "Runner speech transcription failed: busy (HTTP 503). trailing",
    "prefix Runner speech transcription failed: busy (HTTP 503).",
    "The server runner does not support speech transcription. Update the runner on the server.",
    "Invalid speech transcription request",
    "Invalid runner speech transcription",
    "Runner request failed (HTTP 500).",
    "Runner request failed (HTTP 503).",
    "Runner request failed (HTTP 409).",
    "Runner connection failed. The request outcome may be unknown.",
    "Invalid remote runner transcribeSpeech response.",
    "server is not connected",
    "busy",
    "",
  ])("maps %j to transcription failed", (message) => {
    expect(classifySpeechTranscriptionError(message)).toBe("transcription-failed");
  });
  it.each([null, undefined, 503, {}, { message: "Server is not connected" }, ["busy"]])(
    "maps the unknown rejection %j to transcription failed",
    (error) => {
      expect(classifySpeechTranscriptionError(error)).toBe("transcription-failed");
    },
  );
  it("classifies a gateway rejection wrapper by its message", () => {
    expect(
      classifySpeechTranscriptionError(
        new RemoteRunnerRequestRejectedError("Runner request failed (HTTP 409)."),
      ),
    ).toBe("transcription-failed");
  });
});

describe("speech transcription port result", () => {
  it("keeps valid results", () => {
    expect(parseSpeechTranscription({ kind: "transcribed", text: "Ahoj" })).toEqual({
      kind: "transcribed",
      text: "Ahoj",
    });
    expect(parseSpeechTranscription({ kind: "transcribed", text: "" })).toEqual({
      kind: "transcribed",
      text: "",
    });
    for (const reason of ["server-busy", "server-disconnected", "transcription-failed"]) {
      expect(parseSpeechTranscription({ kind: "failed", reason })).toEqual({
        kind: "failed",
        reason,
      });
    }
  });
  it.each([
    undefined,
    null,
    "text",
    {},
    { kind: "weird" },
    { kind: "transcribed" },
    { kind: "transcribed", text: 5 },
    { kind: "transcribed", text: "a".repeat(SPEECH_MAX_TRANSCRIPT_CHARACTERS + 1) },
    { kind: "failed" },
    { kind: "failed", reason: "exploded" },
  ])("fails closed on %j", (value) => {
    expect(parseSpeechTranscription(value)).toEqual({
      kind: "failed",
      reason: "transcription-failed",
    });
  });
});

describe("speech transcript validation", () => {
  it("accepts empty and bounded text", () => {
    expect(isSpeechTranscriptText("")).toBe(true);
    expect(isSpeechTranscriptText("Ahoj svet.\nDruhý riadok.")).toBe(true);
    expect(isSpeechTranscriptText("a".repeat(SPEECH_MAX_TRANSCRIPT_CHARACTERS))).toBe(true);
    expect(isSpeechTranscriptText("😀".repeat(SPEECH_MAX_TRANSCRIPT_CHARACTERS))).toBe(true);
  });
  it("rejects oversized, binary and non-string text", () => {
    expect(isSpeechTranscriptText("a".repeat(SPEECH_MAX_TRANSCRIPT_CHARACTERS + 1))).toBe(false);
    expect(isSpeechTranscriptText("😀".repeat(SPEECH_MAX_TRANSCRIPT_CHARACTERS + 1))).toBe(false);
    expect(isSpeechTranscriptText("a\0b")).toBe(false);
    expect(isSpeechTranscriptText(null)).toBe(false);
    expect(isSpeechTranscriptText(["text"])).toBe(false);
  });
});

describe("remote runner speech transcription contract", () => {
  it.each(["sk", "en", "cs"])("accepts a request in %s", (language) => {
    expect(accepts("request", { ...request, language })).toBe(true);
  });
  it.each([
    { ...request, language: "de" },
    { ...request, language: "SK" },
    { ...request, serverId: "" },
    { ...request, serverId: "bad id" },
    { ...request, base64: "" },
    { ...request, base64: Buffer.alloc(638).toString("base64") },
    { ...request, base64: Buffer.alloc(641).toString("base64") },
    { ...request, base64: Buffer.alloc(960002).toString("base64") },
    { ...request, base64: `${base64.slice(0, -4)}!!==` },
    { ...request, pcm: [0] },
    { ...request, command: "id" },
    { serverId: "server-a", language: "sk" },
    null,
    undefined,
  ])("rejects the invalid request %#", (invalid) => {
    expect(accepts("request", invalid)).toBe(false);
  });
  it("accepts the largest request", () => {
    expect(
      accepts("request", { ...request, base64: Buffer.alloc(960000).toString("base64") }),
    ).toBe(true);
  });
  it.each([{ text: "" }, { text: "Ahoj" }, { text: "a".repeat(4000) }])(
    "accepts the response %#",
    (response) => {
      expect(accepts("response", response)).toBe(true);
    },
  );
  it.each([
    { text: "a".repeat(4001) },
    { text: null },
    { text: 1 },
    { text: "ok", language: "sk" },
    { text: "ok", segments: [] },
    {},
    "ok",
    ["ok"],
    null,
    undefined,
  ])("rejects the invalid response %#", (response) => {
    expect(accepts("response", response)).toBe(false);
  });
  it.each([true, false, undefined])("accepts optional speech capability %s", (supported) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: {
          ...descriptor.capabilities,
          ...(supported === undefined ? {} : { speechTranscription: supported }),
        },
      }),
    ).not.toThrow();
  });
  it.each([null, "true", 1, {}, []])("rejects malformed speech capability %j", (supported) => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, speechTranscription: supported },
      }),
    ).toThrow("Invalid remote runner getRunner response.");
  });
  it("keeps the descriptor closed next to the speech flag", () => {
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, speechTranscription: true, speechV2: true },
      }),
    ).toThrow("Invalid remote runner getRunner response.");
  });
});
