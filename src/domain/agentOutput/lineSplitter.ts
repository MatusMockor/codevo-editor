import { utf8ByteLength } from "./utf8Text";

export const MAX_AGENT_OUTPUT_LINE_BYTES = 256 * 1_024;

export interface AgentOutputPendingLine {
  readonly pending: string;
  readonly pendingBytes: number;
}

export interface AgentOutputSplitResult {
  readonly state: AgentOutputPendingLine;
  readonly lines: ReadonlyArray<string>;
  readonly overflow: number;
}

export const EMPTY_PENDING_LINE: AgentOutputPendingLine = { pending: "", pendingBytes: 0 };

const DISCARDING_BYTES = MAX_AGENT_OUTPUT_LINE_BYTES + 1;
const NO_LINES: ReadonlyArray<string> = [];

export function splitLines(state: AgentOutputPendingLine, chunk: string): AgentOutputSplitResult {
  if (chunk.length === 0) return { state, lines: NO_LINES, overflow: 0 };
  const lines: string[] = [];
  let overflow = 0;
  let pending = state.pending;
  let pendingBytes = state.pendingBytes;
  let start = 0;

  while (start <= chunk.length) {
    const newline = chunk.indexOf("\n", start);
    if (newline === -1) break;
    const segment = chunk.slice(start, newline);
    start = newline + 1;
    const discarding = pendingBytes > MAX_AGENT_OUTPUT_LINE_BYTES;
    const totalBytes = pendingBytes + utf8ByteLength(segment);
    if (discarding) {
      pending = "";
      pendingBytes = 0;
      continue;
    }
    if (totalBytes > MAX_AGENT_OUTPUT_LINE_BYTES) {
      overflow += 1;
      pending = "";
      pendingBytes = 0;
      continue;
    }
    lines.push(withoutCarriageReturn(pending + segment));
    pending = "";
    pendingBytes = 0;
  }

  const tail = chunk.slice(start);
  if (pendingBytes > MAX_AGENT_OUTPUT_LINE_BYTES) {
    return { state: { pending: "", pendingBytes: DISCARDING_BYTES }, lines, overflow };
  }
  const tailBytes = pendingBytes + utf8ByteLength(tail);
  if (tailBytes > MAX_AGENT_OUTPUT_LINE_BYTES) {
    return {
      state: { pending: "", pendingBytes: DISCARDING_BYTES },
      lines,
      overflow: overflow + 1,
    };
  }
  return { state: { pending: pending + tail, pendingBytes: tailBytes }, lines, overflow };
}

export function isDiscardingPendingLine(state: AgentOutputPendingLine): boolean {
  return state.pendingBytes > MAX_AGENT_OUTPUT_LINE_BYTES;
}

function withoutCarriageReturn(line: string): string {
  if (!line.endsWith("\r")) return line;
  return line.slice(0, -1);
}
