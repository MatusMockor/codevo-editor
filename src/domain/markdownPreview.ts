import type { Token } from "marked";
import { buildMarkdownPreviewDocumentPath } from "./editorDocumentSchemes";
import type { EditorDocument } from "./workspace";

export interface MarkdownPreviewTab {
  content: string;
  html: string;
  name: string;
  path: string;
  sourcePath: string;
}

export function markdownPreviewPath(sourcePath: string): string {
  return buildMarkdownPreviewDocumentPath(sourcePath);
}

export function isMarkdownDocument(
  document: EditorDocument | null | undefined,
): document is EditorDocument {
  return Boolean(document && document.language === "markdown");
}

export function isSafeExternalMarkdownUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

type MarkedModule = typeof import("marked");
type DomPurifyInstance = (typeof import("dompurify"))["default"];

export interface HardenedMarkdown {
  lexBlocks(markdown: string): ReadonlyArray<Token>;
  renderTokens(tokens: ReadonlyArray<Token>): string;
  sanitizeToFragment(html: string): DocumentFragment;
  renderDocument(markdown: string): string;
}

const FORBIDDEN_ATTRIBUTES = ["style"] as const;
const FORBIDDEN_TAGS = ["embed", "iframe", "math", "object", "script", "svg"] as const;

let loading: Promise<HardenedMarkdown> | null = null;

export function loadHardenedMarkdown(): Promise<HardenedMarkdown> {
  if (loading !== null) return loading;
  loading = Promise.all([import("marked"), import("dompurify")]).then(
    ([markedModule, purifyModule]) => createHardenedMarkdown(markedModule, purifyModule.default),
  );
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

export async function renderMarkdownPreview(markdown: string): Promise<string> {
  const pipeline = await loadHardenedMarkdown();
  return pipeline.renderDocument(markdown);
}

export function createHardenedMarkdown(
  markedModule: MarkedModule,
  DOMPurify: DomPurifyInstance,
): HardenedMarkdown {
  const { marked } = markedModule;
  const renderer = new marked.Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  const options = { async: false, gfm: true, renderer } as const;

  const lexBlocks = (markdown: string): ReadonlyArray<Token> => marked.lexer(markdown, options);

  const renderTokens = (tokens: ReadonlyArray<Token>): string =>
    marked.parser([...tokens], options);

  const sanitizeToFragment = (html: string): DocumentFragment => {
    const sanitized = DOMPurify.sanitize(html, {
      FORBID_ATTR: [...FORBIDDEN_ATTRIBUTES],
      FORBID_TAGS: [...FORBIDDEN_TAGS],
      USE_PROFILES: { html: true },
    });
    const template = document.createElement("template");
    template.innerHTML = sanitized;
    stripUnsafeImages(template.content);
    hardenLinks(template.content);
    return template.content;
  };

  const renderDocument = (markdown: string): string => {
    const fragment = sanitizeToFragment(renderTokens(lexBlocks(markdown)));
    const template = document.createElement("template");
    template.content.append(fragment);
    return template.innerHTML;
  };

  return { lexBlocks, renderTokens, sanitizeToFragment, renderDocument };
}

function stripUnsafeImages(root: ParentNode): void {
  root.querySelectorAll("img").forEach((image) => {
    const source = image.getAttribute("src");
    if (source !== null && isSafeExternalMarkdownUrl(source)) return;
    image.removeAttribute("src");
  });
}

function hardenLinks(root: ParentNode): void {
  root.querySelectorAll("a").forEach((link) => {
    const href = link.getAttribute("href");
    if (href === null || !isSafeExternalMarkdownUrl(href)) {
      link.removeAttribute("href");
      link.removeAttribute("target");
      link.removeAttribute("rel");
      return;
    }
    link.setAttribute("rel", "noopener");
    link.removeAttribute("target");
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
