import type {
  AudioCaptureFailureReason,
  AudioCaptureHandle,
  AudioCapturePort,
  AudioCaptureSink,
  AudioCaptureStartOutcome,
} from "../application/speechDictationPorts";
import {
  SPEECH_CAPTURE_PROCESSOR_NAME,
  isSpeechCaptureChunk,
} from "./speechCaptureWorkletProtocol";

interface BrowserAudioApi {
  readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  readonly AudioContext: typeof AudioContext;
  readonly AudioWorkletNode: typeof AudioWorkletNode;
}

const CAPTURE_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: false,
};
const CAPTURE_NODE_OPTIONS: AudioWorkletNodeOptions = {
  numberOfInputs: 1,
  numberOfOutputs: 1,
  outputChannelCount: [1],
  channelCount: 1,
  channelCountMode: "explicit",
  channelInterpretation: "speakers",
};
export const SPEECH_CAPTURE_START_TIMEOUT_MS = 10_000;

const PERMISSION_ERROR_NAMES: ReadonlySet<string> = new Set(["NotAllowedError", "SecurityError"]);
const UNSUPPORTED: AudioCaptureStartOutcome = { kind: "failed", reason: "unsupported" };
const FAILED: AudioCaptureStartOutcome = { kind: "failed", reason: "failed" };
const STARTED: AudioCaptureStartOutcome = { kind: "started" };

export class BrowserAudioCapture implements AudioCapturePort {
  constructor(private readonly workletModuleUrl: string) {}

  isSupported(): boolean {
    return browserAudioApi() !== null;
  }

  start(sink: AudioCaptureSink): AudioCaptureHandle {
    const api = browserAudioApi();
    if (api === null) return { started: Promise.resolve(UNSUPPORTED), stop: () => undefined };
    const session = new BrowserAudioCaptureSession(api, this.workletModuleUrl, sink);
    return { started: session.open(), stop: session.stop };
  }
}

class BrowserAudioCaptureSession {
  private stopped = false;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;

  constructor(
    private readonly api: BrowserAudioApi,
    private readonly workletModuleUrl: string,
    private readonly sink: AudioCaptureSink,
  ) {}

  readonly stop = (): void => {
    if (this.stopped) return;
    this.stopped = true;
    this.release();
  };

  async open(): Promise<AudioCaptureStartOutcome> {
    const stream = await this.requestStream();
    if (typeof stream === "string") return { kind: "failed", reason: stream };
    this.stream = stream;
    const outcome = await this.connectWithinDeadline(stream);
    if (outcome.kind === "failed") this.stop();
    return outcome;
  }

  private connectWithinDeadline(stream: MediaStream): Promise<AudioCaptureStartOutcome> {
    return new Promise((resolve) => {
      const deadline = setTimeout(() => resolve(FAILED), SPEECH_CAPTURE_START_TIMEOUT_MS);
      const settle = (outcome: AudioCaptureStartOutcome): void => {
        clearTimeout(deadline);
        resolve(outcome);
      };
      this.connect(stream).then(settle, () => settle(FAILED));
    });
  }

  private async requestStream(): Promise<MediaStream | AudioCaptureFailureReason> {
    try {
      return await this.api.getUserMedia(CAPTURE_CONSTRAINTS);
    } catch (error) {
      this.stop();
      return streamFailureReason(error);
    }
  }

  private async connect(stream: MediaStream): Promise<AudioCaptureStartOutcome> {
    if (this.stopped) return this.abandon();
    const context = new this.api.AudioContext();
    this.context = context;
    await context.audioWorklet.addModule(this.workletModuleUrl);
    if (this.stopped) return this.abandon();
    if (context.state === "suspended") await context.resume();
    if (this.stopped || !isLive(stream)) return this.abandon();
    const source = context.createMediaStreamSource(stream);
    this.source = source;
    const node = new this.api.AudioWorkletNode(
      context,
      SPEECH_CAPTURE_PROCESSOR_NAME,
      CAPTURE_NODE_OPTIONS,
    );
    this.node = node;
    node.port.onmessage = (event) => this.forward(event.data, context.sampleRate);
    node.onprocessorerror = () => this.fail();
    for (const track of stream.getAudioTracks()) track.onended = () => this.fail();
    source.connect(node);
    node.connect(context.destination);
    return STARTED;
  }

  private abandon(): AudioCaptureStartOutcome {
    this.release();
    return FAILED;
  }

  private forward(data: unknown, sampleRate: number): void {
    if (this.stopped || !isSpeechCaptureChunk(data)) return;
    this.sink.onFrame({ samples: data, sampleRate });
  }

  private fail(): void {
    if (this.stopped) return;
    this.stop();
    this.sink.onFailure("failed");
  }

  private release(): void {
    const { node, source, stream, context } = this;
    this.node = null;
    this.source = null;
    this.stream = null;
    this.context = null;
    if (node !== null) releaseNode(node);
    if (source !== null) quietly(() => source.disconnect());
    if (stream !== null) releaseStream(stream);
    if (context !== null) closeContext(context);
  }
}

function browserAudioApi(): BrowserAudioApi | null {
  const devices = globalThis.navigator?.mediaDevices;
  if (typeof devices?.getUserMedia !== "function") return null;
  if (typeof globalThis.AudioContext !== "function") return null;
  if (typeof globalThis.AudioWorkletNode !== "function") return null;
  return {
    getUserMedia: (constraints) => devices.getUserMedia(constraints),
    AudioContext: globalThis.AudioContext,
    AudioWorkletNode: globalThis.AudioWorkletNode,
  };
}

function isLive(stream: MediaStream): boolean {
  const tracks = stream.getAudioTracks();
  return tracks.length > 0 && tracks.every((track) => track.readyState === "live");
}

function streamFailureReason(error: unknown): AudioCaptureFailureReason {
  if (PERMISSION_ERROR_NAMES.has(errorName(error))) return "permission-denied";
  return "failed";
}

function errorName(error: unknown): string {
  if (typeof error !== "object" || error === null || !("name" in error)) return "";
  return typeof error.name === "string" ? error.name : "";
}

function releaseNode(node: AudioWorkletNode): void {
  node.port.onmessage = null;
  node.onprocessorerror = null;
  quietly(() => node.port.close());
  quietly(() => node.disconnect());
}

function releaseStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.onended = null;
    quietly(() => track.stop());
  }
}

function closeContext(context: AudioContext): void {
  if (context.state === "closed") return;
  quietly(() => void context.close().catch(() => undefined));
}

function quietly(action: () => void): void {
  try {
    action();
  } catch {
    return;
  }
}
