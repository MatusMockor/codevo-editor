import type { AgentTurnEvent } from "../agentThread";
import { claudeNoticeClass, claudeNoticeLine } from "./claudeStreamNotices";

export const MAX_CLAUDE_UNKNOWN_FRAME_TYPES = 16;
export const MAX_CLAUDE_RETRY_NOTICES = 8;

export interface ClaudeNoticeThrottle {
  readonly frameTypes: ReadonlySet<string>;
  readonly frameOverflowReported: boolean;
  readonly retryNotices: number;
  readonly retryOverflowReported: boolean;
  readonly heldRetry: AgentTurnEvent | null;
  readonly heldRetryCount: number;
}

export interface ClaudeNoticeThrottleResult {
  readonly state: ClaudeNoticeThrottle;
  readonly events: ReadonlyArray<AgentTurnEvent>;
}

export const INITIAL_CLAUDE_NOTICE_THROTTLE: ClaudeNoticeThrottle = {
  frameTypes: new Set(),
  frameOverflowReported: false,
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
  if (notice?.kind !== "unknownFrame") {
    return { state: flushed.state, events: [...flushed.events, event] };
  }
  const frame = throttleFrame(flushed.state, notice.frameType, event);
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
  frameType: string,
  event: AgentTurnEvent,
): ClaudeNoticeThrottleResult {
  if (state.frameTypes.has(frameType)) return { state, events: [] };
  if (state.frameTypes.size < MAX_CLAUDE_UNKNOWN_FRAME_TYPES) {
    return {
      state: { ...state, frameTypes: new Set([...state.frameTypes, frameType]) },
      events: [event],
    };
  }
  if (state.frameOverflowReported) return { state, events: [] };
  return {
    state: { ...state, frameOverflowReported: true },
    events: [
      claudeNoticeLine("Further unsupported Claude stream frame types omitted for this turn"),
    ],
  };
}

function heldRetryNotice(event: AgentTurnEvent, count: number): AgentTurnEvent {
  if (count <= 1 || event.kind !== "unknownLine") return event;
  return claudeNoticeLine(`${event.raw} (${count - 1} earlier retries coalesced)`);
}
