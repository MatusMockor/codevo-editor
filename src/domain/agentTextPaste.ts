import { MAX_AGENT_TASK_PROMPT_BYTES } from "./agentTask";

export const AGENT_TEXT_PASTE_ATTACHMENT_THRESHOLD_BYTES = 32 * 1024;
const encoder = new TextEncoder();

/** Account for the replaced selection and attachment reference budget, not character count. */
export function shouldAttachAgentTextPaste(
  text: string,
  prompt: string,
  start: number,
  end: number,
  promptBytes: number,
): boolean {
  if (!text) return false;
  if (text.length >= AGENT_TEXT_PASTE_ATTACHMENT_THRESHOLD_BYTES) return true;
  const bytes = encoder.encode(text).byteLength;
  const from = Math.max(0, Math.min(start, prompt.length));
  const to = Math.max(from, Math.min(end, prompt.length));
  return (
    bytes >= AGENT_TEXT_PASTE_ATTACHMENT_THRESHOLD_BYTES ||
    promptBytes - encoder.encode(prompt.slice(from, to)).byteLength + bytes >
      MAX_AGENT_TASK_PROMPT_BYTES
  );
}

export function nextAgentPastedTextName(names: ReadonlyArray<string>, minimumSequence = 1): string {
  const occupied = new Set(names.map((name) => name.toLowerCase()));
  let sequence = minimumSequence;
  while (occupied.has(sequence === 1 ? "pasted-text.txt" : `pasted-text-${sequence}.txt`))
    sequence += 1;
  return sequence === 1 ? "pasted-text.txt" : `pasted-text-${sequence}.txt`;
}
