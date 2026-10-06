import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SPEECH_BUSY_RETRY_DELAYS_MS,
  SPEECH_CAPTURE_STALL_MS,
  SPEECH_MAX_QUEUED_SEGMENTS,
  SPEECH_MAX_SESSION_MS,
  SPEECH_TRANSCRIPTION_TIMEOUT_MS,
} from "../domain/speechDictation";
import { SPEECH_MAX_SEGMENT_BYTES } from "../domain/speechPcm";
import { RemoteRunnerSpeechTranscriber } from "../infrastructure/remoteRunnerSpeechTranscriber";
import { TauriRemoteRunnerGateway } from "../infrastructure/tauriRemoteRunnerGateway";
import {
  FakeMediaStream,
  controlledInvoke,
  decodedPcmBytes,
  deferred,
  dictationTestPorts,
  flushAsync,
  installFakeBrowserAudio,
  namedError,
  silence,
  tone,
  type Deferred,
  type FakeBrowserAudio,
  type FakeBrowserAudioOptions,
} from "../test/speechDictationTestSupport";
import {
  SPEECH_MAX_SESSION_SAMPLES,
  SpeechDictationCoordinator,
  type SpeechDictationBinding,
} from "./speechDictationCoordinator";
import type {
  AudioCapturePort,
  AudioCaptureSink,
  AudioCaptureStartOutcome,
  SpeechTranscriberPort,
} from "./speechDictationPorts";

type Invoke = ConstructorParameters<typeof TauriRemoteRunnerGateway>[0];

let installed: FakeBrowserAudio | null = null;
afterEach(() => {
  installed?.restore();
  installed = null;
  vi.useRealTimers();
});

function setup(options: { audio?: FakeBrowserAudioOptions | null; invoke?: Invoke } = {}) {
  const audio =
    options.audio === null
      ? null
      : installFakeBrowserAudio({ sampleRate: 16000, ...options.audio });
  installed = audio;
  const ipc = controlledInvoke();
  const coordinator = new SpeechDictationCoordinator(
    dictationTestPorts(new TauriRemoteRunnerGateway(options.invoke ?? ipc.invoke)),
  );
  const transcripts: string[] = [];
  const binding: SpeechDictationBinding = {
    ownerId: "draft-a",
    serverIds: ["server-a"],
    language: "sk",
    onTranscript: (text) => transcripts.push(text),
  };
  const bind = (overrides: Partial<SpeechDictationBinding> = {}) =>
    coordinator.bind({ ...binding, ...overrides });
  bind();
  const rate = audio?.contexts[0]?.sampleRate ?? options.audio?.sampleRate ?? 16000;
  const record = async () => {
    coordinator.start();
    await flushAsync();
  };
  const speak = (seconds = 2) => audio?.emit(tone(seconds, rate));
  const pause = (seconds = 0.7) => audio?.emit(silence(seconds, rate));
  const utter = () => {
    speak();
    pause();
  };
  const state = () => coordinator.getState();
  return { audio, ipc, coordinator, transcripts, bind, record, speak, pause, utter, state };
}

function setupWithPorts(
  options: { supported?: () => boolean; transcriber?: SpeechTranscriberPort } = {},
) {
  const sinks: AudioCaptureSink[] = [];
  const stopped: number[] = [];
  const outcomes: Deferred<AudioCaptureStartOutcome>[] = [];
  const capture: AudioCapturePort = {
    isSupported: options.supported ?? (() => true),
    start: (sink) => {
      const index = sinks.push(sink) - 1;
      const outcome = deferred<AudioCaptureStartOutcome>();
      outcomes.push(outcome);
      return { started: outcome.promise, stop: () => void stopped.push(index) };
    },
  };
  const ipc = controlledInvoke();
  const transcripts: string[] = [];
  const coordinator = new SpeechDictationCoordinator({
    capture,
    transcriber:
      options.transcriber ??
      new RemoteRunnerSpeechTranscriber(new TauriRemoteRunnerGateway(ipc.invoke)),
  });
  const binding: SpeechDictationBinding = {
    ownerId: "draft-a",
    serverIds: ["server-a"],
    language: "sk",
    onTranscript: (text) => transcripts.push(text),
  };
  coordinator.bind(binding);
  const record = async () => {
    coordinator.start();
    outcomes[outcomes.length - 1]?.resolve({ kind: "started" });
    await flushAsync();
  };
  const frame = (samples: Float32Array, sampleRate = 16000, index = sinks.length - 1) =>
    sinks[index]?.onFrame({ samples, sampleRate });
  const utterance = (sampleRate = 16000) =>
    Float32Array.from([...tone(2, sampleRate), ...silence(0.7, sampleRate)]);
  const state = () => coordinator.getState();
  return {
    coordinator,
    binding,
    sinks,
    stopped,
    ipc,
    transcripts,
    record,
    frame,
    utterance,
    state,
  };
}

function requireAudio(audio: FakeBrowserAudio | null): FakeBrowserAudio {
  expect(audio).not.toBeNull();
  return audio as FakeBrowserAudio;
}

describe("speech dictation availability", () => {
  it("is unavailable when the webview cannot capture the microphone", () => {
    const { coordinator, state } = setup({ audio: null });
    expect(state()).toEqual({ kind: "unavailable", reason: "capture-unsupported" });
    coordinator.start();
    expect(state()).toEqual({ kind: "unavailable", reason: "capture-unsupported" });
  });
  it("is unavailable without a speech-capable server and recovers when one connects", () => {
    const { audio, bind, coordinator, state } = setup();
    bind({ serverIds: [] });
    expect(state()).toEqual({ kind: "unavailable", reason: "no-speech-server" });
    coordinator.start();
    expect(requireAudio(audio).getUserMedia).not.toHaveBeenCalled();
    bind({ serverIds: ["server-b"] });
    expect(state()).toEqual({ kind: "idle" });
  });
  it("becomes unavailable when capture support disappears at start", async () => {
    const { bind, record, state, coordinator } = setup();
    vi.stubGlobal("AudioWorkletNode", undefined);
    await record();
    expect(state()).toEqual({ kind: "unavailable", reason: "capture-unsupported" });
    coordinator.cancel();
    expect(state()).toEqual({ kind: "unavailable", reason: "capture-unsupported" });
    vi.stubGlobal("AudioWorkletNode", class {});
    bind();
    expect(state()).toEqual({ kind: "unavailable", reason: "capture-unsupported" });
  });
  it("starts from the binding given at construction", () => {
    installed = installFakeBrowserAudio();
    const ports = dictationTestPorts(new TauriRemoteRunnerGateway(controlledInvoke().invoke));
    const binding: SpeechDictationBinding = {
      ownerId: "draft-a",
      serverIds: ["server-a"],
      language: "en",
      onTranscript: () => undefined,
    };
    expect(new SpeechDictationCoordinator(ports, binding).getState()).toEqual({ kind: "idle" });
    expect(new SpeechDictationCoordinator(ports).getState()).toEqual({
      kind: "unavailable",
      reason: "no-speech-server",
    });
  });
  it("closes the session when capture support is lost mid-recording", async () => {
    let supported = true;
    const { coordinator, binding, sinks, stopped, record, frame, state } = setupWithPorts({
      supported: () => supported,
    });
    await record();
    expect(state()).toEqual({ kind: "recording" });
    supported = false;
    coordinator.bind(binding);
    expect(state()).toEqual({ kind: "unavailable", reason: "capture-unsupported" });
    expect(stopped).toEqual([0]);
    supported = true;
    coordinator.bind(binding);
    expect(state()).toEqual({ kind: "idle" });
    await record();
    expect(sinks.length).toBe(2);
    frame(tone(1, 16000), 16000, 0);
    expect(coordinator.meter.getSnapshot()).toEqual({ level: 0, elapsedMs: 0 });
    expect(stopped).toEqual([0]);
  });
});

describe("speech dictation session", () => {
  it("records, transcribes the flushed remainder and returns to idle", async () => {
    const { audio, ipc, coordinator, transcripts, record, speak, state } = setup();
    coordinator.start();
    expect(state()).toEqual({ kind: "starting" });
    await flushAsync();
    expect(state()).toEqual({ kind: "recording" });
    speak(1);
    expect(ipc.calls).toEqual([]);
    coordinator.stop();
    expect(state()).toEqual({ kind: "finishing", outcome: "completed" });
    expect(requireAudio(audio).microphoneLive()).toBe(false);
    expect(ipc.calls.length).toBe(1);
    expect(ipc.calls[0]?.command).toBe("remote_runner_transcribe_speech");
    expect(ipc.calls[0]?.request.serverId).toBe("server-a");
    expect(ipc.calls[0]?.request.language).toBe("sk");
    expect(decodedPcmBytes(ipc.calls[0]?.request.base64 ?? "")).toBe(32000);
    ipc.calls[0]?.resolve({ text: "  Ahoj svet.  " });
    await flushAsync();
    expect(transcripts).toEqual(["Ahoj svet."]);
    expect(state()).toEqual({ kind: "idle" });
    await record();
    expect(state()).toEqual({ kind: "recording" });
  });
  it("captures the language and server at start", async () => {
    const { ipc, bind, record, utter } = setup();
    bind({ language: "cs" });
    await record();
    bind({ language: "en" });
    utter();
    expect(ipc.calls[0]?.request.language).toBe("cs");
  });
  it.each([44100, 48000])("downsamples %i Hz capture to 16 kHz PCM", async (sampleRate) => {
    const { ipc, record, speak, pause } = setup({ audio: { sampleRate } });
    await record();
    speak(2.5);
    pause(0.7);
    expect(ipc.calls.length).toBe(1);
    const bytes = decodedPcmBytes(ipc.calls[0]?.request.base64 ?? "");
    expect(bytes % 2).toBe(0);
    expect(bytes).toBeGreaterThanOrEqual((40000 + 9600) * 2);
    expect(bytes).toBeLessThanOrEqual((40000 + 11200) * 2);
  });
  it("sends nothing for silence", async () => {
    const { ipc, coordinator, transcripts, record, pause, state } = setup();
    await record();
    pause(20);
    coordinator.stop();
    await flushAsync();
    expect(ipc.calls).toEqual([]);
    expect(transcripts).toEqual([]);
    expect(state()).toEqual({ kind: "idle" });
  });
  it("does not deliver empty transcripts", async () => {
    const { ipc, coordinator, transcripts, record, utter, state } = setup();
    await record();
    utter();
    utter();
    coordinator.stop();
    ipc.calls[0]?.resolve({ text: "" });
    await flushAsync();
    ipc.calls[1]?.resolve({ text: " \n\t " });
    await flushAsync();
    expect(transcripts).toEqual([]);
    expect(state()).toEqual({ kind: "idle" });
  });
  it("ignores start while a session is active", async () => {
    const { audio, coordinator, record, state } = setup();
    await record();
    coordinator.start();
    await flushAsync();
    expect(requireAudio(audio).getUserMedia).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ kind: "recording" });
  });
});

describe("speech dictation ordering", () => {
  it("transcribes one segment at a time and delivers in capture order", async () => {
    const { ipc, coordinator, transcripts, record, speak, pause, state } = setup();
    await record();
    for (const seconds of [2, 3, 4]) {
      speak(seconds);
      pause();
    }
    expect(ipc.calls.length).toBe(1);
    await flushAsync();
    expect(ipc.calls.length).toBe(1);
    ipc.calls[0]?.resolve({ text: "one" });
    ipc.calls[0]?.resolve({ text: "duplicate" });
    await flushAsync();
    expect(transcripts).toEqual(["one"]);
    expect(ipc.calls.length).toBe(2);
    ipc.calls[0]?.resolve({ text: "late duplicate" });
    ipc.calls[1]?.resolve({ text: "two" });
    await flushAsync();
    expect(ipc.calls.length).toBe(3);
    coordinator.stop();
    expect(state()).toEqual({ kind: "finishing", outcome: "completed" });
    ipc.calls[2]?.resolve({ text: "three" });
    await flushAsync();
    expect(transcripts).toEqual(["one", "two", "three"]);
    expect(state()).toEqual({ kind: "idle" });
    const sizes = ipc.calls.map((call) => decodedPcmBytes(call.request.base64));
    expect(sizes[0]).toBeLessThan(sizes[1] ?? 0);
    expect(sizes[1]).toBeLessThan(sizes[2] ?? 0);
  });
  it("lets the consumer stop from the callback and still receive the remainder", async () => {
    const { ipc, bind, coordinator, record, speak, utter, state } = setup();
    const seen: string[] = [];
    bind({
      onTranscript: (text) => {
        seen.push(text);
        coordinator.stop();
      },
    });
    await record();
    utter();
    speak(1);
    ipc.calls[0]?.resolve({ text: "one" });
    await flushAsync();
    expect(state()).toEqual({ kind: "finishing", outcome: "completed" });
    expect(ipc.calls.length).toBe(2);
    ipc.calls[1]?.resolve({ text: "tail" });
    await flushAsync();
    expect(seen).toEqual(["one", "tail"]);
    expect(state()).toEqual({ kind: "idle" });
  });
  it("finishes a segment in flight and the flushed remainder after stop", async () => {
    const { audio, ipc, coordinator, transcripts, record, speak, utter, state } = setup();
    await record();
    utter();
    speak(1);
    coordinator.stop();
    expect(requireAudio(audio).microphoneLive()).toBe(false);
    expect(ipc.calls.length).toBe(1);
    coordinator.stop();
    coordinator.start();
    expect(state()).toEqual({ kind: "finishing", outcome: "completed" });
    ipc.calls[0]?.resolve({ text: "first" });
    await flushAsync();
    expect(state()).toEqual({ kind: "finishing", outcome: "completed" });
    expect(ipc.calls.length).toBe(2);
    ipc.calls[1]?.resolve({ text: "tail" });
    await flushAsync();
    expect(transcripts).toEqual(["first", "tail"]);
    expect(state()).toEqual({ kind: "idle" });
  });
});

describe("speech dictation fencing", () => {
  it("drops a pending transcription and the queue on cancel", async () => {
    const { audio, ipc, coordinator, transcripts, record, utter, state } = setup();
    await record();
    utter();
    utter();
    coordinator.cancel();
    expect(state()).toEqual({ kind: "idle" });
    expect(requireAudio(audio).microphoneLive()).toBe(false);
    ipc.calls[0]?.resolve({ text: "late" });
    await flushAsync();
    expect(transcripts).toEqual([]);
    expect(ipc.calls.length).toBe(1);
    expect(state()).toEqual({ kind: "idle" });
  });
  it("drops a late result that arrives during the next session", async () => {
    const { ipc, coordinator, transcripts, record, utter, state } = setup();
    await record();
    utter();
    coordinator.cancel();
    await record();
    utter();
    expect(ipc.calls.length).toBe(2);
    ipc.calls[0]?.resolve({ text: "stale" });
    await flushAsync();
    expect(transcripts).toEqual([]);
    expect(state()).toEqual({ kind: "recording" });
    ipc.calls[1]?.resolve({ text: "fresh" });
    await flushAsync();
    expect(transcripts).toEqual(["fresh"]);
    ipc.calls[0]?.reject("Server is not connected");
    await flushAsync();
    expect(state()).toEqual({ kind: "recording" });
  });
  it("invalidates the session when the owner changes, including A to B to A", async () => {
    const { audio, ipc, bind, transcripts, record, utter, state } = setup();
    const foreign: string[] = [];
    await record();
    utter();
    bind({ ownerId: "draft-b", onTranscript: (text) => foreign.push(text) });
    expect(state()).toEqual({ kind: "idle" });
    expect(requireAudio(audio).microphoneLive()).toBe(false);
    bind({ ownerId: "draft-a" });
    ipc.calls[0]?.resolve({ text: "belongs to the first visit" });
    await flushAsync();
    expect(transcripts).toEqual([]);
    expect(foreign).toEqual([]);
    expect(state()).toEqual({ kind: "idle" });
    await record();
    utter();
    ipc.calls[1]?.resolve({ text: "second visit" });
    await flushAsync();
    expect(transcripts).toEqual(["second visit"]);
  });
  it("clears a previous owner's failure for the next owner", async () => {
    const { ipc, bind, record, utter, state } = setup();
    await record();
    utter();
    ipc.calls[0]?.reject("Server is not connected");
    await flushAsync();
    expect(state()).toEqual({ kind: "failed", reason: "server-disconnected" });
    bind({ ownerId: "draft-b" });
    expect(state()).toEqual({ kind: "idle" });
  });
  it("drops the in-flight transcript when the owner changes while finishing", async () => {
    const { ipc, bind, coordinator, transcripts, record, utter, state } = setup();
    const foreign: string[] = [];
    await record();
    utter();
    coordinator.stop();
    expect(state()).toEqual({ kind: "finishing", outcome: "completed" });
    bind({ ownerId: "draft-b", onTranscript: (text) => foreign.push(text) });
    expect(state()).toEqual({ kind: "idle" });
    ipc.calls[0]?.resolve({ text: "for the first draft" });
    await flushAsync();
    expect(transcripts).toEqual([]);
    expect(foreign).toEqual([]);
    expect(state()).toEqual({ kind: "idle" });
  });
  it("releases the microphone when the owner changes while starting", async () => {
    const granted = deferred<FakeMediaStream>();
    const { audio, bind, coordinator, state } = setup({
      audio: { getUserMedia: () => granted.promise },
    });
    coordinator.start();
    bind({ ownerId: "draft-b" });
    expect(state()).toEqual({ kind: "idle" });
    const stream = new FakeMediaStream();
    granted.resolve(stream);
    await flushAsync();
    expect(stream.tracks[0]?.stopped).toBe(true);
    expect(requireAudio(audio).contexts).toEqual([]);
    expect(state()).toEqual({ kind: "idle" });
  });
  it("fails and drops the in-flight transcript when its server goes away while finishing", async () => {
    const { ipc, bind, coordinator, transcripts, record, utter, state } = setup();
    await record();
    utter();
    coordinator.stop();
    bind({ serverIds: ["server-b"] });
    expect(state()).toEqual({ kind: "failed", reason: "server-disconnected" });
    ipc.calls[0]?.resolve({ text: "from the old server" });
    await flushAsync();
    expect(transcripts).toEqual([]);
    expect(state()).toEqual({ kind: "failed", reason: "server-disconnected" });
  });
  it("fails and releases the microphone when its server goes away while starting", async () => {
    const granted = deferred<FakeMediaStream>();
    const { bind, coordinator, state } = setup({
      audio: { getUserMedia: () => granted.promise },
    });
    coordinator.start();
    bind({ serverIds: ["server-b"] });
    expect(state()).toEqual({ kind: "failed", reason: "server-disconnected" });
    const stream = new FakeMediaStream();
    granted.resolve(stream);
    await flushAsync();
    expect(stream.tracks[0]?.stopped).toBe(true);
    expect(state()).toEqual({ kind: "failed", reason: "server-disconnected" });
  });
  it("stays idle when permission is denied after stop during start", async () => {
    const granted = deferred<FakeMediaStream>();
    const { coordinator, state } = setup({ audio: { getUserMedia: () => granted.promise } });
    coordinator.start();
    coordinator.stop();
    granted.reject(namedError("NotAllowedError"));
    await flushAsync();
    expect(state()).toEqual({ kind: "idle" });
  });
  it("never opens the microphone when a listener cancels the start", async () => {
    const { coordinator, sinks, stopped, state } = setupWithPorts();
    coordinator.subscribe(() => {
      if (coordinator.getState().kind === "starting") coordinator.cancel();
    });
    coordinator.start();
    await flushAsync();
    expect(sinks).toEqual([]);
    expect(stopped).toEqual([]);
    expect(state()).toEqual({ kind: "idle" });
  });
  it("stops a capture that fails synchronously while starting", async () => {
    const stops: string[] = [];
    const coordinator = new SpeechDictationCoordinator({
      capture: {
        isSupported: () => true,
        start: (sink) => {
          sink.onFailure("failed");
          return {
            started: Promise.resolve({ kind: "started" }),
            stop: () => void stops.push("stopped"),
          };
        },
      },
      transcriber: new RemoteRunnerSpeechTranscriber(
        new TauriRemoteRunnerGateway(controlledInvoke().invoke),
      ),
    });
    coordinator.bind({
      ownerId: "draft-a",
      serverIds: ["server-a"],
      language: "sk",
      onTranscript: () => undefined,
    });
    coordinator.start();
    await flushAsync();
    expect(coordinator.getState()).toEqual({ kind: "failed", reason: "microphone-failed" });
    expect(stops).toEqual(["stopped"]);
  });
  it("keeps the state machine intact when a state listener misbehaves", async () => {
    const { ipc, coordinator, transcripts, record, utter, state } = setup();
    const sealed: readonly string[] = Object.freeze([]);
    coordinator.subscribe(() => void (sealed as string[]).push("notified"));
    coordinator.meter.subscribe(() => void (sealed as string[]).push("metered"));
    await record();
    utter();
    coordinator.stop();
    ipc.calls[0]?.resolve({ text: "kept" });
    await flushAsync();
    expect(transcripts).toEqual(["kept"]);
    expect(state()).toEqual({ kind: "idle" });
  });
  it("restarts the resampler when the capture sample rate changes", async () => {
    const { ipc, coordinator, record, frame } = setupWithPorts();
    await record();
    frame(tone(1, 48000), 48000);
    frame(tone(1, 16000), 16000);
    expect(coordinator.meter.getSnapshot().elapsedMs).toBe(2000);
    coordinator.stop();
    expect(decodedPcmBytes(ipc.calls[0]?.request.base64 ?? "")).toBe(64000);
  });
  it("keeps the session and its queue on the captured server when another becomes preferred", async () => {
    const { audio, ipc, bind, coordinator, transcripts, record, utter, state } = setup();
    await record();
    utter();
    utter();
    bind({ serverIds: ["server-b", "server-a"] });
    expect(state()).toEqual({ kind: "recording" });
    expect(requireAudio(audio).microphoneLive()).toBe(true);
    ipc.calls[0]?.resolve({ text: "first" });
    await flushAsync();
    expect(ipc.calls[1]?.request.serverId).toBe("server-a");
    coordinator.stop();
    ipc.calls[1]?.resolve({ text: "second" });
    await flushAsync();
    expect(transcripts).toEqual(["first", "second"]);
    expect(state()).toEqual({ kind: "idle" });
    await record();
    utter();
    expect(ipc.calls[2]?.request.serverId).toBe("server-b");
  });
  it("keeps starting and finishing sessions when only the preference changes", async () => {
    const granted = deferred<FakeMediaStream>();
    const { ipc, bind, coordinator, transcripts, utter, state } = setup({
      audio: { getUserMedia: () => granted.promise },
    });
    coordinator.start();
    bind({ serverIds: ["server-b", "server-a"] });
    expect(state()).toEqual({ kind: "starting" });
    granted.resolve(new FakeMediaStream());
    await flushAsync();
    expect(state()).toEqual({ kind: "recording" });
    utter();
    coordinator.stop();
    bind({ serverIds: ["server-c", "server-b", "server-a"] });
    expect(state()).toEqual({ kind: "finishing", outcome: "completed" });
    ipc.calls[0]?.resolve({ text: "kept" });
    await flushAsync();
    expect(ipc.calls[0]?.request.serverId).toBe("server-a");
    expect(transcripts).toEqual(["kept"]);
    expect(state()).toEqual({ kind: "idle" });
  });
  it("fails the session when its captured server is no longer available", async () => {
    const { audio, ipc, bind, transcripts, record, utter, state } = setup();
    await record();
    utter();
    utter();
    bind({ serverIds: ["server-b"] });
    expect(state()).toEqual({ kind: "failed", reason: "server-disconnected" });
    expect(requireAudio(audio).microphoneLive()).toBe(false);
    ipc.calls[0]?.resolve({ text: "from the old server" });
    await flushAsync();
    expect(transcripts).toEqual([]);
    expect(ipc.calls.length).toBe(1);
    await record();
    utter();
    expect(ipc.calls[1]?.request.serverId).toBe("server-b");
  });
  it("becomes unavailable when the server disappears mid-session", async () => {
    const { audio, ipc, bind, transcripts, record, utter, state } = setup();
    await record();
    utter();
    bind({ serverIds: [] });
    expect(state()).toEqual({ kind: "unavailable", reason: "no-speech-server" });
    expect(requireAudio(audio).microphoneLive()).toBe(false);
    ipc.calls[0]?.resolve({ text: "late" });
    await flushAsync();
    expect(transcripts).toEqual([]);
  });
  it("releases a microphone granted after stop during start", async () => {
    const granted = deferred<FakeMediaStream>();
    const { audio, coordinator, state } = setup({
      audio: { getUserMedia: () => granted.promise },
    });
    coordinator.start();
    expect(state()).toEqual({ kind: "starting" });
    coordinator.stop();
    expect(state()).toEqual({ kind: "idle" });
    const stream = new FakeMediaStream();
    granted.resolve(stream);
    await flushAsync();
    expect(stream.tracks[0]?.stopped).toBe(true);
    expect(requireAudio(audio).contexts).toEqual([]);
    expect(state()).toEqual({ kind: "idle" });
  });
  it("releases a microphone granted after cancel and a restart", async () => {
    const first = deferred<FakeMediaStream>();
    const grants = [first.promise, Promise.resolve(new FakeMediaStream())];
    const { audio, coordinator, state } = setup({
      audio: { getUserMedia: () => grants.shift() ?? Promise.reject(namedError("AbortError")) },
    });
    coordinator.start();
    coordinator.cancel();
    coordinator.start();
    await flushAsync();
    expect(state()).toEqual({ kind: "recording" });
    const stale = new FakeMediaStream();
    first.resolve(stale);
    await flushAsync();
    expect(stale.tracks[0]?.stopped).toBe(true);
    expect(state()).toEqual({ kind: "recording" });
    expect(requireAudio(audio).contexts.length).toBe(1);
  });
  it("ignores start, frame and failure events from a replaced capture", async () => {
    const outcomes = [deferred<AudioCaptureStartOutcome>(), deferred<AudioCaptureStartOutcome>()];
    const sinks: AudioCaptureSink[] = [];
    const stopped: number[] = [];
    const capture: AudioCapturePort = {
      isSupported: () => true,
      start: (sink) => {
        const index = sinks.push(sink) - 1;
        return {
          started: outcomes[index]?.promise ?? Promise.resolve({ kind: "started" }),
          stop: () => void stopped.push(index),
        };
      },
    };
    const ipc = controlledInvoke();
    const coordinator = new SpeechDictationCoordinator({
      capture,
      transcriber: new RemoteRunnerSpeechTranscriber(new TauriRemoteRunnerGateway(ipc.invoke)),
    });
    coordinator.bind({
      ownerId: "draft-a",
      serverIds: ["server-a"],
      language: "sk",
      onTranscript: () => undefined,
    });
    coordinator.start();
    coordinator.cancel();
    coordinator.start();
    expect(stopped).toEqual([0]);
    outcomes[0]?.resolve({ kind: "started" });
    await flushAsync();
    expect(coordinator.getState()).toEqual({ kind: "starting" });
    outcomes[1]?.resolve({ kind: "started" });
    await flushAsync();
    expect(coordinator.getState()).toEqual({ kind: "recording" });
    sinks[0]?.onFailure("failed");
    sinks[0]?.onFrame({ samples: tone(3, 16000).subarray(0, 2048), sampleRate: 16000 });
    expect(coordinator.getState()).toEqual({ kind: "recording" });
    expect(coordinator.meter.getSnapshot()).toEqual({ level: 0, elapsedMs: 0 });
    sinks[1]?.onFrame({ samples: new Float32Array(192001), sampleRate: 16000 });
    expect(coordinator.getState()).toEqual({ kind: "failed", reason: "microphone-failed" });
    expect(stopped).toEqual([0, 1]);
    expect(ipc.calls).toEqual([]);
  });
  it("stops delivering when the consumer cancels from the callback", async () => {
    const { ipc, bind, coordinator, record, utter, state } = setup();
    const seen: string[] = [];
    bind({
      onTranscript: (text) => {
        seen.push(text);
        coordinator.cancel();
      },
    });
    await record();
    utter();
    utter();
    ipc.calls[0]?.resolve({ text: "one" });
    await flushAsync();
    expect(seen).toEqual(["one"]);
    expect(ipc.calls.length).toBe(1);
    expect(state()).toEqual({ kind: "idle" });
  });
  it("uses the latest callback of the same owner", async () => {
    const { ipc, bind, transcripts, record, utter } = setup();
    const latest: string[] = [];
    await record();
    utter();
    bind({ onTranscript: (text) => latest.push(text) });
    ipc.calls[0]?.resolve({ text: "text" });
    await flushAsync();
    expect(latest).toEqual(["text"]);
    expect(transcripts).toEqual([]);
  });
  it("fails truthfully when the consumer rejects the transcript", async () => {
    const { audio, ipc, bind, record, utter, state } = setup();
    const sealed: readonly string[] = Object.freeze([]);
    bind({ onTranscript: (text) => void (sealed as string[]).push(text) });
    await record();
    utter();
    ipc.calls[0]?.resolve({ text: "text" });
    await flushAsync();
    expect(state()).toEqual({ kind: "failed", reason: "transcription-failed" });
    expect(requireAudio(audio).microphoneLive()).toBe(false);
  });
});

describe("speech dictation limits", () => {
  it("stops capture when the transcription queue is full and still delivers it", async () => {
    const { audio, ipc, coordinator, transcripts, record, utter, state } = setup();
    await record();
    for (let index = 0; index < SPEECH_MAX_QUEUED_SEGMENTS; index += 1) utter();
    expect(state()).toEqual({ kind: "recording" });
    utter();
    expect(state()).toEqual({ kind: "finishing", outcome: "limit-reached" });
    expect(requireAudio(audio).microphoneLive()).toBe(false);
    utter();
    coordinator.stop();
    expect(ipc.calls.length).toBe(1);
    for (let index = 0; index <= SPEECH_MAX_QUEUED_SEGMENTS; index += 1) {
      expect(ipc.calls.length).toBe(index + 1);
      ipc.calls[index]?.resolve({ text: `segment ${index}` });
      await flushAsync();
    }
    expect(transcripts).toEqual(["segment 0", "segment 1", "segment 2", "segment 3", "segment 4"]);
    expect(ipc.calls.length).toBe(SPEECH_MAX_QUEUED_SEGMENTS + 1);
    expect(state()).toEqual({ kind: "failed", reason: "limit-reached" });
  });
  it("ends at the session length limit and delivers every captured segment", async () => {
    const sizes: number[] = [];
    const invoke: Invoke = async (_command, args) => {
      const request = args?.request as { base64: string };
      sizes.push(decodedPcmBytes(request.base64));
      return { text: `segment ${sizes.length}` };
    };
    const { audio, transcripts, record, state } = setup({ invoke });
    await record();
    const tenth = tone(0.1, 16000);
    for (let posted = 0; posted < (SPEECH_MAX_SESSION_MS / 1000 + 10) * 10; posted += 1) {
      requireAudio(audio).post(tenth.slice());
      if (posted % 10 === 9) await flushAsync(4);
    }
    await vi.waitFor(() => expect(state().kind).toBe("failed"));
    expect(requireAudio(audio).microphoneLive()).toBe(false);
    expect(sizes).toEqual(Array.from({ length: 10 }, () => SPEECH_MAX_SEGMENT_BYTES));
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(SPEECH_MAX_SESSION_SAMPLES * 2);
    expect(transcripts.length).toBe(10);
    expect(transcripts[9]).toBe("segment 10");
    expect(state()).toEqual({ kind: "failed", reason: "limit-reached" });
  });
  it("delivers a queue overflow from one oversized frame as limit reached", async () => {
    const { ipc, transcripts, record, frame, utterance, stopped, state } = setupWithPorts();
    await record();
    const eight = Array.from({ length: 8 }, () => [...utterance(8000)]).flat();
    frame(Float32Array.from(eight), 8000);
    expect(state()).toEqual({ kind: "finishing", outcome: "limit-reached" });
    expect(stopped).toEqual([0]);
    for (let index = 0; index < SPEECH_MAX_QUEUED_SEGMENTS; index += 1) {
      ipc.calls[index]?.resolve({ text: `segment ${index}` });
      await flushAsync();
    }
    expect(transcripts).toEqual(["segment 0", "segment 1", "segment 2", "segment 3"]);
    expect(ipc.calls.length).toBe(SPEECH_MAX_QUEUED_SEGMENTS);
    expect(state()).toEqual({ kind: "failed", reason: "limit-reached" });
  });
  it("ends at the wall-clock deadline when frames only trickle in", async () => {
    vi.useFakeTimers();
    const { audio, record, pause, state } = setup();
    await record();
    for (let elapsed = 4000; elapsed < SPEECH_MAX_SESSION_MS; elapsed += 4000) {
      vi.advanceTimersByTime(4000);
      pause(0.01);
    }
    expect(state()).toEqual({ kind: "recording" });
    vi.advanceTimersByTime(4000);
    expect(state()).toEqual({ kind: "failed", reason: "limit-reached" });
    expect(requireAudio(audio).microphoneLive()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ends a capture that stops delivering frames and keeps what was captured", async () => {
    vi.useFakeTimers();
    const { audio, record, speak, ipc, transcripts, state } = setup();
    await record();
    speak(1);
    vi.advanceTimersByTime(SPEECH_CAPTURE_STALL_MS);
    expect(state()).toEqual({ kind: "recording" });
    vi.advanceTimersByTime(SPEECH_CAPTURE_STALL_MS);
    expect(state()).toEqual({ kind: "finishing", outcome: "microphone-failed" });
    expect(requireAudio(audio).microphoneLive()).toBe(false);
    ipc.calls[0]?.resolve({ text: "before the stall" });
    await flushAsync();
    expect(transcripts).toEqual(["before the stall"]);
    expect(state()).toEqual({ kind: "failed", reason: "microphone-failed" });
  });
  it("fails a capture that never delivers a frame", async () => {
    vi.useFakeTimers();
    const { audio, record, state } = setup();
    await record();
    vi.advanceTimersByTime(SPEECH_CAPTURE_STALL_MS - 1);
    expect(state()).toEqual({ kind: "recording" });
    vi.advanceTimersByTime(1);
    expect(state()).toEqual({ kind: "failed", reason: "microphone-failed" });
    expect(requireAudio(audio).microphoneLive()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("clears every timer when the session ends", async () => {
    vi.useFakeTimers();
    const { coordinator, record, utter, state } = setup();
    await record();
    coordinator.stop();
    await flushAsync();
    expect(vi.getTimerCount()).toBe(0);
    await record();
    expect(state()).toEqual({ kind: "recording" });
    expect(vi.getTimerCount()).toBe(2);
    utter();
    expect(vi.getTimerCount()).toBe(3);
    coordinator.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("fails a transcription that exceeds its timeout and drops the late result", async () => {
    vi.useFakeTimers();
    const { audio, ipc, coordinator, transcripts, record, utter, state } = setup();
    await record();
    utter();
    utter();
    coordinator.stop();
    vi.advanceTimersByTime(SPEECH_TRANSCRIPTION_TIMEOUT_MS);
    await flushAsync();
    expect(state()).toEqual({ kind: "failed", reason: "transcription-failed" });
    expect(requireAudio(audio).microphoneLive()).toBe(false);
    ipc.calls[0]?.resolve({ text: "too late" });
    await flushAsync();
    expect(transcripts).toEqual([]);
    expect(ipc.calls.length).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects an implausible capture sample rate as a microphone failure", async () => {
    const { audio, record, speak, state } = setup({ audio: { sampleRate: 4000 } });
    await record();
    speak(1);
    await flushAsync();
    expect(state()).toEqual({ kind: "failed", reason: "microphone-failed" });
    expect(requireAudio(audio).microphoneLive()).toBe(false);
  });
});

describe("speech dictation failures", () => {
  it.each([
    ["NotAllowedError", "permission-denied"],
    ["NotFoundError", "microphone-failed"],
  ] as const)("ends in %s as %s and can restart", async (name, reason) => {
    let attempts = 0;
    const { audio, record, state } = setup({
      audio: {
        getUserMedia: () => {
          attempts += 1;
          if (attempts === 1) return Promise.reject(namedError(name));
          return Promise.resolve(new FakeMediaStream());
        },
      },
    });
    await record();
    expect(state()).toEqual({ kind: "failed", reason });
    expect(requireAudio(audio).microphoneLive()).toBe(false);
    await record();
    expect(state()).toEqual({ kind: "recording" });
  });
  it("delivers captured audio when the microphone fails mid-recording", async () => {
    const { audio, ipc, coordinator, transcripts, record, speak, state } = setup();
    await record();
    speak(1);
    requireAudio(audio).endTrack();
    expect(state()).toEqual({ kind: "finishing", outcome: "microphone-failed" });
    expect(requireAudio(audio).microphoneLive()).toBe(false);
    ipc.calls[0]?.resolve({ text: "captured before the failure" });
    await flushAsync();
    expect(transcripts).toEqual(["captured before the failure"]);
    expect(state()).toEqual({ kind: "failed", reason: "microphone-failed" });
    coordinator.cancel();
    expect(state()).toEqual({ kind: "idle" });
  });
  it("fails immediately when the microphone fails with nothing captured", async () => {
    const { audio, ipc, record, state } = setup();
    await record();
    requireAudio(audio).processorError();
    expect(state()).toEqual({ kind: "failed", reason: "microphone-failed" });
    expect(ipc.calls).toEqual([]);
  });
  it.each([
    "Runner speech transcription failed: busy (HTTP 429).",
    "Runner is busy; retry shortly",
  ])("retries the busy rejection %j in order and then fails as server busy", async (message) => {
    vi.useFakeTimers();
    const { audio, ipc, transcripts, record, utter, state } = setup();
    await record();
    utter();
    utter();
    for (const [attempt, delay] of SPEECH_BUSY_RETRY_DELAYS_MS.entries()) {
      ipc.calls[attempt]?.reject(message);
      await flushAsync();
      expect(state()).toEqual({ kind: "recording" });
      expect(ipc.calls.length).toBe(attempt + 1);
      vi.advanceTimersByTime(delay);
      await flushAsync();
      expect(ipc.calls.length).toBe(attempt + 2);
      expect(ipc.calls[attempt + 1]?.request.base64).toBe(ipc.calls[0]?.request.base64);
    }
    ipc.calls[SPEECH_BUSY_RETRY_DELAYS_MS.length]?.reject(message);
    await flushAsync();
    expect(state()).toEqual({ kind: "failed", reason: "server-busy" });
    expect(requireAudio(audio).microphoneLive()).toBe(false);
    expect(ipc.calls.length).toBe(SPEECH_BUSY_RETRY_DELAYS_MS.length + 1);
    expect(transcripts).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps the order when a busy retry succeeds", async () => {
    vi.useFakeTimers();
    const { ipc, coordinator, transcripts, record, speak, pause, state } = setup();
    await record();
    speak(2);
    pause();
    speak(3);
    pause();
    ipc.calls[0]?.reject("Runner is busy; retry shortly");
    await flushAsync();
    vi.advanceTimersByTime(SPEECH_BUSY_RETRY_DELAYS_MS[0] ?? 0);
    await flushAsync();
    ipc.calls[1]?.resolve({ text: "one" });
    await flushAsync();
    expect(ipc.calls[2]?.request.base64).not.toBe(ipc.calls[0]?.request.base64);
    ipc.calls[2]?.resolve({ text: "two" });
    await flushAsync();
    coordinator.stop();
    await flushAsync();
    expect(transcripts).toEqual(["one", "two"]);
    expect(state()).toEqual({ kind: "idle" });
  });
  it("abandons a busy retry on cancel", async () => {
    vi.useFakeTimers();
    const { ipc, coordinator, record, utter, state } = setup();
    await record();
    utter();
    ipc.calls[0]?.reject("Runner is busy; retry shortly");
    await flushAsync();
    coordinator.cancel();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    await flushAsync();
    expect(ipc.calls.length).toBe(1);
    expect(state()).toEqual({ kind: "idle" });
  });
  it.each([
    [undefined, "nothing"],
    [{ kind: "weird" }, "an unknown variant"],
    [{ kind: "transcribed", text: 5 }, "a non-text transcript"],
    [{ kind: "failed", reason: "exploded" }, "an unknown failure reason"],
  ])(
    "treats %j from the transcriber port as a failed transcription (%s)",
    async (result, _label) => {
      const { transcripts, record, frame, utterance, stopped, state } = setupWithPorts({
        transcriber: { transcribe: async () => result as never },
      });
      await record();
      frame(utterance());
      await flushAsync();
      expect(state()).toEqual({ kind: "failed", reason: "transcription-failed" });
      expect(stopped).toEqual([0]);
      expect(transcripts).toEqual([]);
    },
  );
  it("treats a rejecting transcriber port as a failed transcription", async () => {
    const { record, frame, utterance, state } = setupWithPorts({
      transcriber: { transcribe: () => Promise.reject(namedError("TypeError")) },
    });
    await record();
    frame(utterance());
    await flushAsync();
    expect(state()).toEqual({ kind: "failed", reason: "transcription-failed" });
  });
  it.each([
    ["Server is not connected", "server-disconnected"],
    ["Server connection changed during request", "server-disconnected"],
    ["Runner speech transcription failed: speech_unavailable (HTTP 503).", "transcription-failed"],
    ["Runner request failed (HTTP 500).", "transcription-failed"],
  ] as const)("maps the backend rejection %j to %s", async (message, reason) => {
    const { audio, ipc, transcripts, record, utter, state } = setup();
    await record();
    utter();
    utter();
    ipc.calls[0]?.reject(message);
    await flushAsync();
    expect(state()).toEqual({ kind: "failed", reason });
    expect(requireAudio(audio).microphoneLive()).toBe(false);
    expect(ipc.calls.length).toBe(1);
    expect(transcripts).toEqual([]);
  });
  it("fails on an invalid backend response without delivering it", async () => {
    const { ipc, transcripts, record, utter, state } = setup();
    await record();
    utter();
    ipc.calls[0]?.resolve({ text: "ok", injected: true });
    await flushAsync();
    expect(state()).toEqual({ kind: "failed", reason: "transcription-failed" });
    expect(transcripts).toEqual([]);
  });
  it("fails while finishing and discards the remaining queue", async () => {
    const { ipc, coordinator, transcripts, record, utter, state } = setup();
    await record();
    utter();
    utter();
    coordinator.stop();
    ipc.calls[0]?.resolve({ text: "one" });
    await flushAsync();
    ipc.calls[1]?.reject("Server is not connected");
    await flushAsync();
    expect(transcripts).toEqual(["one"]);
    expect(state()).toEqual({ kind: "failed", reason: "server-disconnected" });
  });
});

describe("speech dictation meter", () => {
  it("publishes level and elapsed time without notifying state subscribers", async () => {
    const { coordinator, record, speak, pause } = setup();
    const stateChanges = vi.fn();
    const meterChanges = vi.fn();
    await record();
    coordinator.subscribe(stateChanges);
    const unsubscribe = coordinator.meter.subscribe(meterChanges);
    expect(coordinator.meter.getSnapshot()).toEqual({ level: 0, elapsedMs: 0 });
    speak(1);
    const voiced = coordinator.meter.getSnapshot();
    expect(voiced.elapsedMs).toBe(1000);
    expect(voiced.level).toBeGreaterThan(0.15);
    expect(coordinator.meter.getSnapshot()).toBe(voiced);
    pause(0.5);
    expect(coordinator.meter.getSnapshot()).toEqual({ level: 0, elapsedMs: 1500 });
    expect(meterChanges.mock.calls.length).toBeGreaterThan(10);
    expect(stateChanges).not.toHaveBeenCalled();
    unsubscribe();
    const seen = meterChanges.mock.calls.length;
    speak(1);
    expect(meterChanges.mock.calls.length).toBe(seen);
  });
  it("silences the level on stop and resets when the session ends", async () => {
    const { ipc, coordinator, record, speak } = setup();
    await record();
    speak(1);
    coordinator.stop();
    expect(coordinator.meter.getSnapshot()).toEqual({ level: 0, elapsedMs: 1000 });
    ipc.calls[0]?.resolve({ text: "done" });
    await flushAsync();
    expect(coordinator.meter.getSnapshot()).toEqual({ level: 0, elapsedMs: 0 });
  });
  it("resets the meter on cancel", async () => {
    const { coordinator, record, speak } = setup();
    await record();
    speak(1);
    coordinator.cancel();
    expect(coordinator.meter.getSnapshot()).toEqual({ level: 0, elapsedMs: 0 });
  });
});
