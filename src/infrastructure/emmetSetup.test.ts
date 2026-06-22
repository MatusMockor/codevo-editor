import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";

const htmlDisposer = vi.fn();
const cssDisposer = vi.fn();
const jsxDisposer = vi.fn();

const emmetHTML = vi.fn(() => htmlDisposer);
const emmetCSS = vi.fn(() => cssDisposer);
const emmetJSX = vi.fn(() => jsxDisposer);

vi.mock("emmet-monaco-es", () => ({
  emmetHTML,
  emmetCSS,
  emmetJSX,
}));

const monaco = {} as typeof Monaco;

describe("setupEmmet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("registers Emmet for HTML-like languages with the standard tokenizer", async () => {
    const { setupEmmet } = await import("./emmetSetup");

    setupEmmet(monaco);

    expect(emmetHTML).toHaveBeenCalledWith(
      monaco,
      ["html", "php", "blade"],
      { tokenizer: "standard" },
    );
  });

  it("registers Emmet for CSS-like languages with the standard tokenizer", async () => {
    const { setupEmmet } = await import("./emmetSetup");

    setupEmmet(monaco);

    expect(emmetCSS).toHaveBeenCalledWith(
      monaco,
      ["css", "scss"],
      { tokenizer: "standard" },
    );
  });

  it("registers Emmet for JSX/TSX languages with the standard tokenizer", async () => {
    const { setupEmmet } = await import("./emmetSetup");

    setupEmmet(monaco);

    expect(emmetJSX).toHaveBeenCalledWith(
      monaco,
      ["javascript", "javascriptreact", "typescript", "typescriptreact"],
      { tokenizer: "standard" },
    );
  });

  it("returns a disposable that runs every Emmet cleanup function", async () => {
    const { setupEmmet } = await import("./emmetSetup");

    const disposable = setupEmmet(monaco);
    disposable.dispose();

    expect(htmlDisposer).toHaveBeenCalledTimes(1);
    expect(cssDisposer).toHaveBeenCalledTimes(1);
    expect(jsxDisposer).toHaveBeenCalledTimes(1);
  });

  it("registers Emmet only once per Monaco instance when called repeatedly", async () => {
    const { setupEmmet } = await import("./emmetSetup");

    setupEmmet(monaco);
    setupEmmet(monaco);

    expect(emmetHTML).toHaveBeenCalledTimes(1);
    expect(emmetCSS).toHaveBeenCalledTimes(1);
    expect(emmetJSX).toHaveBeenCalledTimes(1);
  });

  it("registers Emmet again for a different Monaco instance", async () => {
    const { setupEmmet } = await import("./emmetSetup");
    const otherMonaco = {} as typeof Monaco;

    setupEmmet(monaco);
    setupEmmet(otherMonaco);

    expect(emmetHTML).toHaveBeenCalledTimes(2);
    expect(emmetHTML).toHaveBeenNthCalledWith(
      1,
      monaco,
      ["html", "php", "blade"],
      { tokenizer: "standard" },
    );
    expect(emmetHTML).toHaveBeenNthCalledWith(
      2,
      otherMonaco,
      ["html", "php", "blade"],
      { tokenizer: "standard" },
    );
  });
});
