import { describe, expect, it, vi } from "vitest";
import { SPEECH_MAX_SEGMENT_BYTES } from "../domain/speechPcm";
import { RemoteRunnerSpeechTranscriber } from "./remoteRunnerSpeechTranscriber";
import { createSpeechDictationPorts } from "./speechDictationComposition";
import { TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";

const pcm = Uint8Array.from({ length: 640 }, (_, index) => index % 251);
const base64 = Buffer.from(pcm).toString("base64");
const request = { serverId: "server-a", language: "sk" as const, base64 };
const transcriber = (invoke: ConstructorParameters<typeof TauriRemoteRunnerGateway>[0]) =>
  new RemoteRunnerSpeechTranscriber(new TauriRemoteRunnerGateway(invoke));

describe("remote runner speech gateway", () => {
  it("requests automatic language detection and preserves the Slovak transcript", async () => {
    const invoke = vi.fn().mockResolvedValue({ text: "Hovorím po slovensky." });
    expect(
      await transcriber(invoke).transcribe({ serverId: "server-a", language: "auto", pcm }),
    ).toEqual({ kind: "transcribed", text: "Hovorím po slovensky." });
    expect(invoke).toHaveBeenCalledWith("remote_runner_transcribe_speech", {
      request: { ...request, language: "auto" },
    });
  });
  it("sends the exact closed request to the speech command", async () => {
    const invoke = vi.fn().mockResolvedValue({ text: "Ahoj svet" });
    expect(await new TauriRemoteRunnerGateway(invoke).transcribeSpeech(request)).toEqual({
      text: "Ahoj svet",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("remote_runner_transcribe_speech", { request });
  });
  it.each([
    { ...request, language: "de" },
    { ...request, serverId: "" },
    { ...request, base64: "" },
    { ...request, base64: Buffer.alloc(638).toString("base64") },
    { ...request, base64: Buffer.alloc(641).toString("base64") },
    { ...request, base64: Buffer.alloc(SPEECH_MAX_SEGMENT_BYTES + 2).toString("base64") },
    { ...request, command: "id" },
  ])("rejects the invalid request %# before IPC", async (invalid) => {
    const invoke = vi.fn();
    await expect(
      new TauriRemoteRunnerGateway(invoke).transcribeSpeech(invalid as typeof request),
    ).rejects.toThrow("Invalid remote runner transcribeSpeech request.");
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each([{ text: "a".repeat(4001) }, { text: 5 }, { text: "ok", debug: true }, {}, null, "ok"])(
    "rejects the invalid response %#",
    async (response) => {
      const invoke = vi.fn().mockResolvedValue(response);
      await expect(new TauriRemoteRunnerGateway(invoke).transcribeSpeech(request)).rejects.toThrow(
        "Invalid remote runner transcribeSpeech response.",
      );
    },
  );
  it("accepts an empty transcript", async () => {
    const invoke = vi.fn().mockResolvedValue({ text: "" });
    expect(await new TauriRemoteRunnerGateway(invoke).transcribeSpeech(request)).toEqual({
      text: "",
    });
  });
});

describe("remote runner speech transcriber", () => {
  it("encodes PCM once and returns the transcript", async () => {
    const invoke = vi.fn().mockResolvedValue({ text: " Ahoj " });
    expect(
      await transcriber(invoke).transcribe({ serverId: "server-a", language: "sk", pcm }),
    ).toEqual({ kind: "transcribed", text: " Ahoj " });
    expect(invoke).toHaveBeenCalledWith("remote_runner_transcribe_speech", { request });
  });
  it("sends the largest segment", async () => {
    const invoke = vi.fn().mockResolvedValue({ text: "" });
    const largest = new Uint8Array(SPEECH_MAX_SEGMENT_BYTES);
    expect(
      await transcriber(invoke).transcribe({ serverId: "server-a", language: "en", pcm: largest }),
    ).toEqual({ kind: "transcribed", text: "" });
    expect(invoke.mock.calls[0]?.[1]?.request.base64.length).toBe(1280000);
  });
  it.each([0, 638, 641, SPEECH_MAX_SEGMENT_BYTES + 2])(
    "refuses %i PCM bytes before IPC",
    async (length) => {
      const invoke = vi.fn();
      expect(
        await transcriber(invoke).transcribe({
          serverId: "server-a",
          language: "sk",
          pcm: new Uint8Array(length),
        }),
      ).toEqual({ kind: "failed", reason: "transcription-failed" });
      expect(invoke).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["Runner speech transcription failed: busy (HTTP 429).", "server-busy"],
    ["Runner is busy; retry shortly", "server-busy"],
    ["Server is not connected", "server-disconnected"],
    ["Server connection changed during request", "server-disconnected"],
    ["Runner identity changed. Reconnect the server before continuing.", "server-disconnected"],
    ["Runner connection failed. The request outcome may be unknown.", "transcription-failed"],
    ["Runner speech transcription failed: speech_unavailable (HTTP 503).", "transcription-failed"],
    ["Runner speech transcription failed: too_large (HTTP 413).", "transcription-failed"],
    [
      "The server runner does not support speech transcription. Update the runner on the server.",
      "transcription-failed",
    ],
    ["Invalid speech transcription request", "transcription-failed"],
    ["Invalid runner speech transcription", "transcription-failed"],
    ["Runner request failed (HTTP 409).", "transcription-failed"],
    ["Runner request failed (HTTP 500).", "transcription-failed"],
    ["something unexpected", "transcription-failed"],
  ])("maps the backend rejection %j to %s", async (message, reason) => {
    const invoke = vi.fn().mockRejectedValue(message);
    expect(
      await transcriber(invoke).transcribe({ serverId: "server-a", language: "cs", pcm }),
    ).toEqual({ kind: "failed", reason });
  });
  it("maps an invalid response and an invalid server id to transcription failed", async () => {
    const invalidResponse = vi.fn().mockResolvedValue({ text: "ok", extra: 1 });
    expect(
      await transcriber(invalidResponse).transcribe({ serverId: "server-a", language: "sk", pcm }),
    ).toEqual({ kind: "failed", reason: "transcription-failed" });
    const invoke = vi.fn();
    expect(
      await transcriber(invoke).transcribe({ serverId: "bad id", language: "sk", pcm }),
    ).toEqual({ kind: "failed", reason: "transcription-failed" });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("fails closed against a gateway without the speech command", async () => {
    expect(
      await new RemoteRunnerSpeechTranscriber({}).transcribe({
        serverId: "server-a",
        language: "sk",
        pcm,
      }),
    ).toEqual({ kind: "failed", reason: "transcription-failed" });
  });
});

describe("speech dictation composition", () => {
  it("builds both ports over the gateway with a same-origin worklet module", async () => {
    const invoke = vi.fn().mockResolvedValue({ text: "ok" });
    const ports = createSpeechDictationPorts(new TauriRemoteRunnerGateway(invoke));
    expect(ports.capture.isSupported()).toBe(false);
    expect(
      await ports.transcriber.transcribe({ serverId: "server-a", language: "sk", pcm }),
    ).toEqual({ kind: "transcribed", text: "ok" });
  });
  it("references the worklet as an emitted module instead of inline code", async () => {
    const { default: url } = await import("./speechCapture.worklet.ts?worker&url");
    expect(typeof url).toBe("string");
    expect(url).toMatch(/speechCapture\.worklet/);
    expect(url.startsWith("data:")).toBe(false);
    expect(url.startsWith("blob:")).toBe(false);
  });
});
