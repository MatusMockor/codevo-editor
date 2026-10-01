import { agentPromptLooksClipped, CLIPPED_AGENT_PROMPT_MARKER } from "./agentPromptClipping";

export const MAX_AGENT_PROMPT_LINK_CHARS = 2_048;
export const MAX_AGENT_PROMPT_LINKS = 64;
export const MAX_AGENT_PROMPT_LINK_SCAN_CHARS = 200_000;

export type AgentPromptSegment =
  | { readonly kind: "text"; readonly start: number; readonly end: number }
  | {
      readonly kind: "link";
      readonly start: number;
      readonly end: number;
      readonly url: string;
    };

interface AgentPromptLinkMatch {
  readonly start: number;
  readonly end: number;
}

const NO_SEGMENTS: ReadonlyArray<AgentPromptSegment> = Object.freeze([]);
const LINK_START = /https?:\/\//gi;
const LINK_STOP =
  /[\s<>"`\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069\u3001\u3002\uff0c]/gu;
const WORD_BEFORE = /[\p{L}\p{N}\p{M}+.\-/\\=&?#%@$]/u;
const TRAILING_PUNCTUATION: ReadonlySet<string> = new Set([
  ".",
  ",",
  ":",
  ";",
  "!",
  "?",
  "'",
  "*",
  "_",
  "~",
  "‘",
  "’",
  "“",
  "”",
  "„",
  "«",
  "»",
  "…",
  "。",
  "、",
  "，",
  "！",
  "？",
  "：",
  "；",
]);
const MISSING_AUTHORITY: ReadonlySet<string> = new Set(["/", "\\", "?", "#"]);
const CLOSING_BRACKETS: ReadonlyMap<string, string> = new Map([
  [")", "("],
  ["]", "["],
  ["}", "{"],
  ["）", "（"],
  ["」", "「"],
  ["』", "『"],
  ["】", "【"],
]);

export function agentPromptLinkSegments(text: string): ReadonlyArray<AgentPromptSegment> {
  if (text === "") return NO_SEGMENTS;
  const matches = agentPromptLinkMatches(text, linkableEnd(text));
  if (matches.length === 0) return [{ kind: "text", start: 0, end: text.length }];
  const segments: AgentPromptSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) segments.push({ kind: "text", start: cursor, end: match.start });
    segments.push({ kind: "link", ...match, url: text.slice(match.start, match.end) });
    cursor = match.end;
  }
  if (cursor < text.length) segments.push({ kind: "text", start: cursor, end: text.length });
  return segments;
}

function linkableEnd(text: string): number {
  if (!agentPromptLooksClipped(text)) return text.length;
  return text.length - CLIPPED_AGENT_PROMPT_MARKER.length;
}

function agentPromptLinkMatches(
  text: string,
  linkable: number,
): ReadonlyArray<AgentPromptLinkMatch> {
  const matches: AgentPromptLinkMatch[] = [];
  const pattern = new RegExp(LINK_START.source, LINK_START.flags);
  const stop = new RegExp(LINK_STOP.source, LINK_STOP.flags);
  let found = pattern.exec(text);
  while (found !== null && matches.length < MAX_AGENT_PROMPT_LINKS) {
    const start = found.index;
    if (start >= Math.min(linkable, MAX_AGENT_PROMPT_LINK_SCAN_CHARS)) break;
    const tokenEnd = linkTokenEnd(text, start, stop);
    const complete = tokenEnd < linkable || linkable === text.length;
    const match =
      complete && startsAtBoundary(text, start) ? linkMatch(text, start, tokenEnd) : null;
    if (match !== null) matches.push(match);
    pattern.lastIndex = Math.max(tokenEnd, start + 1);
    found = pattern.exec(text);
  }
  return matches;
}

function startsAtBoundary(text: string, start: number): boolean {
  if (start === 0) return true;
  return !WORD_BEFORE.test(text.charAt(start - 1));
}

function linkTokenEnd(text: string, start: number, stop: RegExp): number {
  stop.lastIndex = start;
  return stop.exec(text)?.index ?? text.length;
}

function linkMatch(text: string, start: number, tokenEnd: number): AgentPromptLinkMatch | null {
  if (tokenEnd - start > MAX_AGENT_PROMPT_LINK_CHARS) return null;
  const end = start + trimmedLength(text.slice(start, tokenEnd));
  if (!isLinkableUrl(text.slice(start, end))) return null;
  return { start, end };
}

function trimmedLength(candidate: string): number {
  const balance = bracketBalance(candidate);
  let end = candidate.length;
  while (end > 0) {
    const last = candidate.charAt(end - 1);
    if (TRAILING_PUNCTUATION.has(last)) {
      end -= 1;
      continue;
    }
    if (!CLOSING_BRACKETS.has(last) || (balance.get(last) ?? 0) <= 0) break;
    balance.set(last, (balance.get(last) ?? 0) - 1);
    end -= 1;
  }
  return end;
}

function bracketBalance(candidate: string): Map<string, number> {
  const balance = new Map<string, number>();
  for (const [closing, opening] of CLOSING_BRACKETS) {
    balance.set(closing, occurrences(candidate, closing) - occurrences(candidate, opening));
  }
  return balance;
}

function occurrences(text: string, character: string): number {
  let count = 0;
  for (const current of text) if (current === character) count += 1;
  return count;
}

function isLinkableUrl(candidate: string): boolean {
  const authority = candidate.charAt(candidate.indexOf("://") + 3);
  if (authority === "" || MISSING_AUTHORITY.has(authority)) return false;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return url.hostname !== "";
}
