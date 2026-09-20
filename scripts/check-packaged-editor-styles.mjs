import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Keep Tauri's automatic CSP nonces away from Monaco's runtime stylesheets. */
export async function checkPackagedEditorStyles(distDirectory) {
  const html = await readFile(join(distDirectory, "index.html"), "utf8");
  if (/<style\b/i.test(html)) {
    throw new Error(
      "Packaged HTML contains inline styles: Tauri's style nonce would block Monaco's cursor, line numbers and syntax colors. Use an external stylesheet.",
    );
  }
  const links = Array.from(html.matchAll(/<link\b[^>]*>/gi), (match) => match[0]);
  const startup = links.find(
    (tag) =>
      /\brel=["']stylesheet["']/i.test(tag) && /\bhref=["']\.?\/?startup\.css["']/i.test(tag),
  );
  if (!startup || /\b(?:media|disabled|onload)\b/i.test(startup)) {
    throw new Error("Packaged HTML must load startup.css as a render-blocking stylesheet.");
  }
  const css = await readFile(join(distDirectory, "startup.css"), "utf8");
  if (css.length === 0 || Buffer.byteLength(css, "utf8") > 12_000 || /@import\b/i.test(css)) {
    throw new Error("Packaged startup.css must be nonempty, self-contained and at most 12 KB.");
  }
}
