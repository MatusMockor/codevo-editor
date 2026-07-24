import type * as Monaco from "monaco-editor";
import type { JsTestProblemLineDecoration } from "../domain/jsTestProblemDecorations";

export const MAX_JS_TEST_PROBLEM_INLINE_MESSAGE_LENGTH = 128;
export const MAX_JS_TEST_PROBLEM_HOVER_ENTRIES = 20;
export const MAX_JS_TEST_PROBLEM_HOVER_BYTES = 16 * 1024;

const unsafeTextPattern = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]+/gu;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Maps one already owner-filtered source line into one presentation-only Monaco decoration. */
export function toJsTestProblemMonacoDecoration(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  line: JsTestProblemLineDecoration,
): Monaco.editor.IModelDeltaDecoration {
  const messages = line.entries.map(problemDisplayText);
  const inlineText = inlineProblemText(messages);
  const column = model.getLineLength(line.lineNumber) + 1;

  return {
    options: {
      after: {
        content: inlineText,
        inlineClassName: "js-test-problem-inline-message",
      },
      className: "js-test-problem-line",
      hoverMessage: {
        value: boundedHoverText(messages),
      },
      isWholeLine: true,
      overviewRuler: {
        color: "#d98b8b",
        position: monaco.editor.OverviewRulerLane.Right,
      },
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      zIndex: 6,
    },
    range: new monaco.Range(line.lineNumber, column, line.lineNumber, column),
  };
}

function problemDisplayText(entry: JsTestProblemLineDecoration["entries"][number]): string {
  const message = sanitizeSingleLine(entry.message) || fallbackMessage(entry.status);
  const name = entry.name ? sanitizeSingleLine(entry.name) : "";
  return name ? `${name}: ${message}` : message;
}

function inlineProblemText(messages: readonly string[]): string {
  const first = messages[0] ?? "Test failed.";
  const suffix = messages.length > 1 ? ` (+${messages.length - 1} more)` : "";
  const available = Math.max(1, MAX_JS_TEST_PROBLEM_INLINE_MESSAGE_LENGTH - suffix.length);
  return `${truncateUnicode(first, available)}${suffix}`;
}

function boundedHoverText(messages: readonly string[]): string {
  const separator = "\n\n";
  const footerReserve = 96;
  const bodyBudget = MAX_JS_TEST_PROBLEM_HOVER_BYTES - footerReserve;
  const visible: string[] = [];
  for (const message of messages.slice(0, MAX_JS_TEST_PROBLEM_HOVER_ENTRIES)) {
    const line = `**JavaScript Tests**: ${escapeMarkdown(message)}`;
    const candidate = [...visible, line].join(separator);
    if (encoder.encode(candidate).byteLength <= bodyBudget) {
      visible.push(line);
      continue;
    }
    if (visible.length === 0) {
      visible.push(truncateUtf8(line, bodyBudget));
    }
    break;
  }
  const omitted = messages.length - visible.length;
  const footer =
    omitted > 0
      ? `${separator}_${omitted} more JavaScript test ${omitted === 1 ? "problem" : "problems"} omitted\\._`
      : "";
  return truncateUtf8(`${visible.join(separator)}${footer}`, MAX_JS_TEST_PROBLEM_HOVER_BYTES);
}

function sanitizeSingleLine(value: string): string {
  return value.replace(unsafeTextPattern, " ").replace(/\s+/gu, " ").trim();
}

function fallbackMessage(status: "error" | "failed"): string {
  return status === "error" ? "Test errored." : "Test failed.";
}

function truncateUnicode(value: string, limit: number): string {
  const characters = Array.from(value);
  if (characters.length <= limit) return value;
  if (limit === 1) return "…";
  return `${characters.slice(0, limit - 1).join("")}…`;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maximumBytes) return value;
  const suffix = encoder.encode("…");
  let end = maximumBytes - suffix.byteLength;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return `${decoder.decode(bytes.slice(0, end))}…`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|]/g, "\\$&");
}
