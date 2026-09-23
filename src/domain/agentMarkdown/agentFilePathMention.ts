import { parseAgentMarkdownLink, type AgentLocalFileLink } from "./agentMarkdownLink";

export const MAX_AGENT_PATH_MENTION_SCAN_CHARS = 4_096;
export const MAX_AGENT_PATH_MENTION_CHARS = 512;

export type AgentPathMentionSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "path"; readonly text: string; readonly link: AgentLocalFileLink };

const PROSE_TOKEN = /\S+/g;
const PROSE_PATH =
  /^(?:\.{1,2}\/)?(?:[\w@.-]+\/)+[\w@.-]*\.[A-Za-z][A-Za-z0-9]{0,11}(?::[1-9]\d{0,8}(?::[1-9]\d{0,8})?)?$/;
const LEADING_PUNCTUATION = /^[("'\u2018\u201c<[{]+/;
const TRAILING_PUNCTUATION = /[)"'\u2019\u201d>\]},.;:!?]+$/;
const CODE_PATH =
  /^(?:\.{1,2}\/)?(?:[\w@.-]+\/)*[\w@.-]*\.([A-Za-z][A-Za-z0-9]{0,11})(?::[1-9]\d{0,8}(?::[1-9]\d{0,8})?)?$/;

const SOURCE_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  "cjs",
  "cpp",
  "cs",
  "css",
  "cts",
  "go",
  "graphql",
  "hpp",
  "html",
  "java",
  "js",
  "json",
  "jsonc",
  "jsx",
  "kt",
  "less",
  "lock",
  "md",
  "mdx",
  "mjs",
  "mts",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
]);

export function agentInlineCodePathMention(code: string): AgentLocalFileLink | null {
  const text = code.trim();
  if (text === "" || text.length > MAX_AGENT_PATH_MENTION_CHARS) return null;
  const match = CODE_PATH.exec(text);
  if (match === null) return null;
  const extension = (match[1] ?? "").toLowerCase();
  if (!text.includes("/") && !SOURCE_FILE_EXTENSIONS.has(extension)) return null;
  return relativeFileLink(text);
}

export function agentProsePathMentions(
  text: string,
  limit: number,
): ReadonlyArray<AgentPathMentionSegment> | null {
  if (limit <= 0 || text.length > MAX_AGENT_PATH_MENTION_SCAN_CHARS || !text.includes("/")) {
    return null;
  }
  const segments: AgentPathMentionSegment[] = [];
  let consumed = 0;
  let found = 0;
  for (const token of text.matchAll(PROSE_TOKEN)) {
    if (found >= limit) break;
    const mention = tokenPathMention(token[0], token.index);
    if (mention === null) continue;
    if (mention.start > consumed) {
      segments.push({ kind: "text", text: text.slice(consumed, mention.start) });
    }
    segments.push({ kind: "path", text: mention.text, link: mention.link });
    consumed = mention.start + mention.text.length;
    found += 1;
  }
  if (found === 0) return null;
  if (consumed < text.length) segments.push({ kind: "text", text: text.slice(consumed) });
  return segments;
}

interface TokenPathMention {
  readonly start: number;
  readonly text: string;
  readonly link: AgentLocalFileLink;
}

function tokenPathMention(token: string, offset: number): TokenPathMention | null {
  if (token.length > MAX_AGENT_PATH_MENTION_CHARS || !token.includes("/")) return null;
  const leading = LEADING_PUNCTUATION.exec(token)?.[0].length ?? 0;
  const body = token.slice(leading).replace(TRAILING_PUNCTUATION, "");
  if (!PROSE_PATH.test(body)) return null;
  const link = relativeFileLink(body);
  if (link === null) return null;
  return { start: offset + leading, text: body, link };
}

function relativeFileLink(mention: string): AgentLocalFileLink | null {
  const link = parseAgentMarkdownLink(mention);
  if (link.kind !== "localFile" || link.anchor !== "relative") return null;
  return link;
}
