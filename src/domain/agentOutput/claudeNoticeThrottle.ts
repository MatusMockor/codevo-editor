import type { AgentTurnEvent } from "../agentThread";
import {
  claudeMalformedFrameOverflowNotice,
  claudeNoticeClass,
  claudeNoticeLine,
  claudeUnknownFrameOverflowNotice,
  type ClaudeNoticeClass,
} from "./claudeStreamNotices";

export const MAX_CLAUDE_UNKNOWN_FRAME_TYPES = 16;
export const MAX_CLAUDE_MALFORMED_FRAME_TYPES = 8;
export const MAX_CLAUDE_RETRY_NOTICES = 8;

type ClaudeFrameNotice = Exclude<ClaudeNoticeClass, { readonly kind: "apiRetry" }>;

export interface ClaudeFrameNoticeBudget {
  readonly types: ReadonlySet<string>;
  readonly overflowReported: boolean;
}

export interface ClaudeNoticeThrottle {
  readonly unknownFrames: ClaudeFrameNoticeBudget;
  readonly malformedFrames: ClaudeFrameNoticeBudget;
  readonly retryNotices: number;
  readonly retryOverflowReported: boolean;
  readonly heldRetry: AgentTurnEvent | null;
  readonly heldRetryCount: number;
}

export interface ClaudeNoticeThrottleResult {
  readonly state: ClaudeNoticeThrottle;
  readonly events: ReadonlyArray<AgentTurnEvent>;
}

const EMPTY_FRAME_BUDGET: ClaudeFrameNoticeBudget = { types: new Set(), overflowReported: false };

export const INITIAL_CLAUDE_NOTICE_THROTTLE: ClaudeNoticeThrottle = {
  unknownFrames: EMPTY_FRAME_BUDGET,
  malformedFrames: EMPTY_FRAME_BUDGET,
  retryNotices: 0,
  retryOverflowReported: false,
  heldRetry: null,
  heldRetryCount: 0,
};

export function throttleClaudeNotices(
  previous: ClaudeNoticeThrottle | undefined,
  events: ReadonlyArray<AgentTurnEvent>,
): ClaudeNoticeThrottleResult {
  let state = previous ?? INITIAL_CLAUDE_NOTICE_THROTTLE;
  const output: AgentTurnEvent[] = [];
  for (const event of events) {
    const step = throttleEvent(state, event);
    state = step.state;
    output.push(...step.events);
  }
  return { state, events: output };
}

export function flushClaudeNotices(
  previous: ClaudeNoticeThrottle | undefined,
): ClaudeNoticeThrottleResult {
  const state = previous ?? INITIAL_CLAUDE_NOTICE_THROTTLE;
  if (state.heldRetry === null) return { state, events: [] };
  return {
    state: { ...state, heldRetry: null, heldRetryCount: 0, retryNotices: state.retryNotices + 1 },
    events: [heldRetryNotice(state.heldRetry, state.heldRetryCount)],
  };
}

function throttleEvent(
  state: ClaudeNoticeThrottle,
  event: AgentTurnEvent,
): ClaudeNoticeThrottleResult {
  const notice = claudeNoticeClass(event);
  if (notice?.kind === "apiRetry") return throttleRetry(state, event);
  const flushed = flushClaudeNotices(state);
  if (notice === null) {
    return { state: flushed.state, events: [...flushed.events, event] };
  }
  const frame = throttleFrame(flushed.state, notice, event);
  return { state: frame.state, events: [...flushed.events, ...frame.events] };
}

function throttleRetry(
  state: ClaudeNoticeThrottle,
  event: AgentTurnEvent,
): ClaudeNoticeThrottleResult {
  if (state.retryNotices === 0 && state.heldRetry === null) {
    return { state: { ...state, retryNotices: 1 }, events: [event] };
  }
  if (state.heldRetry === null && state.retryNotices >= MAX_CLAUDE_RETRY_NOTICES) {
    return retryOverflow(state);
  }
  return {
    state: { ...state, heldRetry: event, heldRetryCount: state.heldRetryCount + 1 },
    events: [],
  };
}

function retryOverflow(state: ClaudeNoticeThrottle): ClaudeNoticeThrottleResult {
  if (state.retryOverflowReported) return { state, events: [] };
  return {
    state: { ...state, retryOverflowReported: true },
    events: [claudeNoticeLine("Further Claude API retry notices omitted for this turn")],
  };
}

function throttleFrame(
  state: ClaudeNoticeThrottle,
  notice: ClaudeFrameNotice,
  event: AgentTurnEvent,
): ClaudeNoticeThrottleResult {
  switch (notice.kind) {
    case "unknownFrame": {
      const step = budgetFrame(
        state.unknownFrames,
        notice.frameType,
        MAX_CLAUDE_UNKNOWN_FRAME_TYPES,
      );
      return {
        state: { ...state, unknownFrames: step.budget },
        events: frameEvents(step.emit, event, claudeUnknownFrameOverflowNotice),
      };
    }
    case "malformedFrame": {
      const step = budgetFrame(
        state.malformedFrames,
        notice.frameType,
        MAX_CLAUDE_MALFORMED_FRAME_TYPES,
      );
      return {
        state: { ...state, malformedFrames: step.budget },
        events: frameEvents(step.emit, event, claudeMalformedFrameOverflowNotice),
      };
    }
  }
}

type FrameEmission = "notice" | "overflow" | "none";

function budgetFrame(
  budget: ClaudeFrameNoticeBudget,
  frameType: string,
  limit: number,
): { readonly budget: ClaudeFrameNoticeBudget; readonly emit: FrameEmission } {
  if (budget.types.has(frameType)) return { budget, emit: "none" };
  if (budget.types.size < limit) {
    return { budget: { ...budget, types: new Set([...budget.types, frameType]) }, emit: "notice" };
  }
  if (budget.overflowReported) return { budget, emit: "none" };
  return { budget: { ...budget, overflowReported: true }, emit: "overflow" };
}

function frameEvents(
  emit: FrameEmission,
  event: AgentTurnEvent,
  overflowNotice: () => AgentTurnEvent,
): ReadonlyArray<AgentTurnEvent> {
  switch (emit) {
    case "notice":
      return [event];
    case "overflow":
      return [overflowNotice()];
    case "none":
      return [];
  }
}

function heldRetryNotice(event: AgentTurnEvent, count: number): AgentTurnEvent {
  if (count <= 1 || event.kind !== "unknownLine") return event;
  return claudeNoticeLine(`${event.raw} (${count - 1} earlier retries coalesced)`);
}
