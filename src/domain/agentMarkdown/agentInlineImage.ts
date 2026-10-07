import { resolveAgentLocalFilePath, type AgentMarkdownLink } from "./agentMarkdownLink";

export const MAX_AGENT_INLINE_IMAGES_PER_MESSAGE = 16;
export const MAX_AGENT_INLINE_IMAGE_BYTES = 10 * 1_024 * 1_024;
export const MAX_AGENT_INLINE_IMAGE_PATH_BYTES = 4_096;

export type AgentInlineImageTarget =
  | { readonly kind: "local"; readonly path: string }
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "unsupported" }
  | { readonly kind: "unresolved" }
  | { readonly kind: "none" };

const UNSUPPORTED_TARGET: AgentInlineImageTarget = Object.freeze({ kind: "unsupported" });
const UNRESOLVED_TARGET: AgentInlineImageTarget = Object.freeze({ kind: "unresolved" });
const NO_TARGET: AgentInlineImageTarget = Object.freeze({ kind: "none" });

const SUPPORTED_EXTENSION = /[^/]\.(?:png|jpe?g|gif|webp)$/i;
const UTF8_ENCODER = new TextEncoder();

export function resolveAgentInlineImageTarget(
  source: AgentMarkdownLink,
  base: string | null,
): AgentInlineImageTarget {
  switch (source.kind) {
    case "external":
      return { kind: "external", url: source.url };
    case "localFile":
      return localTarget(resolveAgentLocalFilePath(source, base));
    case "none":
      return NO_TARGET;
    default:
      return unsupportedSource(source);
  }
}

function localTarget(path: string | null): AgentInlineImageTarget {
  if (path === null) return UNRESOLVED_TARGET;
  if (!SUPPORTED_EXTENSION.test(path)) return UNSUPPORTED_TARGET;
  if (UTF8_ENCODER.encode(path).byteLength > MAX_AGENT_INLINE_IMAGE_PATH_BYTES) {
    return UNSUPPORTED_TARGET;
  }
  return { kind: "local", path };
}

function unsupportedSource(source: never): never {
  throw new Error(`Unsupported markdown image source: ${String(source)}`);
}
