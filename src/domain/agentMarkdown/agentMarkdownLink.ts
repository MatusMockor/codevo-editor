import { isSafeExternalMarkdownUrl, type MarkdownLinkPolicy } from "../markdownPreview";

export const MAX_AGENT_MARKDOWN_LINK_CHARS = 4_096;

export type AgentLocalFileAnchor = "absolute" | "relative";

export interface AgentLocalFileLocation {
  readonly path: string;
  readonly line: number | null;
  readonly column: number | null;
}

export type AgentMarkdownLink =
  | { readonly kind: "external"; readonly url: string }
  | {
      readonly kind: "localFile";
      readonly anchor: AgentLocalFileAnchor;
      readonly location: AgentLocalFileLocation;
    }
  | { readonly kind: "none" };

export type AgentLocalFileLink = Extract<AgentMarkdownLink, { kind: "localFile" }>;

export const NO_AGENT_MARKDOWN_LINK: AgentMarkdownLink = Object.freeze({ kind: "none" });

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const POSITION = "([1-9]\\d{0,8})";
const LINE_SUFFIX = new RegExp(`:${POSITION}(?::${POSITION})?$`);
const LINE_FRAGMENT = new RegExp(
  `^L${POSITION}(?:C${POSITION})?(?:-L[1-9]\\d{0,8}(?:C[1-9]\\d{0,8})?)?$`,
);
const FORBIDDEN_PATH_CHARS = /[\u0000-\u001f\u007f\\?]/;
const EDGE_WHITESPACE =
  /^[\s\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]|[\s\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]$/;
const NAVIGABLE_SCHEMES: ReadonlySet<string> = new Set([
  "about",
  "blob",
  "data",
  "file",
  "http",
  "https",
  "javascript",
  "mailto",
  "vbscript",
]);
const LINE_SUFFIX_ONLY = new RegExp(`^[a-z][a-z0-9+.-]*:${POSITION}(?::${POSITION})?(?:#|$)`, "i");

export function parseAgentMarkdownLink(href: string | null): AgentMarkdownLink {
  if (href === null || href === "" || href.length > MAX_AGENT_MARKDOWN_LINK_CHARS) {
    return NO_AGENT_MARKDOWN_LINK;
  }
  const scheme = urlScheme(href);
  if (scheme === "http" || scheme === "https") return externalLink(href);
  if (scheme === "file") return fileUrlLink(href);
  if (scheme !== undefined) return NO_AGENT_MARKDOWN_LINK;
  return barePathLink(href);
}

export function isAgentMarkdownLinkAccepted(href: string): boolean {
  return parseAgentMarkdownLink(href).kind !== "none";
}

export const AGENT_MARKDOWN_LINK_POLICY: MarkdownLinkPolicy = Object.freeze({
  allowedUriPattern:
    /^(?:(?:https?|file):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$)|(?!(?:about|blob|data|file|https?|javascript|mailto|vbscript):)[a-z][a-z0-9+.-]*:[1-9]\d{0,8}(?::[1-9]\d{0,8})?(?:#|$))/i,
  accepts: isAgentMarkdownLinkAccepted,
});

export function resolveAgentLocalFilePath(
  link: AgentLocalFileLink,
  base: string | null,
): string | null {
  if (link.anchor === "absolute") return link.location.path;
  if (base === null || !base.startsWith("/")) return null;
  return normalizeSegments(`${base}/${link.location.path}`, "absolute");
}

function urlScheme(value: string): string | undefined {
  const scheme = SCHEME.exec(value)?.[1]?.toLowerCase();
  if (scheme === undefined) return undefined;
  if (NAVIGABLE_SCHEMES.has(scheme)) return scheme;
  if (LINE_SUFFIX_ONLY.test(value)) return undefined;
  return scheme;
}

function externalLink(href: string): AgentMarkdownLink {
  if (!isSafeExternalMarkdownUrl(href)) return NO_AGENT_MARKDOWN_LINK;
  return { kind: "external", url: href };
}

function fileUrlLink(href: string): AgentMarkdownLink {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return NO_AGENT_MARKDOWN_LINK;
  }
  if (url.hostname !== "" && url.hostname !== "localhost") return NO_AGENT_MARKDOWN_LINK;
  if (url.search !== "") return NO_AGENT_MARKDOWN_LINK;
  const path = percentDecoded(url.pathname);
  if (path === null) return NO_AGENT_MARKDOWN_LINK;
  return localFileLink("absolute", path, url.hash.slice(1));
}

function barePathLink(href: string): AgentMarkdownLink {
  if (href.startsWith("//")) return NO_AGENT_MARKDOWN_LINK;
  const hashIndex = href.indexOf("#");
  const rawPath = hashIndex < 0 ? href : href.slice(0, hashIndex);
  const fragment = hashIndex < 0 ? "" : href.slice(hashIndex + 1);
  if (rawPath === "") return NO_AGENT_MARKDOWN_LINK;
  const path = percentDecoded(rawPath);
  if (path === null || urlScheme(path) !== undefined) return NO_AGENT_MARKDOWN_LINK;
  return localFileLink(path.startsWith("/") ? "absolute" : "relative", path, fragment);
}

function percentDecoded(value: string): string | null {
  if (value.includes("?")) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function localFileLink(
  anchor: AgentLocalFileAnchor,
  rawPath: string,
  fragment: string,
): AgentMarkdownLink {
  if (FORBIDDEN_PATH_CHARS.test(rawPath) || EDGE_WHITESPACE.test(rawPath))
    return NO_AGENT_MARKDOWN_LINK;
  const suffix = LINE_SUFFIX.exec(rawPath);
  const pathPart = suffix === null ? rawPath : rawPath.slice(0, suffix.index);
  const position = suffix ?? LINE_FRAGMENT.exec(percentDecoded(fragment) ?? "");
  const path = normalizeSegments(pathPart, anchor);
  if (path === null) return NO_AGENT_MARKDOWN_LINK;
  return {
    kind: "localFile",
    anchor,
    location: {
      path,
      line: positionNumber(position?.[1]),
      column: position?.[1] === undefined ? null : positionNumber(position[2]),
    },
  };
}

function positionNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  return Number.parseInt(value, 10);
}

function normalizeSegments(path: string, anchor: AgentLocalFileAnchor): string | null {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") {
      segments.push(segment);
      continue;
    }
    if (segments.length === 0) return null;
    segments.pop();
  }
  if (segments.length === 0) return null;
  const joined = segments.join("/");
  return anchor === "absolute" ? `/${joined}` : joined;
}
