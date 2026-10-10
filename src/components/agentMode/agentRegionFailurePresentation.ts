export type AgentRegion = "sidebar" | "conversation" | "composer" | "rightPanel";

export interface AgentRegionFailure {
  readonly region: AgentRegion;
  readonly error: unknown;
  readonly componentStack: string | null;
}

export const AGENT_REGION_FAILURE_DETAILS_MAX_CHARS = 4096;

const NAME_MAX_CHARS = 80;
const MESSAGE_MAX_CHARS = 500;
const STACK_SCAN_MAX_CHARS = 16_000;
const STACK_MAX_FRAMES = 20;
const STACK_FRAME_MAX_CHARS = 150;
const TRUNCATION_MARK = "… [truncated]";
const OMITTED_FRAMES_MARK = "… [further frames omitted]";
const UNKNOWN_NAME = "Error";
const UNKNOWN_MESSAGE = "No error message was reported.";
const UNKNOWN_STACK = "Component stack unavailable.";

const REGION_LABELS: Readonly<Record<AgentRegion, string>> = {
  sidebar: "sidebar",
  conversation: "conversation",
  composer: "composer",
  rightPanel: "side panel",
};

export function agentRegionFailureTitle(region: AgentRegion): string {
  return `The ${REGION_LABELS[region]} couldn't be displayed`;
}

export function agentRegionFailureDetails(failure: AgentRegionFailure): string {
  const lines = [
    `Codevo agent mode: the ${REGION_LABELS[failure.region]} failed to render`,
    `${errorName(failure.error)}: ${errorMessage(failure.error)}`,
    "Component stack:",
    ...stackFrames(failure.componentStack).map((frame) => `  ${frame}`),
  ];
  return boundedText(lines.join("\n"), AGENT_REGION_FAILURE_DETAILS_MAX_CHARS);
}

function errorName(error: unknown): string {
  if (!(error instanceof Error)) return UNKNOWN_NAME;
  return singleLine(error.name, NAME_MAX_CHARS) || UNKNOWN_NAME;
}

function errorMessage(error: unknown): string {
  return singleLine(rawMessage(error), MESSAGE_MAX_CHARS) || UNKNOWN_MESSAGE;
}

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (!(error instanceof Error)) return "";
  return error.message;
}

function stackFrames(componentStack: string | null): ReadonlyArray<string> {
  if (componentStack === null) return [UNKNOWN_STACK];
  const frames = componentStack
    .slice(0, STACK_SCAN_MAX_CHARS)
    .split("\n")
    .map((frame) => singleLine(frame, STACK_FRAME_MAX_CHARS))
    .filter((frame) => frame !== "");
  if (frames.length === 0) return [UNKNOWN_STACK];
  if (frames.length <= STACK_MAX_FRAMES && componentStack.length <= STACK_SCAN_MAX_CHARS) {
    return frames;
  }
  return [...frames.slice(0, STACK_MAX_FRAMES), OMITTED_FRAMES_MARK];
}

function singleLine(text: string, maxChars: number): string {
  const scanLimit = maxChars * 4;
  const collapsed = text
    .slice(0, scanLimit)
    .replace(/[\p{Cc}\p{Cf}\s]+/gu, " ")
    .trim();
  if (text.length > scanLimit) return truncatedText(collapsed, maxChars);
  return boundedText(collapsed, maxChars);
}

function boundedText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return truncatedText(text, maxChars);
}

function truncatedText(text: string, maxChars: number): string {
  const room = Math.max(0, maxChars - TRUNCATION_MARK.length);
  return `${withoutDanglingSurrogate(text.slice(0, room))}${TRUNCATION_MARK}`;
}

function withoutDanglingSurrogate(text: string): string {
  const last = text.charCodeAt(text.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) return text.slice(0, -1);
  return text;
}
