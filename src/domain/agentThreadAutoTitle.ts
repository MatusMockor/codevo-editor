import { agentThreadTitle, UNTITLED_AGENT_THREAD_TITLE } from "./agentThread";

export const AGENT_AUTO_TITLE_TARGET_CHARS = 60;
const AUTO_TITLE_SCAN_CHARS = 4_096;
const AUTO_TITLE_ELLIPSIS = "…";

export function agentThreadAutoTitle(prompt: string): string {
  const line = firstMeaningfulLine(prompt.slice(0, AUTO_TITLE_SCAN_CHARS));
  if (line === "") return agentThreadTitle(prompt);
  return agentThreadTitle(cutAtWordBoundary(line, AGENT_AUTO_TITLE_TARGET_CHARS));
}

function firstMeaningfulLine(text: string): string {
  let fenced = false;
  for (const raw of text.split(/\r?\n/u)) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const normalized = normalizeLine(trimmed);
    if (normalized !== "") return normalized;
  }
  return "";
}

function normalizeLine(line: string): string {
  return line
    .replace(/^\/[\w:-]+(?=\s|$)/u, "")
    .trimStart()
    .replace(/^(?:>\s*)+/u, "")
    .replace(/^#{1,6}\s+/u, "")
    .replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/u, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<\/?[A-Za-z][^>]*>/gu, "")
    .replace(
      /(^|\s)@(\S+)/gu,
      (_match, lead: string, target: string) => `${lead}${mentionLabel(target)}`,
    )
    .replace(/`+([^`]*)`+/gu, "$1")
    .replace(/(\*\*|__)(.+?)\1/gu, "$2")
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/gu, "$1$2")
    .replace(/~~(.+?)~~/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

function mentionLabel(target: string): string {
  const path = target.replace(/[.,;:!?)]+$/u, "");
  const segments = path.split("/").filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? path;
}

function cutAtWordBoundary(line: string, limit: number): string {
  const characters = Array.from(line);
  if (characters.length <= limit) return line;
  const head = characters.slice(0, limit).join("");
  const boundary = head.lastIndexOf(" ");
  const cut = boundary >= Math.floor(limit / 2) ? head.slice(0, boundary) : head;
  const clean = cut.replace(/[\s,;:.\-–—]+$/u, "");
  if (clean === "") return UNTITLED_AGENT_THREAD_TITLE;
  return `${clean}${AUTO_TITLE_ELLIPSIS}`;
}
