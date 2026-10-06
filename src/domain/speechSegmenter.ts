import {
  SPEECH_BYTES_PER_SAMPLE,
  SPEECH_MAX_SEGMENT_BYTES,
  SPEECH_MIN_SEGMENT_BYTES,
  SPEECH_SAMPLE_RATE,
  pcm16RmsLevel,
  pcm16ToBytes,
} from "./speechPcm";

export const SPEECH_ANALYSIS_WINDOW_SAMPLES = SPEECH_SAMPLE_RATE / 50;
export const SPEECH_MIN_SEGMENT_SAMPLES = SPEECH_SAMPLE_RATE * 2;
export const SPEECH_TRAILING_SILENCE_SAMPLES = (SPEECH_SAMPLE_RATE * 600) / 1000;
export const SPEECH_MAX_SEGMENT_SAMPLES = SPEECH_MAX_SEGMENT_BYTES / SPEECH_BYTES_PER_SAMPLE;
export const SPEECH_MIN_TAIL_SAMPLES = SPEECH_MIN_SEGMENT_BYTES / SPEECH_BYTES_PER_SAMPLE;
export const SPEECH_LEADING_SILENCE_SAMPLES = (SPEECH_SAMPLE_RATE * 300) / 1000;
export const SPEECH_MIN_VOICED_SAMPLES = SPEECH_SAMPLE_RATE / 10;
export const SPEECH_MAX_SOFT_LEAD_SAMPLES = SPEECH_SAMPLE_RATE * 2;
export const SPEECH_VOICE_RMS_THRESHOLD = 0.01;
export const SPEECH_KEEP_RMS_THRESHOLD = 0.0018;

export type SpeechSegment = Readonly<{ pcm: Uint8Array }>;
export type SpeechSegmenterState = Readonly<{
  chunks: readonly Int16Array[];
  samples: number;
  voicedSamples: number;
  trailingSilenceSamples: number;
  trailingQuietSamples: number;
}>;
export type SpeechSegmenterStep = Readonly<{
  state: SpeechSegmenterState;
  segments: readonly SpeechSegment[];
}>;

const EMPTY: SpeechSegmenterState = {
  chunks: [],
  samples: 0,
  voicedSamples: 0,
  trailingSilenceSamples: 0,
  trailingQuietSamples: 0,
};

export function createSpeechSegmenter(): SpeechSegmenterState {
  return EMPTY;
}

export function pushSpeechFrame(
  state: SpeechSegmenterState,
  frame: Int16Array,
): SpeechSegmenterStep {
  let current = state;
  const segments: SpeechSegment[] = [];
  for (let offset = 0; offset < frame.length; offset += SPEECH_ANALYSIS_WINDOW_SAMPLES) {
    const window = frame.subarray(offset, offset + SPEECH_ANALYSIS_WINDOW_SAMPLES);
    const step = pushWindow(current, window);
    current = step.state;
    segments.push(...step.segments);
  }
  return { state: current, segments };
}

export function flushSpeechSegmenter(state: SpeechSegmenterState): SpeechSegmenterStep {
  return { state: EMPTY, segments: completedSegments(state) };
}

function pushWindow(state: SpeechSegmenterState, window: Int16Array): SpeechSegmenterStep {
  const overflowing = state.samples + window.length > SPEECH_MAX_SEGMENT_SAMPLES;
  const base = overflowing ? EMPTY : state;
  const segments = overflowing ? completedSegments(state) : [];
  const appended = trimLeadingSilence(appendWindow(base, window));
  if (!endsAtPause(appended)) return { state: appended, segments };
  return { state: EMPTY, segments: [...segments, ...completedSegments(appended)] };
}

function appendWindow(state: SpeechSegmenterState, window: Int16Array): SpeechSegmenterState {
  const level = pcm16RmsLevel(window);
  const voiced = level >= SPEECH_VOICE_RMS_THRESHOLD;
  const kept = level >= SPEECH_KEEP_RMS_THRESHOLD;
  return {
    chunks: [...state.chunks, window.slice()],
    samples: state.samples + window.length,
    voicedSamples: state.voicedSamples + (voiced ? window.length : 0),
    trailingSilenceSamples: voiced ? 0 : state.trailingSilenceSamples + window.length,
    trailingQuietSamples: kept ? 0 : state.trailingQuietSamples + window.length,
  };
}

function trimLeadingSilence(state: SpeechSegmenterState): SpeechSegmenterState {
  if (state.voicedSamples > 0) return state;
  const limit = leadingSampleLimit(state);
  let first = 0;
  let samples = state.samples;
  while (first < state.chunks.length - 1 && samples > limit) {
    samples -= state.chunks[first]?.length ?? 0;
    first += 1;
  }
  if (first === 0) return state;
  return {
    chunks: state.chunks.slice(first),
    samples,
    voicedSamples: 0,
    trailingSilenceSamples: samples,
    trailingQuietSamples: Math.min(state.trailingQuietSamples, samples),
  };
}

function leadingSampleLimit(state: SpeechSegmenterState): number {
  if (holdsSoftOnset(state)) return SPEECH_MAX_SOFT_LEAD_SAMPLES;
  return SPEECH_LEADING_SILENCE_SAMPLES;
}

function holdsSoftOnset(state: SpeechSegmenterState): boolean {
  const pause = Math.min(state.samples, SPEECH_TRAILING_SILENCE_SAMPLES);
  return state.trailingQuietSamples < pause;
}

function endsAtPause(state: SpeechSegmenterState): boolean {
  return (
    state.voicedSamples > 0 &&
    state.samples >= SPEECH_MIN_SEGMENT_SAMPLES &&
    state.trailingSilenceSamples >= SPEECH_TRAILING_SILENCE_SAMPLES
  );
}

function completedSegments(state: SpeechSegmenterState): readonly SpeechSegment[] {
  if (state.voicedSamples < SPEECH_MIN_VOICED_SAMPLES) return [];
  if (state.samples < SPEECH_MIN_TAIL_SAMPLES) return [];
  return [{ pcm: pcm16ToBytes(joinChunks(state)) }];
}

function joinChunks(state: SpeechSegmenterState): Int16Array {
  const joined = new Int16Array(state.samples);
  let offset = 0;
  for (const chunk of state.chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}
