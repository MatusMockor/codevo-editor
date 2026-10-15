import { codeLanguageForPath, type CodeLanguageId } from "../../domain/codeHighlight/codeLanguage";
import type { AgentToolRowKind } from "../../domain/agentToolRowPresentation";
import { reindentJson } from "./agentToolRowOutputFormatJson";

export const MAX_TOOL_OUTPUT_JSON_BYTES = 262_144;
const MAX_TOOL_OUTPUT_PATH_CHARS = 4_096;
const NUMBERED_LINE = /^\s*\d+(\t|→|:\s|\s{2,})/;

export type AgentToolOutputFormat =
  | { readonly kind: "plain"; readonly text: string }
  | { readonly kind: "code"; readonly text: string; readonly language: CodeLanguageId };

export interface AgentToolOutputSource {
  readonly rowKind: AgentToolRowKind;
  readonly inputSummary: string;
  readonly output: string;
}

export function agentToolOutputFormat(source: AgentToolOutputSource): AgentToolOutputFormat {
  const json = prettyJson(source.output);
  if (json !== null) return { kind: "code", text: json, language: "json" };
  const language = pathLanguage(source);
  if (language === null) return { kind: "plain", text: source.output };
  return { kind: "code", text: source.output, language };
}

export function prettyJson(text: string): string | null {
  if (text.length > MAX_TOOL_OUTPUT_JSON_BYTES) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  if (utf8ByteLengthExceeds(trimmed, MAX_TOOL_OUTPUT_JSON_BYTES)) return null;
  return reindentJson(trimmed);
}

function pathLanguage(source: AgentToolOutputSource): CodeLanguageId | null {
  if (source.rowKind !== "read") return null;
  const path = source.inputSummary.trim();
  if (path.length === 0 || path.length > MAX_TOOL_OUTPUT_PATH_CHARS) return null;
  if (/[\r\n]/.test(path)) return null;
  const language = codeLanguageForPath(path);
  if (language === "plaintext") return null;
  if (looksLineNumbered(source.output)) return null;
  return language;
}

function looksLineNumbered(output: string): boolean {
  const end = output.indexOf("\n");
  const first = end === -1 ? output : output.slice(0, end);
  return NUMBERED_LINE.test(first);
}

function utf8ByteLengthExceeds(text: string, limit: number): boolean {
  if (text.length * 3 <= limit) return false;
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code >= 0xd800 && code < 0xdc00 ? 4 : 3;
    if (code >= 0xd800 && code < 0xdc00) index += 1;
    if (bytes > limit) return true;
  }
  return false;
}
