const UTF8_ENCODER = new TextEncoder();

export const CLIPPED_AGENT_PROMPT_PREFIX_BYTES = 512;
export const CLIPPED_AGENT_PROMPT_MARKER =
  "…[prompt clipped; the full prompt is in this turn's log]";

export function utf8ByteLength(text: string): number {
  return UTF8_ENCODER.encode(text).byteLength;
}

export function clipUtf8Text(text: string, limitBytes: number): string {
  if (limitBytes <= 0) return "";
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) return text.slice(0, index);
    const width = utf8Width(codePoint);
    if (bytes + width > limitBytes) return text.slice(0, index);
    bytes += width;
    index += codePoint > 0xffff ? 2 : 1;
  }
  return text;
}

const CLIPPED_AGENT_PROMPT_MARKER_BYTES = utf8ByteLength(CLIPPED_AGENT_PROMPT_MARKER);
const CLIPPED_AGENT_PROMPT_MIN_SOURCE_BYTES =
  CLIPPED_AGENT_PROMPT_PREFIX_BYTES + CLIPPED_AGENT_PROMPT_MARKER_BYTES;

export function clipAgentPromptForPersistence(prompt: string): string | null {
  if (utf8ByteLength(prompt) <= CLIPPED_AGENT_PROMPT_MIN_SOURCE_BYTES) return null;
  const prefix = clipUtf8Text(prompt, CLIPPED_AGENT_PROMPT_PREFIX_BYTES);
  return `${prefix}${CLIPPED_AGENT_PROMPT_MARKER}`;
}

export function agentPromptLooksClipped(prompt: string): boolean {
  return prompt.endsWith(CLIPPED_AGENT_PROMPT_MARKER);
}

export function restoreAgentPromptFromLog(jsonPrompt: string, logPrompt: string): string | null {
  if (!agentPromptLooksClipped(jsonPrompt)) return null;
  const body = jsonPrompt.slice(0, jsonPrompt.length - CLIPPED_AGENT_PROMPT_MARKER.length);
  if (!logPrompt.startsWith(body)) return null;
  if (utf8ByteLength(logPrompt) <= utf8ByteLength(jsonPrompt)) return null;
  return logPrompt;
}

function utf8Width(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}
