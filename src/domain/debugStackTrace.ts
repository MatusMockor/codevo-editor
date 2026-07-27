import type { StackFrame } from "./debug";

export const MAX_DEBUG_STACK_TRACE_FRAMES = 256;
export const DEBUG_STACK_TRACE_TRUNCATION_MARKER =
  "[Stack trace truncated to the inspectable frame limit]";
const MAX_FRAME_NAME_LENGTH = 1_024;
const MAX_FRAME_PATH_LENGTH = 4_096;
const MAX_STACK_TRACE_LENGTH = 1_048_576;

export function formatDebugStackTrace(
  frames: readonly StackFrame[],
  framesTruncated = false,
): string | null {
  if (frames.length === 0 || frames.length > MAX_DEBUG_STACK_TRACE_FRAMES) return null;
  const lines: string[] = [];
  let length = 0;
  for (const frame of frames) {
    const line = formatDebugStackFrame(frame);
    if (line === null) return null;
    length += line.length + (lines.length === 0 ? 0 : 1);
    if (length > MAX_STACK_TRACE_LENGTH) return null;
    lines.push(line);
  }
  if (framesTruncated) {
    length += DEBUG_STACK_TRACE_TRUNCATION_MARKER.length + 1;
    if (length > MAX_STACK_TRACE_LENGTH) return null;
    lines.push(DEBUG_STACK_TRACE_TRUNCATION_MARKER);
  }
  return lines.join("\n");
}

export function formatDebugStackFrame(frame: StackFrame): string | null {
  if (!isCleanBoundedText(frame.name, MAX_FRAME_NAME_LENGTH)) return null;
  if (frame.filePath === null) return frame.name;
  if (
    !isCleanBoundedText(frame.filePath, MAX_FRAME_PATH_LENGTH) ||
    !Number.isSafeInteger(frame.lineNumber) ||
    frame.lineNumber < 1
  ) {
    return null;
  }
  return `${frame.name} (${frame.filePath}:${frame.lineNumber})`;
}

function isCleanBoundedText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\0\r\n]/u.test(value)
  );
}
