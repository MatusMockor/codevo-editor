import type { EditorDocument } from "./workspace";

export interface MarkdownPreviewTab {
  content: string;
  html: string;
  name: string;
  path: string;
  sourcePath: string;
}

export function markdownPreviewPath(sourcePath: string): string {
  return `mockor-markdown-preview:${sourcePath}`;
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

export async function renderMarkdownPreview(markdown: string): Promise<string> {
  const [{ marked }, { default: DOMPurify }] = await Promise.all([
    import("marked"),
    import("dompurify"),
  ]);
  const renderer = new marked.Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  const rendered = await marked.parse(markdown, {
    gfm: true,
    renderer,
  });
  const sanitized = DOMPurify.sanitize(rendered, {
    FORBID_ATTR: ["style"],
    FORBID_TAGS: ["embed", "iframe", "math", "object", "script", "svg"],
    USE_PROFILES: { html: true },
  });
  const template = document.createElement("template");
  template.innerHTML = sanitized;

  template.content.querySelectorAll("img").forEach((image) => {
    const source = image.getAttribute("src");

    if (!source || !isSafeExternalMarkdownUrl(source)) {
      image.removeAttribute("src");
    }
  });

  template.content.querySelectorAll("a").forEach((link) => {
    const href = link.getAttribute("href");

    if (!href || !isSafeExternalMarkdownUrl(href)) {
      link.removeAttribute("href");
      link.removeAttribute("target");
      link.removeAttribute("rel");
      return;
    }

    link.setAttribute("rel", "noopener");
    link.removeAttribute("target");
  });

  return template.innerHTML;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
