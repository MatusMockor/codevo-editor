import { agentElapsedLabel } from "./agentRuntimeSubagentPresentation";

export const AGENT_ELAPSED_TICK_MS = 1_000;
export const AGENT_ELAPSED_STALE_AFTER_MS = 120_000;
export const AGENT_ELAPSED_DESCRIPTION_STEP_MS = 30_000;
export const MAX_AGENT_ELAPSED_OBSERVATIONS = 256;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export interface AgentElapsedTarget {
  readonly clock: HTMLElement;
  readonly stale: HTMLElement | null;
  readonly description: HTMLElement | null;
}

export interface AgentElapsedReading {
  readonly displayMs: number;
  readonly silentForMs: number | null;
}

export interface AgentElapsedTicker {
  observe(key: string, observedDurationMs: number): void;
  register(key: string, observedDurationMs: number, target: AgentElapsedTarget): () => void;
  dispose(): void;
}

interface ElapsedAnchor {
  readonly observedDurationMs: number;
  readonly anchoredAtEpochMs: number;
}

interface ElapsedRegistration {
  readonly key: string;
  readonly target: AgentElapsedTarget;
  describedAtMs: number | null;
}

export function agentElapsedReading(
  observedDurationMs: number,
  anchoredAtEpochMs: number,
  nowEpochMs: number,
): AgentElapsedReading {
  const silentMs = Math.max(0, nowEpochMs - anchoredAtEpochMs);
  if (silentMs <= AGENT_ELAPSED_STALE_AFTER_MS)
    return { displayMs: observedDurationMs + silentMs, silentForMs: null };
  return {
    displayMs: observedDurationMs + AGENT_ELAPSED_STALE_AFTER_MS,
    silentForMs: silentMs,
  };
}

export function agentSilenceLabel(silentForMs: number): string {
  if (silentForMs >= HOUR_MS) return `no update for ${agentElapsedLabel(silentForMs)}`;
  return `no update for ${Math.floor(silentForMs / MINUTE_MS)}m`;
}

export function createAgentElapsedTicker(now: () => number = Date.now): AgentElapsedTicker {
  const anchors = new Map<string, ElapsedAnchor>();
  const registrations = new Map<HTMLElement, ElapsedRegistration>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const evictAnchors = (): void => {
    if (anchors.size <= MAX_AGENT_ELAPSED_OBSERVATIONS) return;
    const shown = new Set([...registrations.values()].map((registration) => registration.key));
    for (const oldest of [...anchors.keys()]) {
      if (anchors.size <= MAX_AGENT_ELAPSED_OBSERVATIONS) return;
      if (shown.has(oldest)) continue;
      anchors.delete(oldest);
    }
    for (const oldest of [...anchors.keys()]) {
      if (anchors.size <= MAX_AGENT_ELAPSED_OBSERVATIONS) return;
      anchors.delete(oldest);
    }
  };

  const observe = (key: string, observedDurationMs: number): ElapsedAnchor => {
    const known = anchors.get(key);
    const anchor =
      known?.observedDurationMs === observedDurationMs
        ? known
        : { observedDurationMs, anchoredAtEpochMs: now() };
    anchors.delete(key);
    anchors.set(key, anchor);
    evictAnchors();
    return anchor;
  };

  const writeRegistration = (registration: ElapsedRegistration, current: number): void => {
    const anchor = anchors.get(registration.key);
    if (anchor === undefined) return;
    const reading = agentElapsedReading(
      anchor.observedDurationMs,
      anchor.anchoredAtEpochMs,
      current,
    );
    const { clock, stale, description } = registration.target;
    writeText(clock, agentElapsedLabel(reading.displayMs));
    writeText(stale, reading.silentForMs === null ? "" : agentSilenceLabel(reading.silentForMs));
    const described = registration.describedAtMs;
    if (
      described !== null &&
      Math.abs(reading.displayMs - described) < AGENT_ELAPSED_DESCRIPTION_STEP_MS
    )
      return;
    registration.describedAtMs = reading.displayMs;
    writeText(description, `Elapsed ${agentElapsedLabel(reading.displayMs)}`);
  };

  const write = (): void => {
    const current = now();
    for (const registration of registrations.values()) writeRegistration(registration, current);
  };

  const stop = (): void => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };

  return {
    observe(key, observedDurationMs) {
      observe(key, observedDurationMs);
    },
    register(key, observedDurationMs, target) {
      const registration: ElapsedRegistration = { key, target, describedAtMs: null };
      registrations.set(target.clock, registration);
      observe(key, observedDurationMs);
      writeRegistration(registration, now());
      timer ??= setInterval(write, AGENT_ELAPSED_TICK_MS);
      return () => {
        if (registrations.get(target.clock) !== registration) return;
        registrations.delete(target.clock);
        writeText(target.stale, "");
        if (registrations.size === 0) stop();
      };
    },
    dispose() {
      registrations.clear();
      anchors.clear();
      stop();
    },
  };
}

function writeText(element: HTMLElement | null, text: string): void {
  if (element === null || element.textContent === text) return;
  element.textContent = text;
}
