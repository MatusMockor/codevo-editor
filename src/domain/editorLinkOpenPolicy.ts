import { isSafeExternalMarkdownUrl } from "./markdownPreview";

export type EditorLinkOpenDecision =
  | { readonly kind: "open-external"; readonly url: string }
  | { readonly kind: "delegate-command" }
  | { readonly kind: "refuse" };

const MAX_EDITOR_LINK_LENGTH = 8192;
const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i;
const REFUSE: EditorLinkOpenDecision = Object.freeze({ kind: "refuse" });
const DELEGATE_COMMAND: EditorLinkOpenDecision = Object.freeze({ kind: "delegate-command" });

export function decideEditorLinkOpen(uri: string): EditorLinkOpenDecision {
  if (uri.length > MAX_EDITOR_LINK_LENGTH) return REFUSE;
  const scheme = SCHEME_PATTERN.exec(uri)?.[1]?.toLowerCase();
  if (scheme === "command") return DELEGATE_COMMAND;
  if (scheme !== "http" && scheme !== "https") return REFUSE;
  if (!isSafeExternalMarkdownUrl(uri)) return REFUSE;
  return { kind: "open-external", url: new URL(uri).href };
}
