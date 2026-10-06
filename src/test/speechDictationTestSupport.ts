import { vi } from "vitest";
import type { SpeechDictationPorts } from "../application/speechDictationPorts";
import { BrowserAudioCapture } from "../infrastructure/browserAudioCapture";
import {
  RemoteRunnerSpeechTranscriber,
  type SpeechTranscriptionGateway,
} from "../infrastructure/remoteRunnerSpeechTranscriber";
import { SPEECH_CAPTURE_CHUNK_SAMPLES } from "../infrastructure/speechCaptureWorkletProtocol";

export const SPEECH_WORKLET_TEST_URL = "http://tauri.localhost/assets/speechCapture.worklet.js";

export function dictationTestPorts(gateway: SpeechTranscriptionGateway): SpeechDictationPorts {
  return {
    capture: new BrowserAudioCapture(SPEECH_WORKLET_TEST_URL),
    transcriber: new RemoteRunnerSpeechTranscriber(gateway),
  };
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export async function flushAsync(turns = 12): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

export function namedError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

export function tone(seconds: number, sampleRate: number, amplitude = 0.3, hz = 220): Float32Array {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * hz * index) / sampleRate);
  }
  return samples;
}

export function silence(seconds: number, sampleRate: number): Float32Array {
  return new Float32Array(Math.round(seconds * sampleRate));
}

export function setDocumentVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

export function restoreDocumentVisibility(): void {
  Reflect.deleteProperty(document, "visibilityState");
}

export class FakeMediaTrack {
  stopped = false;
  readyState: "live" | "ended" = "live";
  onended: (() => void) | null = null;
  stop(): void {
    this.stopped = true;
    this.readyState = "ended";
  }
}

export class FakeMediaStream {
  readonly tracks = [new FakeMediaTrack()];
  getTracks(): readonly FakeMediaTrack[] {
    return this.tracks;
  }
  getAudioTracks(): readonly FakeMediaTrack[] {
    return this.tracks;
  }
}

export class FakeAudioNode {
  readonly connections: unknown[] = [];
  disconnected = false;
  connect(target: unknown): void {
    this.connections.push(target);
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

export class FakeWorkletNode extends FakeAudioNode {
  readonly port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    closed: false,
    close(): void {
      this.closed = true;
    },
  };
  onprocessorerror: (() => void) | null = null;
  constructor(
    readonly context: FakeAudioContext,
    readonly processorName: string,
    readonly options: unknown,
  ) {
    super();
  }
}

export class FakeAudioContext {
  state: "suspended" | "running" | "closed" = "suspended";
  readonly destination = { kind: "destination" };
  readonly modules: string[] = [];
  readonly sources: FakeAudioNode[] = [];
  readonly audioWorklet = {
    addModule: async (url: string): Promise<void> => {
      this.modules.push(url);
      await this.loadModule(url);
    },
  };
  constructor(
    readonly sampleRate: number,
    private readonly loadModule: (url: string) => Promise<void>,
    private readonly awaitResume: () => Promise<void>,
  ) {}
  createMediaStreamSource(): FakeAudioNode {
    const source = new FakeAudioNode();
    this.sources.push(source);
    return source;
  }
  async resume(): Promise<void> {
    await this.awaitResume();
    if (this.state === "suspended") this.state = "running";
  }
  async close(): Promise<void> {
    this.state = "closed";
  }
}

export interface FakeBrowserAudioOptions {
  readonly sampleRate?: number;
  readonly getUserMedia?: (constraints: unknown) => Promise<FakeMediaStream>;
  readonly loadModule?: (url: string) => Promise<void>;
  readonly resume?: () => Promise<void>;
  readonly worklet?: boolean;
}

export interface FakeBrowserAudio {
  readonly getUserMedia: ReturnType<typeof vi.fn<(constraints: unknown) => Promise<unknown>>>;
  readonly streams: FakeMediaStream[];
  readonly contexts: FakeAudioContext[];
  readonly nodes: FakeWorkletNode[];
  emit(samples: Float32Array): void;
  post(data: unknown): void;
  endTrack(): void;
  processorError(): void;
  microphoneLive(): boolean;
  restore(): void;
}

export function installFakeBrowserAudio(options: FakeBrowserAudioOptions = {}): FakeBrowserAudio {
  const streams: FakeMediaStream[] = [];
  const contexts: FakeAudioContext[] = [];
  const nodes: FakeWorkletNode[] = [];
  const sampleRate = options.sampleRate ?? 48000;
  const loadModule = options.loadModule ?? (async () => undefined);
  const awaitResume = options.resume ?? (async () => undefined);
  const openStream = options.getUserMedia ?? (async () => new FakeMediaStream());
  const getUserMedia = vi.fn(async (constraints: unknown): Promise<unknown> => {
    const stream = await openStream(constraints);
    streams.push(stream);
    return stream;
  });
  class ContextStub extends FakeAudioContext {
    constructor() {
      super(sampleRate, loadModule, awaitResume);
      contexts.push(this);
    }
  }
  class WorkletNodeStub extends FakeWorkletNode {
    constructor(context: FakeAudioContext, processorName: string, nodeOptions: unknown) {
      super(context, processorName, nodeOptions);
      nodes.push(this);
    }
  }
  const restoreDevices = stubMediaDevices({ getUserMedia });
  vi.stubGlobal("AudioContext", ContextStub);
  vi.stubGlobal("AudioWorkletNode", options.worklet === false ? undefined : WorkletNodeStub);
  const post = (data: unknown): void => {
    nodes[nodes.length - 1]?.port.onmessage?.({ data });
  };
  return {
    getUserMedia,
    streams,
    contexts,
    nodes,
    post,
    emit: (samples) => {
      for (let offset = 0; offset < samples.length; offset += SPEECH_CAPTURE_CHUNK_SAMPLES) {
        post(samples.slice(offset, offset + SPEECH_CAPTURE_CHUNK_SAMPLES));
      }
    },
    endTrack: () => {
      streams[streams.length - 1]?.tracks[0]?.onended?.();
    },
    processorError: () => {
      nodes[nodes.length - 1]?.onprocessorerror?.();
    },
    microphoneLive: () =>
      streams.some((stream) => stream.tracks.some((track) => !track.stopped)) ||
      contexts.some((context) => context.state !== "closed"),
    restore: () => {
      restoreDevices();
      vi.unstubAllGlobals();
    },
  };
}

function stubMediaDevices(mediaDevices: unknown): () => void {
  const host = globalThis.navigator;
  if (host === undefined) {
    vi.stubGlobal("navigator", { mediaDevices });
    return () => undefined;
  }
  const previous = Object.getOwnPropertyDescriptor(host, "mediaDevices");
  Object.defineProperty(host, "mediaDevices", { configurable: true, value: mediaDevices });
  return () => {
    Reflect.deleteProperty(host, "mediaDevices");
    if (previous !== undefined) Object.defineProperty(host, "mediaDevices", previous);
  };
}

export interface InvokeCall {
  readonly command: string;
  readonly request: Readonly<{ serverId: string; language: string; base64: string }>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

export interface ControlledInvoke {
  readonly invoke: (command: string, args?: Readonly<{ request: unknown }>) => Promise<unknown>;
  readonly calls: InvokeCall[];
}

export function controlledInvoke(): ControlledInvoke {
  const calls: InvokeCall[] = [];
  const invoke = (command: string, args?: Readonly<{ request: unknown }>): Promise<unknown> => {
    const pending = deferred<unknown>();
    calls.push({
      command,
      request: args?.request as InvokeCall["request"],
      resolve: pending.resolve,
      reject: pending.reject,
    });
    return pending.promise;
  };
  return { invoke, calls };
}

export function decodedPcmBytes(base64: string): number {
  return Buffer.from(base64, "base64").length;
}
