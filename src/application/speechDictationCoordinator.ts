import {
  SPEECH_BUSY_RETRY_DELAYS_MS,
  SPEECH_CAPTURE_STALL_MS,
  SPEECH_MAX_QUEUED_SEGMENTS,
  SPEECH_MAX_SESSION_MS,
  SPEECH_TRANSCRIPTION_TIMEOUT_MS,
  canStartSpeechDictation,
  initialSpeechDictationState,
  reduceSpeechDictation,
  speechDictationAvailability,
  type SpeechDictationAvailability,
  type SpeechDictationEvent,
  type SpeechDictationFailureReason,
  type SpeechDictationFinishOutcome,
  type SpeechDictationInput,
  type SpeechDictationState,
  type SpeechDictationTranscriptOutcome,
  type SpeechLanguage,
} from "../domain/speechDictation";
import {
  SPEECH_MAX_INPUT_SAMPLE_RATE,
  SPEECH_SAMPLE_RATE,
  createSpeechResampler,
  floatToPcm16,
  resampleSpeechFrame,
  speechRmsLevel,
  type SpeechResamplerState,
} from "../domain/speechPcm";
import {
  createSpeechSegmenter,
  flushSpeechSegmenter,
  pushSpeechFrame,
  type SpeechSegment,
  type SpeechSegmenterState,
} from "../domain/speechSegmenter";
import { parseSpeechTranscription, type SpeechTranscription } from "../domain/speechTranscription";
import {
  createSpeechDictationMeterStore,
  notifyQuietly,
  type SpeechDictationMeterStore,
} from "./speechDictationMeterStore";
import type {
  AudioCaptureFailureReason,
  AudioCaptureFrame,
  AudioCaptureHandle,
  AudioCaptureStartOutcome,
  SpeechDictationPorts,
} from "./speechDictationPorts";

export const SPEECH_MAX_SESSION_SAMPLES = (SPEECH_MAX_SESSION_MS / 1000) * SPEECH_SAMPLE_RATE;
export const SPEECH_MAX_CAPTURE_FRAME_SAMPLES = SPEECH_MAX_INPUT_SAMPLE_RATE;

export type SpeechDictationBinding = Readonly<{
  ownerId: string;
  serverIds: readonly string[];
  language: SpeechLanguage;
  onTranscript: (text: string) => void;
}>;

type Timer = ReturnType<typeof setTimeout>;

interface Session {
  readonly generation: number;
  readonly serverId: string;
  readonly language: SpeechLanguage;
  readonly queue: Uint8Array[];
  capture: AudioCaptureHandle | null;
  resampler: SpeechResamplerState | null;
  segmenter: SpeechSegmenterState;
  capturedSamples: number;
  framesReceived: number;
  segmentsRequested: number;
  transcriptsDelivered: number;
  transcribing: boolean;
  sessionTimer: Timer | null;
  stallTimer: Timer | null;
  transcriptionTimer: Timer | null;
}

const TRANSCRIPTION_FAILED: SpeechTranscription = {
  kind: "failed",
  reason: "transcription-failed",
};
const CAPTURE_FAILED: AudioCaptureStartOutcome = { kind: "failed", reason: "failed" };

export class SpeechDictationCoordinator {
  private readonly meterStore = createSpeechDictationMeterStore();
  private readonly listeners = new Set<() => void>();
  private binding: SpeechDictationBinding | null = null;
  private session: Session | null = null;
  private generation = 0;
  private captureUnsupported = false;
  private state: SpeechDictationState;

  readonly meter: SpeechDictationMeterStore = this.meterStore;

  constructor(
    private readonly ports: SpeechDictationPorts,
    binding: SpeechDictationBinding | null = null,
  ) {
    this.binding = binding;
    this.state = initialSpeechDictationState(this.availability());
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): SpeechDictationState => this.state;

  readonly bind = (binding: SpeechDictationBinding): void => {
    const previous = this.binding;
    this.binding = binding;
    this.revoke(previous, binding);
    this.dispatch({ type: "availability", availability: this.availability() });
  };

  readonly start = (): void => {
    const binding = this.binding;
    const serverId = binding?.serverIds[0];
    if (binding === null || serverId === undefined) return;
    if (this.session !== null || !canStartSpeechDictation(this.state)) return;
    const session = this.openSession(serverId, binding.language);
    this.dispatch({ type: "start" });
    void this.beginCapture(session);
  };

  readonly stop = (): void => {
    const session = this.session;
    if (session === null) return;
    if (this.state.kind === "starting") {
      this.closeSession(session);
      this.dispatch({ type: "capture-ended", outcome: "completed" });
      return;
    }
    this.endCapture(session, "completed");
  };

  readonly cancel = (): void => {
    this.generation += 1;
    if (this.session !== null) this.closeSession(this.session);
    this.dispatch({ type: "reset" });
  };

  private availability(): SpeechDictationAvailability {
    return speechDictationAvailability({
      captureSupported: !this.captureUnsupported && this.captureSupported(),
      serverId: this.binding?.serverIds[0] ?? null,
    });
  }

  private captureSupported(): boolean {
    try {
      return this.ports.capture.isSupported();
    } catch {
      return false;
    }
  }

  private revoke(previous: SpeechDictationBinding | null, next: SpeechDictationBinding): void {
    if (previous !== null && previous.ownerId !== next.ownerId) {
      this.cancel();
      return;
    }
    const session = this.session;
    if (session === null) return;
    if (this.availability().kind === "unavailable") {
      this.closeSession(session);
      return;
    }
    if (next.serverIds.includes(session.serverId)) return;
    this.failSession(session, "server-disconnected");
  }

  private openSession(serverId: string, language: SpeechLanguage): Session {
    this.generation += 1;
    const session: Session = {
      generation: this.generation,
      serverId,
      language,
      queue: [],
      capture: null,
      resampler: null,
      segmenter: createSpeechSegmenter(),
      capturedSamples: 0,
      framesReceived: 0,
      segmentsRequested: 0,
      transcriptsDelivered: 0,
      transcribing: false,
      sessionTimer: null,
      stallTimer: null,
      transcriptionTimer: null,
    };
    this.session = session;
    this.meterStore.reset();
    return session;
  }

  private isCurrent(session: Session): boolean {
    return this.session === session && this.generation === session.generation;
  }

  private closeSession(session: Session): void {
    if (this.session === session) {
      this.session = null;
      this.generation += 1;
    }
    this.releaseCapture(session);
    if (session.transcriptionTimer !== null) clearTimeout(session.transcriptionTimer);
    session.transcriptionTimer = null;
    session.queue.length = 0;
    session.segmenter = createSpeechSegmenter();
    this.meterStore.reset();
  }

  private releaseCapture(session: Session): void {
    if (session.sessionTimer !== null) clearTimeout(session.sessionTimer);
    if (session.stallTimer !== null) clearTimeout(session.stallTimer);
    session.sessionTimer = null;
    session.stallTimer = null;
    const capture = session.capture;
    session.capture = null;
    if (capture !== null) stopQuietly(capture);
  }

  private failSession(session: Session, reason: SpeechDictationFailureReason): void {
    this.closeSession(session);
    this.dispatch({ type: "fail", reason });
  }

  private async beginCapture(session: Session): Promise<void> {
    const outcome = await this.startCapture(session);
    if (!this.isCurrent(session)) return;
    if (outcome.kind === "failed") {
      this.captureFailed(session, outcome.reason);
      return;
    }
    if (this.state.kind !== "starting") return;
    session.sessionTimer = setTimeout(
      () => this.endCapture(session, "limit-reached"),
      SPEECH_MAX_SESSION_MS,
    );
    this.watchStall(session, session.framesReceived);
    this.dispatch({ type: "capture-ready", input: captureInput(outcome) });
  }

  private async startCapture(session: Session): Promise<AudioCaptureStartOutcome> {
    if (!this.isCurrent(session)) return CAPTURE_FAILED;
    try {
      const capture = this.ports.capture.start({
        onFrame: (frame) => this.acceptFrame(session, frame),
        onFailure: (reason) => this.captureFailed(session, reason),
      });
      if (!this.isCurrent(session)) {
        stopQuietly(capture);
        return CAPTURE_FAILED;
      }
      session.capture = capture;
      return await capture.started;
    } catch {
      return CAPTURE_FAILED;
    }
  }

  private watchStall(session: Session, framesSeen: number): void {
    session.stallTimer = setTimeout(() => {
      session.stallTimer = null;
      if (!this.isRecording(session)) return;
      if (session.framesReceived === framesSeen) {
        this.endCapture(session, "microphone-failed");
        return;
      }
      this.watchStall(session, session.framesReceived);
    }, SPEECH_CAPTURE_STALL_MS);
  }

  private captureFailed(session: Session, reason: AudioCaptureFailureReason): void {
    if (!this.isCurrent(session)) return;
    if (this.state.kind === "recording") {
      this.endCapture(session, "microphone-failed");
      return;
    }
    if (this.state.kind !== "starting") return;
    this.closeSession(session);
    if (reason === "unsupported") this.captureUnsupported = true;
    this.dispatch(startFailureEvent(reason, this.availability()));
  }

  private acceptFrame(session: Session, frame: AudioCaptureFrame): void {
    if (!this.isRecording(session)) return;
    session.framesReceived += 1;
    const samples = this.resample(session, frame);
    if (samples === null) {
      this.endCapture(session, "microphone-failed");
      return;
    }
    const accepted = samples.subarray(0, SPEECH_MAX_SESSION_SAMPLES - session.capturedSamples);
    if (accepted.length === 0) return;
    session.capturedSamples += accepted.length;
    const step = pushSpeechFrame(session.segmenter, floatToPcm16(accepted));
    session.segmenter = step.state;
    this.meterStore.publish({
      level: speechRmsLevel(accepted),
      elapsedMs: elapsedMs(session),
    });
    this.enqueue(session, step.segments);
    if (!this.isRecording(session)) return;
    if (session.capturedSamples < SPEECH_MAX_SESSION_SAMPLES) return;
    this.endCapture(session, "limit-reached");
  }

  private isRecording(session: Session): boolean {
    return this.isCurrent(session) && this.state.kind === "recording";
  }

  private resample(session: Session, frame: AudioCaptureFrame): Float32Array | null {
    if (frame.samples.length > SPEECH_MAX_CAPTURE_FRAME_SAMPLES) return null;
    const resampler = this.resamplerFor(session, frame.sampleRate);
    if (resampler === null) return null;
    const step = resampleSpeechFrame(resampler, frame.samples);
    session.resampler = step.state;
    return step.samples;
  }

  private resamplerFor(session: Session, sampleRate: number): SpeechResamplerState | null {
    const current = session.resampler;
    if (current !== null && current.inputRate === Math.round(sampleRate)) return current;
    return createSpeechResampler(sampleRate);
  }

  private enqueue(session: Session, segments: readonly SpeechSegment[]): void {
    const capacity = Math.max(0, SPEECH_MAX_QUEUED_SEGMENTS - session.queue.length);
    const accepted = segments.slice(0, capacity);
    session.queue.push(...accepted.map((segment) => segment.pcm));
    this.pump(session);
    if (!this.isRecording(session)) return;
    const overflowed = accepted.length < segments.length;
    if (!overflowed && session.queue.length < SPEECH_MAX_QUEUED_SEGMENTS) return;
    this.endCapture(session, "limit-reached");
  }

  private endCapture(session: Session, outcome: SpeechDictationFinishOutcome): void {
    if (!this.isRecording(session)) return;
    this.releaseCapture(session);
    const step = flushSpeechSegmenter(session.segmenter);
    session.segmenter = step.state;
    this.meterStore.publish({ level: 0, elapsedMs: elapsedMs(session) });
    this.dispatch({ type: "capture-ended", outcome });
    if (!this.isCurrent(session)) return;
    this.enqueue(session, step.segments);
    this.settle(session);
  }

  private pump(session: Session): void {
    if (!this.isCurrent(session) || session.transcribing) return;
    const pcm = session.queue.shift();
    if (pcm === undefined) return;
    session.transcribing = true;
    session.segmentsRequested += 1;
    void this.transcribe(session, pcm);
  }

  private async transcribe(session: Session, pcm: Uint8Array): Promise<void> {
    const result = await this.transcribeHead(session, pcm, 0);
    if (!this.isCurrent(session)) return;
    session.transcribing = false;
    if (result.kind === "failed") {
      this.failSession(session, result.reason);
      return;
    }
    this.deliver(session, result.text);
    if (!this.isCurrent(session)) return;
    this.pump(session);
    this.settle(session);
  }

  private async transcribeHead(
    session: Session,
    pcm: Uint8Array,
    attempt: number,
  ): Promise<SpeechTranscription> {
    const result = await this.requestTranscription(session, pcm);
    const retryDelay = SPEECH_BUSY_RETRY_DELAYS_MS[attempt];
    if (retryDelay === undefined || !this.isCurrent(session)) return result;
    if (result.kind !== "failed" || result.reason !== "server-busy") return result;
    await this.waitForRetry(session, retryDelay);
    if (!this.isCurrent(session)) return result;
    return this.transcribeHead(session, pcm, attempt + 1);
  }

  private waitForRetry(session: Session, delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      session.transcriptionTimer = setTimeout(() => {
        session.transcriptionTimer = null;
        resolve();
      }, delayMs);
    });
  }

  private requestTranscription(session: Session, pcm: Uint8Array): Promise<SpeechTranscription> {
    return new Promise((resolve) => {
      session.transcriptionTimer = setTimeout(
        () => resolve(TRANSCRIPTION_FAILED),
        SPEECH_TRANSCRIPTION_TIMEOUT_MS,
      );
      void this.callTranscriber(session, pcm).then((result) => {
        if (session.transcriptionTimer !== null) clearTimeout(session.transcriptionTimer);
        session.transcriptionTimer = null;
        resolve(result);
      });
    });
  }

  private async callTranscriber(session: Session, pcm: Uint8Array): Promise<SpeechTranscription> {
    try {
      return parseSpeechTranscription(
        await this.ports.transcriber.transcribe({
          serverId: session.serverId,
          language: session.language,
          pcm,
        }),
      );
    } catch {
      return TRANSCRIPTION_FAILED;
    }
  }

  private deliver(session: Session, text: string): void {
    const transcript = text.trim();
    const binding = this.binding;
    if (transcript.length === 0 || binding === null) return;
    try {
      binding.onTranscript(transcript);
      session.transcriptsDelivered += 1;
    } catch {
      if (this.isCurrent(session)) this.failSession(session, "transcription-failed");
    }
  }

  private settle(session: Session): void {
    if (!this.isCurrent(session) || this.state.kind !== "finishing") return;
    if (session.transcribing || session.queue.length > 0) return;
    this.closeSession(session);
    this.dispatch({ type: "drained", transcript: transcriptOutcome(session) });
  }

  private dispatch(event: SpeechDictationEvent): void {
    const next = reduceSpeechDictation(this.state, event);
    if (next === this.state) return;
    this.state = next;
    for (const listener of [...this.listeners]) notifyQuietly(listener);
  }
}

function stopQuietly(capture: AudioCaptureHandle): void {
  try {
    capture.stop();
  } catch {
    return;
  }
}

function elapsedMs(session: Session): number {
  return Math.floor((session.capturedSamples * 1000) / SPEECH_SAMPLE_RATE);
}

function captureInput(
  outcome: Extract<AudioCaptureStartOutcome, { kind: "started" }>,
): SpeechDictationInput {
  if (outcome.inputFallback === "system-default") return "system-default";
  return "selected";
}

function transcriptOutcome(session: Session): SpeechDictationTranscriptOutcome {
  if (session.transcriptsDelivered > 0) return "delivered";
  if (session.segmentsRequested > 0) return "empty";
  return "no-speech";
}

function startFailureEvent(
  reason: AudioCaptureFailureReason,
  availability: SpeechDictationAvailability,
): SpeechDictationEvent {
  switch (reason) {
    case "permission-denied":
      return { type: "fail", reason: "permission-denied" };
    case "failed":
      return { type: "fail", reason: "microphone-failed" };
    case "unsupported":
      return { type: "availability", availability };
    default:
      return unreachable(reason);
  }
}

function unreachable(value: never): never {
  throw new TypeError(`Unsupported audio capture failure: ${JSON.stringify(value)}`);
}
