import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioCaptureFrame } from "../application/speechDictationPorts";
import {
  FakeMediaStream,
  deferred,
  installFakeBrowserAudio,
  namedError,
  tone,
  type FakeBrowserAudio,
  type FakeBrowserAudioOptions,
} from "../test/speechDictationTestSupport";
import { BrowserAudioCapture, SPEECH_CAPTURE_START_TIMEOUT_MS } from "./browserAudioCapture";
import {
  SPEECH_CAPTURE_CHUNK_SAMPLES,
  SPEECH_CAPTURE_PROCESSOR_NAME,
} from "./speechCaptureWorkletProtocol";

const WORKLET_URL = "http://tauri.localhost/assets/speechCapture.worklet.js";
let audio: FakeBrowserAudio | null = null;
afterEach(() => {
  audio?.restore();
  audio = null;
  vi.useRealTimers();
});

function setup(options: FakeBrowserAudioOptions = {}) {
  const installed = installFakeBrowserAudio(options);
  audio = installed;
  const frames: AudioCaptureFrame[] = [];
  const failures: string[] = [];
  const capture = new BrowserAudioCapture(WORKLET_URL);
  const open = () =>
    capture.start({
      onFrame: (frame) => frames.push(frame),
      onFailure: (reason) => failures.push(reason),
    });
  return { audio: installed, capture, frames, failures, open };
}

describe("browser audio capture support", () => {
  it("is unsupported without media devices", async () => {
    const capture = new BrowserAudioCapture(WORKLET_URL);
    expect(capture.isSupported()).toBe(false);
    const handle = capture.start({ onFrame: vi.fn(), onFailure: vi.fn() });
    expect(await handle.started).toEqual({ kind: "failed", reason: "unsupported" });
    expect(() => handle.stop()).not.toThrow();
  });
  it("is unsupported without AudioWorklet", async () => {
    const { audio, capture, open } = setup({ worklet: false });
    expect(capture.isSupported()).toBe(false);
    expect(await open().started).toEqual({ kind: "failed", reason: "unsupported" });
    expect(audio.getUserMedia).not.toHaveBeenCalled();
  });
  it("is unsupported without an audio context", () => {
    const { capture } = setup();
    vi.stubGlobal("AudioContext", undefined);
    expect(capture.isSupported()).toBe(false);
  });
  it("is supported when the webview offers capture and AudioWorklet", () => {
    expect(setup().capture.isSupported()).toBe(true);
  });
});

describe("browser audio capture", () => {
  it("opens the microphone through a same-origin worklet module", async () => {
    const { audio, open } = setup();
    expect(await open().started).toEqual({ kind: "started" });
    expect(audio.getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    const context = audio.contexts[0];
    const node = audio.nodes[0];
    expect(context?.modules).toEqual([WORKLET_URL]);
    expect(context?.state).toBe("running");
    expect(node?.processorName).toBe(SPEECH_CAPTURE_PROCESSOR_NAME);
    expect(node?.options).toMatchObject({ channelCount: 1, channelCountMode: "explicit" });
    expect(context?.sources[0]?.connections).toEqual([node]);
    expect(node?.connections).toEqual([context?.destination]);
  });
  it("delivers mono frames with the context sample rate", async () => {
    const { audio, frames, open } = setup({ sampleRate: 44100 });
    await open().started;
    audio.emit(tone(0.1, 44100));
    expect(frames.length).toBe(Math.ceil(4410 / SPEECH_CAPTURE_CHUNK_SAMPLES));
    expect(frames.every((frame) => frame.sampleRate === 44100)).toBe(true);
    expect(frames.reduce((sum, frame) => sum + frame.samples.length, 0)).toBe(4410);
  });
  it("ignores malformed worklet messages", async () => {
    const { audio, frames, open } = setup();
    await open().started;
    audio.post(null);
    audio.post([0.1, 0.2]);
    audio.post(new Float32Array(0));
    audio.post(new Float32Array(SPEECH_CAPTURE_CHUNK_SAMPLES + 1));
    audio.post(new Float64Array(128));
    expect(frames).toEqual([]);
  });
  it.each([
    ["NotAllowedError", "permission-denied"],
    ["SecurityError", "permission-denied"],
    ["NotFoundError", "failed"],
    ["NotReadableError", "failed"],
    ["OverconstrainedError", "failed"],
  ])("maps %s to %s", async (name, reason) => {
    const { audio, failures, open } = setup({
      getUserMedia: () => Promise.reject(namedError(name)),
    });
    expect(await open().started).toEqual({ kind: "failed", reason });
    expect(audio.contexts).toEqual([]);
    expect(audio.microphoneLive()).toBe(false);
    expect(failures).toEqual([]);
  });
  it("maps a non-error rejection to a failure", async () => {
    const { open } = setup({ getUserMedia: () => Promise.reject("denied") });
    expect(await open().started).toEqual({ kind: "failed", reason: "failed" });
  });
  it("releases the microphone when the worklet module cannot load", async () => {
    const { audio, open } = setup({
      loadModule: () => Promise.reject(namedError("NotAllowedError")),
    });
    expect(await open().started).toEqual({ kind: "failed", reason: "failed" });
    expect(audio.streams[0]?.tracks[0]?.stopped).toBe(true);
    expect(audio.microphoneLive()).toBe(false);
  });
  it("releases every track, node and the context on stop", async () => {
    const { audio, frames, open } = setup();
    const handle = open();
    await handle.started;
    expect(audio.microphoneLive()).toBe(true);
    handle.stop();
    const node = audio.nodes[0];
    expect(audio.streams[0]?.tracks.every((track) => track.stopped)).toBe(true);
    expect(node?.disconnected).toBe(true);
    expect(node?.port.closed).toBe(true);
    expect(node?.port.onmessage).toBeNull();
    expect(audio.contexts[0]?.sources[0]?.disconnected).toBe(true);
    expect(audio.contexts[0]?.state).toBe("closed");
    expect(audio.microphoneLive()).toBe(false);
    audio.emit(tone(0.1, 48000));
    expect(frames).toEqual([]);
  });
  it("stops idempotently", async () => {
    const { audio, open } = setup();
    const handle = open();
    await handle.started;
    const close = vi.spyOn(audio.contexts[0] as NonNullable<(typeof audio.contexts)[0]>, "close");
    handle.stop();
    handle.stop();
    handle.stop();
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("releases a stream granted after stop", async () => {
    const granted = deferred<FakeMediaStream>();
    const { audio, open } = setup({ getUserMedia: () => granted.promise });
    const handle = open();
    handle.stop();
    const stream = new FakeMediaStream();
    granted.resolve(stream);
    expect(await handle.started).toEqual({ kind: "failed", reason: "failed" });
    expect(stream.tracks[0]?.stopped).toBe(true);
    expect(audio.contexts).toEqual([]);
    expect(audio.nodes).toEqual([]);
  });
  it("releases the microphone when stopped while the worklet loads", async () => {
    const loading = deferred<void>();
    const { audio, open } = setup({ loadModule: () => loading.promise });
    const handle = open();
    await vi.waitFor(() => expect(audio.contexts.length).toBe(1));
    handle.stop();
    expect(audio.microphoneLive()).toBe(false);
    loading.resolve();
    expect(await handle.started).toEqual({ kind: "failed", reason: "failed" });
    expect(audio.nodes).toEqual([]);
  });
  it("releases the microphone when stopped while the context resumes", async () => {
    const resuming = deferred<void>();
    const resume = vi.fn(() => resuming.promise);
    const { audio, open } = setup({ resume });
    const handle = open();
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    handle.stop();
    expect(audio.microphoneLive()).toBe(false);
    resuming.resolve();
    expect(await handle.started).toEqual({ kind: "failed", reason: "failed" });
    expect(audio.nodes).toEqual([]);
    expect(audio.contexts[0]?.state).toBe("closed");
  });
  it("fails and releases the microphone when the context cannot resume", async () => {
    const { audio, open } = setup({
      resume: () => Promise.reject(namedError("NotAllowedError")),
    });
    expect(await open().started).toEqual({ kind: "failed", reason: "failed" });
    expect(audio.microphoneLive()).toBe(false);
    expect(audio.nodes).toEqual([]);
  });
  it.each([
    ["the worklet module", { loadModule: () => new Promise<void>(() => undefined) }],
    ["the audio context", { resume: () => new Promise<void>(() => undefined) }],
  ])("gives up and releases the microphone when %s never becomes ready", async (_, options) => {
    vi.useFakeTimers();
    const { audio, open } = setup(options);
    const handle = open();
    await vi.waitFor(() => expect(audio.contexts.length).toBe(1));
    expect(audio.microphoneLive()).toBe(true);
    vi.advanceTimersByTime(SPEECH_CAPTURE_START_TIMEOUT_MS - 1);
    expect(audio.microphoneLive()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(await handle.started).toEqual({ kind: "failed", reason: "failed" });
    expect(audio.microphoneLive()).toBe(false);
    expect(audio.nodes).toEqual([]);
  });
  it("does not leave a start deadline armed after a successful start", async () => {
    vi.useFakeTimers();
    const { open } = setup();
    expect(await open().started).toEqual({ kind: "started" });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("fails when the track ended before the graph was connected", async () => {
    const loading = deferred<void>();
    const { audio, failures, open } = setup({ loadModule: () => loading.promise });
    const handle = open();
    await vi.waitFor(() => expect(audio.streams.length).toBe(1));
    const track = audio.streams[0]?.tracks[0];
    expect(track).toBeDefined();
    if (track) track.readyState = "ended";
    loading.resolve();
    expect(await handle.started).toEqual({ kind: "failed", reason: "failed" });
    expect(audio.microphoneLive()).toBe(false);
    expect(audio.nodes).toEqual([]);
    expect(failures).toEqual([]);
  });
  it("reports a processor error and releases the microphone", async () => {
    const { audio, failures, open } = setup();
    await open().started;
    audio.processorError();
    expect(failures).toEqual(["failed"]);
    expect(audio.microphoneLive()).toBe(false);
  });
  it.each([
    ["an ended track", (installed: FakeBrowserAudio) => installed.endTrack()],
    ["a processor error", (installed: FakeBrowserAudio) => installed.processorError()],
  ])("reports %s once and releases the microphone", async (_, trigger) => {
    const { audio, failures, frames, open } = setup();
    const handle = open();
    await handle.started;
    const track = audio.streams[0]?.tracks[0];
    const ended = track?.onended;
    trigger(audio);
    ended?.();
    expect(failures).toEqual(["failed"]);
    expect(audio.microphoneLive()).toBe(false);
    audio.emit(tone(0.1, 48000));
    expect(frames).toEqual([]);
    handle.stop();
    expect(failures).toEqual(["failed"]);
  });
  it("does not report a failure for a track that ends after stop", async () => {
    const { audio, failures, open } = setup();
    const handle = open();
    await handle.started;
    const ended = audio.streams[0]?.tracks[0]?.onended;
    handle.stop();
    ended?.();
    expect(failures).toEqual([]);
  });
});
