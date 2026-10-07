import type {
  AudioCaptureFailureReason,
  AudioCaptureHandle,
  AudioCapturePort,
  AudioCaptureSink,
  AudioCaptureStartOutcome,
} from "../application/speechDictationPorts";
import {
  SYSTEM_DEFAULT_SPEECH_INPUT,
  type SpeechInputSetting,
} from "../domain/speechDictationInputSetting";
import {
  mediaErrorName,
  openAudioInput,
  releaseMediaStream,
  type AudioInputMedia,
  type OpenedAudioInput,
} from "./browserAudioInputStream";
import {
  SPEECH_CAPTURE_PROCESSOR_NAME,
  isSpeechCaptureChunk,
} from "./speechCaptureWorkletProtocol";

interface BrowserAudioApi extends AudioInputMedia {
  readonly AudioContext: typeof AudioContext;
  readonly AudioWorkletNode: typeof AudioWorkletNode;
}

export interface BrowserAudioCaptureInput {
  readonly selected: () => SpeechInputSetting;
  readonly opened: () => void;
}

const SYSTEM_DEFAULT_CAPTURE_INPUT: BrowserAudioCaptureInput = {
  selected: () => SYSTEM_DEFAULT_SPEECH_INPUT,
  opened: () => undefined,
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
const STARTED_ON_SYSTEM_DEFAULT: AudioCaptureStartOutcome = {
  kind: "started",
  inputFallback: "system-default",
};

export class BrowserAudioCapture implements AudioCapturePort {
  constructor(
    private readonly workletModuleUrl: string,
    private readonly input: BrowserAudioCaptureInput = SYSTEM_DEFAULT_CAPTURE_INPUT,
  ) {}

  isSupported(): boolean {
    return browserAudioApi() !== null;
  }

  start(sink: AudioCaptureSink): AudioCaptureHandle {
    const api = browserAudioApi();
    if (api === null) return { started: Promise.resolve(UNSUPPORTED), stop: () => undefined };
    const session = new BrowserAudioCaptureSession(
      api,
      this.workletModuleUrl,
      sink,
      this.input.selected(),
      this.input.opened,
    );
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
    private readonly input: SpeechInputSetting,
    private readonly opened: () => void,
  ) {}

  readonly stop = (): void => {
    if (this.stopped) return;
    this.stopped = true;
    this.release();
  };

  async open(): Promise<AudioCaptureStartOutcome> {
    const input = await this.requestStream();
    if (typeof input === "string") return { kind: "failed", reason: input };
    this.stream = input.stream;
    quietly(this.opened);
    const outcome = await this.connectWithinDeadline(input.stream);
    if (outcome.kind === "failed") {
      this.stop();
      return outcome;
    }
    return input.fallback ? STARTED_ON_SYSTEM_DEFAULT : outcome;
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

  private async requestStream(): Promise<OpenedAudioInput | AudioCaptureFailureReason> {
    try {
      return await openAudioInput(this.api, this.input, () => this.stopped);
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
    if (stream !== null) releaseMediaStream(stream);
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
    enumerateDevices: () => enumerateMediaDevices(devices),
    AudioContext: globalThis.AudioContext,
    AudioWorkletNode: globalThis.AudioWorkletNode,
  };
}

function enumerateMediaDevices(devices: MediaDevices): Promise<readonly unknown[]> {
  if (typeof devices.enumerateDevices !== "function") return Promise.resolve([]);
  return devices.enumerateDevices();
}

function isLive(stream: MediaStream): boolean {
  const tracks = stream.getAudioTracks();
  return tracks.length > 0 && tracks.every((track) => track.readyState === "live");
}

function streamFailureReason(error: unknown): AudioCaptureFailureReason {
  if (PERMISSION_ERROR_NAMES.has(mediaErrorName(error))) return "permission-denied";
  return "failed";
}

function releaseNode(node: AudioWorkletNode): void {
  node.port.onmessage = null;
  node.onprocessorerror = null;
  quietly(() => node.port.close());
  quietly(() => node.disconnect());
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
