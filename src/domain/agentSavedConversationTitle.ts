const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/u;
const UNTITLED = "Untitled conversation";
const KEPT_SEGMENTS = 2;

export function savedConversationTitle(raw: string): string {
  const compact = raw.replace(URL_PATTERN, compactUrl).replace(/\s+/gu, " ").trim();
  return compact === "" ? UNTITLED : compact;
}

export function boundedSavedConversationTitle(raw: string, maxChars: number): string {
  const characters = Array.from(savedConversationTitle(raw));
  if (characters.length <= maxChars) return characters.join("");
  return `${characters
    .slice(0, Math.max(1, maxChars - 1))
    .join("")
    .trimEnd()}…`;
}

function compactUrl(match: string): string {
  const trailing = TRAILING_PUNCTUATION.exec(match)?.[0] ?? "";
  const candidate = match.slice(0, match.length - trailing.length);
  const parsed = parseUrl(candidate);
  if (parsed === null) return match;
  const host = parsed.hostname.replace(/^www\./u, "");
  const segments = parsed.pathname
    .split("/")
    .filter((segment) => segment !== "" && segment !== "-");
  if (segments.length === 0) return `${host}${trailing}`;
  if (segments.length <= KEPT_SEGMENTS) return `${host}/${segments.join("/")}${trailing}`;
  return `${host}/…/${segments.slice(-KEPT_SEGMENTS).join("/")}${trailing}`;
}

function parseUrl(candidate: string): URL | null {
  try {
    const url = new URL(candidate);
    return url.hostname === "" ? null : url;
  } catch {
    return null;
  }
}
