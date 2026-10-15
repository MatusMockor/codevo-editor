// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { press } from "../../../../ui/foundation/foundationTestSupport";
import {
  SURFACE_FIXTURE_ROOT,
  SURFACE_FIXTURE_WORKTREE,
  surfaceThreadView,
} from "../../agentSurfaceTestFixtures";
import { rightPanelTestContext } from "../agentRightPanelTestSupport";
import {
  ROOT,
  StubResizeObserver,
  button,
  deferred,
  entry,
  fileTree,
  installViewerTestEnvironment,
  memoryReader,
  render,
  row,
  settle,
  text,
  tree,
  unmountSurface,
  until,
  viewerText,
} from "./fileViewerTestSupport";
import { FILE_VIEWER_TREE_STORAGE_KEY, FILE_VIEWER_WRAP_STORAGE_KEY } from "./useFileViewerWrap";

installViewerTestEnvironment();

describe("Files viewer", () => {
  it("opens a clicked file in the built-in viewer beside the tree with highlighting", async () => {
    const { reader, calls } = memoryReader({
      "src/app.ts": text("src/app.ts", "const answer: number = 42;\nexport { answer };\n"),
    });
    const host = render({ reader });

    act(() => row(host, `${ROOT}/src/app.ts`).click());
    await settle();

    expect(calls).toEqual([{ root: ROOT, path: "src/app.ts" }]);
    expect(host.querySelector('nav[aria-label="Workspace files"]')).not.toBeNull();
    const crumbs = [
      ...host.querySelectorAll('nav[aria-label="File path"] > :not([aria-hidden="true"])'),
    ].map((crumb) => crumb.textContent);
    expect(crumbs).toEqual(["repo", "src", "app.ts"]);
    const separators = [
      ...host.querySelectorAll('nav[aria-label="File path"] > .cv-file-viewer__crumb-separator'),
    ];
    expect(separators.map((separator) => separator.textContent)).toEqual(["›", "›"]);
    expect(separators.every((separator) => separator.getAttribute("aria-hidden") === "true")).toBe(
      true,
    );
    expect(
      [...host.querySelectorAll(".cv-file-viewer__crumb")].every(
        (crumb) => crumb.querySelector(".cv-file-viewer__crumb-separator") === null,
      ),
    ).toBe(true);
    expect(viewerText(host)).toContain("const answer: number = 42;");
    await until(() => {
      expect(
        host.querySelector(".cv-file-viewer .highlighted-code__text span[style]"),
      ).not.toBeNull();
    });
    expect(host.querySelector('[data-line="1"] .highlighted-code__gutter')?.textContent).toBe("1");

    act(() => button(host, "Hide file tree").click());
    act(() => button(host, "Back to files").click());
    expect(host.querySelector(".cv-file-viewer")).toBeNull();
    expect(host.querySelector('nav[aria-label="Workspace files"]')).not.toBeNull();
  }, 20_000);

  it("returns to the tree with Escape and from a folder breadcrumb, expanding that folder", async () => {
    const toggleDirectory = vi.fn();
    const nested = tree({
      entriesByDirectory: {
        [ROOT]: [entry(`${ROOT}/src`, "directory")],
        [`${ROOT}/src`]: [entry(`${ROOT}/src/lib`, "directory")],
        [`${ROOT}/src/lib`]: [entry(`${ROOT}/src/lib/util.ts`)],
      },
      expandedDirectories: new Set([`${ROOT}/src`, `${ROOT}/src/lib`]),
      toggleDirectory,
    });
    const { reader } = memoryReader({ "src/lib/util.ts": text("src/lib/util.ts", "x") });
    const view = fileTree({ tree: nested });
    const host = render({ reader, fileTree: view });

    act(() => row(host, `${ROOT}/src/lib/util.ts`).click());
    await settle();
    const viewer = host.querySelector<HTMLElement>(".cv-file-viewer");
    expect(viewer).not.toBeNull();
    press(viewer as HTMLElement, "Escape");
    expect(host.querySelector(".cv-file-viewer")).toBeNull();

    act(() => row(host, `${ROOT}/src/lib/util.ts`).click());
    await settle();
    const collapsed = fileTree({
      tree: { ...nested, expandedDirectories: new Set([`${ROOT}/src`]) },
    });
    render({ reader, fileTree: collapsed });
    const crumb = [...host.querySelectorAll<HTMLButtonElement>(".cv-file-viewer__crumb")].find(
      (candidate) => candidate.textContent === "lib",
    );
    act(() => crumb?.click());

    expect(toggleDirectory).toHaveBeenCalledExactlyOnceWith(`${ROOT}/src/lib`);
    expect(host.querySelector(".cv-file-viewer")).toBeNull();
    expect(host.querySelector('nav[aria-label="Workspace files"]')).not.toBeNull();
  });

  it("opens a search result with a single click", async () => {
    const { reader } = memoryReader({ "src/app.ts": text("src/app.ts", "let a = 1;") });
    const context = rightPanelTestContext(
      {},
      {
        fileSearch: {
          searchFiles: async () => [
            { name: "app.ts", path: `${ROOT}/src/app.ts`, relativePath: "src/app.ts" },
          ],
        },
      },
    );
    const host = render({ reader, context });
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Search workspace files"]',
    );
    act(() => {
      if (input === null) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "app");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await until(() => expect(host.querySelector('[role="option"]')).not.toBeNull());

    act(() => host.querySelector<HTMLElement>('[role="option"]')?.click());
    await settle();

    expect(host.querySelector(".cv-file-viewer")?.getAttribute("data-file-viewer-path")).toBe(
      "src/app.ts",
    );
    expect(viewerText(host)).toContain("let a = 1;");
  });

  it("says when the preview is truncated, binary or unreadable", async () => {
    const { reader } = memoryReader({
      "src/app.ts": {
        kind: "text",
        relativePath: "src/app.ts",
        contents: "partial",
        byteLength: 5 * 1024 * 1024,
        truncated: true,
      },
      "src/big.ts": { kind: "binary", relativePath: "src/big.ts", byteLength: 2048 },
      "README.md": new Error("Permission denied"),
    });
    const host = render({ reader });

    act(() => row(host, `${ROOT}/src/app.ts`).click());
    await settle();
    expect(host.querySelector('.cv-file-viewer [role="note"]')?.textContent).toBe(
      "Preview limited to the first 1 MB of a 5 MB file.",
    );
    expect(button(host, "Copy contents").disabled).toBe(true);

    act(() => row(host, `${ROOT}/src/big.ts`).click());
    await settle();
    expect(host.querySelector(".cv-file-viewer__body")?.textContent).toBe(
      "Binary file (2 KB) is not shown.",
    );

    act(() => row(host, `${ROOT}/README.md`).click());
    await settle();
    expect(host.querySelector('.cv-file-viewer [role="alert"]')?.textContent).toBe(
      "Permission denied",
    );
  });

  it("ignores a late result for a file that is no longer shown", async () => {
    StubResizeObserver.width = 900;
    const first = deferred();
    const second = deferred();
    const { reader } = memoryReader({
      "src/app.ts": () => first.promise,
      "src/big.ts": () => second.promise,
    });
    const host = render({ reader });

    act(() => row(host, `${ROOT}/src/app.ts`).click());
    await settle();
    expect(host.querySelector('.cv-file-viewer [role="status"]')?.textContent).toBe(
      "Loading file…",
    );
    act(() => row(host, `${ROOT}/src/big.ts`).click());
    await act(async () => second.resolve(text("src/big.ts", "second file")));
    await act(async () => first.resolve(text("src/app.ts", "first file")));

    expect(host.querySelector(".cv-file-viewer")?.getAttribute("data-file-viewer-path")).toBe(
      "src/big.ts",
    );
    expect(viewerText(host)).toContain("second file");
    expect(viewerText(host)).not.toContain("first file");
  });

  it("drops the open file when the tree root changes", async () => {
    const { reader } = memoryReader({ "src/app.ts": text("src/app.ts", "root a") });
    const host = render({ reader });
    act(() => row(host, `${ROOT}/src/app.ts`).click());
    await settle();
    expect(host.querySelector(".cv-file-viewer")).not.toBeNull();

    render({ reader, fileTree: fileTree({ tree: tree({ rootPath: "/other" }) }) });
    expect(host.querySelector(".cv-file-viewer")).toBeNull();
    render({ reader });
    expect(host.querySelector(".cv-file-viewer")).toBeNull();
  });

  it("persists the wrap toggle", async () => {
    const { reader } = memoryReader({ "src/app.ts": text("src/app.ts", "x") });
    const host = render({ reader });
    act(() => row(host, `${ROOT}/src/app.ts`).click());
    await settle();
    expect(button(host, "Wrap lines").getAttribute("aria-pressed")).toBe("false");

    act(() => button(host, "Wrap lines").click());

    expect(button(host, "Wrap lines").getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.getItem(FILE_VIEWER_WRAP_STORAGE_KEY)).toBe("true");
    expect(host.querySelector(".highlighted-code--wrap")).not.toBeNull();
    unmountSurface();
    const again = render({ reader });
    act(() => row(again, `${ROOT}/src/app.ts`).click());
    await settle();
    expect(button(again, "Wrap lines").getAttribute("aria-pressed")).toBe("true");
  });

  it("renders a bounded window of rows for a 20k-line file and reveals a requested line", async () => {
    const contents = Array.from({ length: 20_000 }, (_unused, index) => `line ${index + 1}`).join(
      "\n",
    );
    const { reader } = memoryReader({ "src/big.ts": text("src/big.ts", contents) });
    const host = render({ reader });
    act(() => row(host, `${ROOT}/src/big.ts`).click());
    await settle();

    const rendered = host.querySelectorAll(".cv-file-viewer .highlighted-code__line");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThanOrEqual(256);
    expect(host.querySelector('[data-line="1"]')).not.toBeNull();
    expect(host.querySelector('[data-line="15000"]')).toBeNull();

    render({ reader, reveal: { path: `${ROOT}/src/big.ts`, line: 15_000, sequence: 1 } });
    await settle();

    const revealed = host.querySelector('[data-line="15000"]');
    expect(revealed?.classList).toContain("is-current");
    expect(
      host.querySelectorAll(".cv-file-viewer .highlighted-code__line").length,
    ).toBeLessThanOrEqual(256);
  });

  it("opens a revealed file from a link without touching the editor", async () => {
    const { reader } = memoryReader({ "src/app.ts": text("src/app.ts", "a\nb\nc") });
    const host = render({
      reader,
      reveal: { path: `${ROOT}/src/app.ts`, line: 2, sequence: 4 },
    });
    await settle();

    expect(host.querySelector(".cv-file-viewer")?.getAttribute("data-file-viewer-path")).toBe(
      "src/app.ts",
    );
    expect(host.querySelector('[data-line="2"]')?.getAttribute("aria-current")).toBe("true");
  });

  it("re-reads the open file on refresh without flashing a loading state", async () => {
    let version = 1;
    const { reader, calls } = memoryReader({
      "src/app.ts": () => text("src/app.ts", `version ${version}`),
    });
    const host = render({ reader });
    act(() => row(host, `${ROOT}/src/app.ts`).click());
    await settle();
    expect(viewerText(host)).toContain("version 1");

    version = 2;
    act(() => button(host, "Reload file").click());
    expect(viewerText(host)).toContain("version 1");
    await settle();

    expect(calls).toHaveLength(2);
    expect(viewerText(host)).toContain("version 2");
  });

  it("copies the absolute path and the contents", async () => {
    const copyText = vi.fn(async () => undefined);
    const { reader } = memoryReader({ "src/app.ts": text("src/app.ts", "body") });
    const host = render({ reader, context: rightPanelTestContext({ copyText }) });
    act(() => row(host, `${ROOT}/src/app.ts`).click());
    await settle();

    act(() => button(host, "Copy path").click());
    await settle();
    act(() => button(host, "Copy contents").click());
    await settle();

    expect(copyText.mock.calls).toEqual([[`${ROOT}/src/app.ts`], ["body"]]);
    expect(host.querySelector(".cv-file-viewer__notice")?.textContent).toBe("Contents copied.");
  });

  it.each([
    ["narrow", 500],
    ["wide", 900],
  ])("keeps the tree after the viewer on a %s panel", async (_label, width) => {
    StubResizeObserver.width = width;
    const { reader } = memoryReader({ "src/app.ts": text("src/app.ts", "x") });
    const host = render({ reader });
    act(() => row(host, `${ROOT}/src/app.ts`).click());
    await settle();

    const files = host.querySelector(".cv-files");
    expect(files?.classList.contains("cv-files--narrow")).toBe(width < 760);
    const columns = [...host.querySelectorAll(".cv-files__split > .cv-files__column")];
    expect(columns.map((column) => column.className)).toEqual([
      "cv-files__column cv-files__column--main",
      "cv-files__column cv-files__column--tree",
    ]);
    expect(columns[0]?.querySelector(".cv-file-viewer")).not.toBeNull();
    expect(columns[1]?.querySelector('nav[aria-label="Workspace files"]')).not.toBeNull();
    expect(row(host, `${ROOT}/src/app.ts`).classList).toContain("active");
    expect(button(host, "Hide file tree").getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('button[aria-label="Back to files"]')).toBeNull();
  });

  it("collapses the tree from the header, offers Back only then, and remembers it", async () => {
    StubResizeObserver.width = 500;
    const { reader } = memoryReader({ "src/app.ts": text("src/app.ts", "x") });
    const host = render({ reader });
    act(() => row(host, `${ROOT}/src/app.ts`).click());
    await settle();

    act(() => button(host, "Hide file tree").click());
    expect(host.querySelector('nav[aria-label="Workspace files"]')).toBeNull();
    expect(host.querySelectorAll(".cv-files__column")).toHaveLength(1);
    expect(button(host, "Show file tree").getAttribute("aria-pressed")).toBe("false");
    expect(button(host, "Back to files")).not.toBeNull();
    expect(window.localStorage.getItem(FILE_VIEWER_TREE_STORAGE_KEY)).toBe("false");

    unmountSurface();
    const reopened = render({ reader });
    act(() => row(reopened, `${ROOT}/src/app.ts`).click());
    await settle();
    expect(reopened.querySelector('nav[aria-label="Workspace files"]')).toBeNull();
    expect(button(reopened, "Show file tree")).not.toBeNull();

    act(() => button(reopened, "Show file tree").click());
    expect(reopened.querySelector('nav[aria-label="Workspace files"]')).not.toBeNull();
    expect(reopened.querySelector('button[aria-label="Back to files"]')).toBeNull();
    expect(window.localStorage.getItem(FILE_VIEWER_TREE_STORAGE_KEY)).toBe("true");
  });

  it("moves copy path and reload into a More menu when the viewer is narrow", async () => {
    StubResizeObserver.width = 400;
    const copyText = vi.fn(async () => undefined);
    const { reader, calls } = memoryReader({ "src/app.ts": text("src/app.ts", "body") });
    const host = render({ reader, context: rightPanelTestContext({ copyText }) });
    act(() => row(host, `${ROOT}/src/app.ts`).click());
    await settle();

    expect(host.querySelector('button[aria-label="Copy path"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Reload file"]')).toBeNull();
    expect(button(host, "Copy contents")).not.toBeNull();
    const more = button(host, "More file actions");
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    expect(more.getAttribute("aria-expanded")).toBe("false");

    act(() => more.click());
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const menu = document.body.querySelector('[role="menu"][aria-label="More file actions"]');
    expect(menu).not.toBeNull();
    expect(
      [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].map((item) => item.textContent),
    ).toEqual(["Copy path", "Reload file"]);
    act(() => menuItem("Copy path").click());
    await settle();
    expect(copyText.mock.calls).toEqual([[`${ROOT}/src/app.ts`]]);
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    const notice = host.querySelector(".cv-file-viewer__notice");
    expect(notice?.textContent).toBe("Path copied.");
    expect(notice?.closest("header")).toBeNull();
    expect(notice?.previousElementSibling?.tagName).toBe("HEADER");

    act(() => more.click());
    act(() => menuItem("Reload file").click());
    await settle();
    expect(calls).toHaveLength(2);
  });

  it("keeps only the tree toggle and More in a minimal viewer header", async () => {
    StubResizeObserver.width = 280;
    const copyText = vi.fn(async () => undefined);
    const { reader } = memoryReader({ "README.md": text("README.md", "# Title") });
    const host = render({ reader, context: rightPanelTestContext({ copyText }) });
    act(() => row(host, `${ROOT}/README.md`).click());
    await until(() =>
      expect(host.querySelector(".cv-file-viewer__markdown h1")?.textContent).toBe("Title"),
    );

    expect(host.querySelector(".cv-files")?.classList).toContain("cv-files--tight");
    expect(
      [...host.querySelectorAll(".cv-file-viewer__head button[aria-label]")].map((item) =>
        item.getAttribute("aria-label"),
      ),
    ).toEqual(["Hide file tree", "More file actions"]);
    const crumbs = [...host.querySelectorAll('nav[aria-label="File path"] > *')];
    expect(crumbs.map((crumb) => crumb.textContent)).toEqual(["README.md"]);
    expect(crumbs[0]?.getAttribute("title")).toBe("README.md");

    const more = button(host, "More file actions");
    act(() => more.click());
    const items = [...document.body.querySelectorAll('[role="menu"] [role^="menuitem"]')];
    expect(items.map((item) => [item.textContent, item.getAttribute("role")])).toEqual([
      ["Show Markdown source", "menuitem"],
      ["Wrap lines", "menuitemcheckbox"],
      ["Copy path", "menuitem"],
      ["Copy contents", "menuitem"],
      ["Reload file", "menuitem"],
    ]);
    expect(items[1]?.getAttribute("aria-checked")).toBe("false");

    act(() => menuItem("Wrap lines").click());
    expect(window.localStorage.getItem(FILE_VIEWER_WRAP_STORAGE_KEY)).toBe("true");
    act(() => more.click());
    expect(menuItem("Wrap lines").getAttribute("aria-checked")).toBe("true");
    act(() => menuItem("Copy contents").click());
    await settle();
    expect(copyText.mock.calls).toEqual([["# Title"]]);

    act(() => more.click());
    act(() => menuItem("Show Markdown source").click());
    expect(host.querySelector(".cv-file-viewer__markdown")).toBeNull();
    expect(viewerText(host)).toContain("# Title");
  });

  it("closes the More menu on Escape without closing the viewer", async () => {
    StubResizeObserver.width = 280;
    const { reader } = memoryReader({ "src/app.ts": text("src/app.ts", "x") });
    const host = render({ reader });
    act(() => row(host, `${ROOT}/src/app.ts`).click());
    await settle();

    act(() => button(host, "More file actions").click());
    press(menuItem("Copy path"), "Escape");

    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    expect(host.querySelector(".cv-file-viewer")).not.toBeNull();
  });

  it("keeps copy path and reload in the header on a wide panel", async () => {
    StubResizeObserver.width = 900;
    const { reader } = memoryReader({ "src/app.ts": text("src/app.ts", "x") });
    const host = render({ reader });
    act(() => row(host, `${ROOT}/src/app.ts`).click());
    await settle();

    expect(button(host, "Copy path")).not.toBeNull();
    expect(button(host, "Reload file")).not.toBeNull();
    expect(host.querySelector('button[aria-label="More file actions"]')).toBeNull();
  });

  it("renders Markdown and switches to its source", async () => {
    const { reader } = memoryReader({ "README.md": text("README.md", "# Title\n\nSome *text*.") });
    const host = render({ reader });
    act(() => row(host, `${ROOT}/README.md`).click());
    await until(() =>
      expect(host.querySelector(".cv-file-viewer__markdown h1")?.textContent).toBe("Title"),
    );

    act(() => button(host, "Show Markdown source").click());

    expect(host.querySelector(".cv-file-viewer__markdown")).toBeNull();
    expect(viewerText(host)).toContain("# Title");
  });

  describe("in a worktree thread", () => {
    const worktreeTree = () =>
      fileTree({
        tree: tree({
          rootPath: SURFACE_FIXTURE_WORKTREE,
          entriesByDirectory: {
            [SURFACE_FIXTURE_WORKTREE]: [entry(`${SURFACE_FIXTURE_WORKTREE}/src`, "directory")],
            [`${SURFACE_FIXTURE_WORKTREE}/src`]: [entry(`${SURFACE_FIXTURE_WORKTREE}/src/app.ts`)],
          },
          expandedDirectories: new Set([`${SURFACE_FIXTURE_WORKTREE}/src`]),
        }),
      });
    const threadContext = () => rightPanelTestContext({ thread: surfaceThreadView() });

    it.each([
      ["a main project path", `${SURFACE_FIXTURE_ROOT}/src/app.ts`],
      ["a path already in the worktree", `${SURFACE_FIXTURE_WORKTREE}/src/app.ts`],
    ])("opens %s at the same relative path in the thread checkout", async (_label, path) => {
      const { reader, calls } = memoryReader({ "src/app.ts": text("src/app.ts", "a\nb\nc") });
      const host = render({
        reader,
        fileTree: worktreeTree(),
        context: threadContext(),
        reveal: { path, line: 2, sequence: 1 },
      });
      await settle();

      expect(calls).toEqual([{ root: SURFACE_FIXTURE_WORKTREE, path: "src/app.ts" }]);
      expect(host.querySelector(".cv-file-viewer")?.getAttribute("data-file-viewer-path")).toBe(
        "src/app.ts",
      );
      expect(host.querySelector('[data-line="2"]')?.getAttribute("aria-current")).toBe("true");
    });

    it.each([
      ["outside the project", "/elsewhere/src/app.ts"],
      ["escaping the project", `${SURFACE_FIXTURE_ROOT}/../other/app.ts`],
    ])("ignores a path %s", async (_label, path) => {
      const { reader, calls } = memoryReader({ "src/app.ts": text("src/app.ts", "x") });
      const host = render({
        reader,
        fileTree: worktreeTree(),
        context: threadContext(),
        reveal: { path, line: null, sequence: 1 },
      });
      await settle();

      expect(calls).toEqual([]);
      expect(host.querySelector(".cv-file-viewer")).toBeNull();
      expect(host.querySelector('nav[aria-label="Workspace files"]')).not.toBeNull();
    });
  });

  it("does not map project paths when the thread has no worktree", async () => {
    const { reader, calls } = memoryReader({ "src/app.ts": text("src/app.ts", "x") });
    const host = render({ reader, reveal: { path: "/other/src/app.ts", line: null, sequence: 1 } });
    await settle();

    expect(calls).toEqual([]);
    expect(host.querySelector(".cv-file-viewer")).toBeNull();
  });

  it("says so when no preview reader is provided", () => {
    const host = render({ reader: null });
    act(() => row(host, `${ROOT}/src/app.ts`).click());
    expect(host.querySelector(".cv-file-viewer__body")?.textContent).toBe(
      "File preview is unavailable.",
    );
  });
});

function menuItem(label: string): HTMLButtonElement {
  const item = [...document.body.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]')].find(
    (candidate) => candidate.textContent === label,
  );
  if (item === undefined) throw new Error(`No menu item ${label}`);
  return item;
}
