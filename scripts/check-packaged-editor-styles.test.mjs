import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPackagedEditorStyles } from "./check-packaged-editor-styles.mjs";

const directories = [];
async function fixture(html, css = "body { background: #13151a; }") {
  const directory = await mkdtemp(join(tmpdir(), "codevo-packaged-styles-"));
  directories.push(directory);
  await writeFile(join(directory, "index.html"), html);
  await writeFile(join(directory, "startup.css"), css);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const external = '<link rel="stylesheet" href="./startup.css">';
describe("packaged editor styles", () => {
  it("accepts a self-contained external startup sheet", async () => {
    await expect(checkPackagedEditorStyles(await fixture(external))).resolves.toBeUndefined();
  });

  it.each(["<style>body{}</style>", '<STYLE type="text/css">body{}</STYLE>'])(
    "rejects inline styles before Tauri injects a nonce: %s",
    async (inline) => {
      await expect(checkPackagedEditorStyles(await fixture(external + inline))).rejects.toThrow(
        "Tauri's style nonce",
      );
    },
  );

  it.each([
    "",
    '<link rel="stylesheet" href="./startup.css" media="print">',
    '<link rel="stylesheet" href="./startup.css" disabled>',
  ])("rejects a missing or nonblocking startup sheet: %s", async (html) => {
    await expect(checkPackagedEditorStyles(await fixture(html))).rejects.toThrow("render-blocking");
  });

  it.each(["", " ".repeat(12_001), '@import "remote.css";'])(
    "rejects an empty, oversized or dependent startup sheet",
    async (css) => {
      await expect(checkPackagedEditorStyles(await fixture(external, css))).rejects.toThrow(
        "self-contained",
      );
    },
  );

  it("rejects a build which did not copy startup.css", async () => {
    const directory = await fixture(external);
    await rm(join(directory, "startup.css"));
    await expect(checkPackagedEditorStyles(directory)).rejects.toThrow("ENOENT");
  });
});
