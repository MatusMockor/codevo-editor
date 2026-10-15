import { act } from "react";
import { afterEach, beforeEach } from "vitest";
import type { FilePreviewReader } from "../../../../application/filePreview/filePreviewReader";
import {
  createAgentFileViewerSessions,
  type AgentFileViewerSessions,
} from "../../../../application/rightPanel/useAgentFileViewerSessions";
import type { AgentSurfaceFileTreeSurface } from "../../../../application/useAgentSurfaceFileTree";
import type { FilePreview } from "../../../../domain/filePreview";
import type { FileEntry } from "../../../../domain/workspace";
import { CodeHighlighterProvider } from "../../../../infrastructure/codeHighlight/CodeHighlighterProvider";
import { createInlineCodeHighlighter } from "../../../../infrastructure/codeHighlight/inlineCodeHighlighter";
import { mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import type { AgentSurfaceFileTreeProps } from "../../AgentSurfaceFileTree";
import type { AgentRightPanelContextValue } from "../agentRightPanelContext";
import { WithRightPanelContext, rightPanelTestContext } from "../agentRightPanelTestSupport";
import { AgentFilesSurface, type AgentFilesReveal } from "../files/AgentFilesSurface";
import { AgentFileViewerProvider } from "./AgentFileViewerProvider";

export const ROOT = "/repo";
const highlighter = createInlineCodeHighlighter();
const realResizeObserver = globalThis.ResizeObserver;

let ui: MountedUi | null = null;

export class StubResizeObserver {
  static width = 0;
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    if (StubResizeObserver.width === 0) return;
    const entry = { target, contentRect: { width: StubResizeObserver.width } };
    this.callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve(): void {}
  disconnect(): void {}
}

export function installViewerTestEnvironment(): void {
  beforeEach(() => {
    StubResizeObserver.width = 0;
    if (typeof Element.prototype.scrollIntoView !== "function") {
      Element.prototype.scrollIntoView = () => undefined;
    }
    Object.assign(globalThis, { ResizeObserver: StubResizeObserver });
    window.localStorage.clear();
  });

  afterEach(() => {
    unmountSurface();
    Object.assign(globalThis, { ResizeObserver: realResizeObserver });
  });
}

export function unmountSurface(): void {
  ui?.unmount();
  ui = null;
}

export function entry(path: string, kind: FileEntry["kind"] = "file"): FileEntry {
  return { name: path.slice(path.lastIndexOf("/") + 1), path, kind };
}

export function tree(
  overrides: Partial<AgentSurfaceFileTreeSurface> = {},
): AgentSurfaceFileTreeSurface {
  return {
    rootPath: ROOT,
    entriesByDirectory: {
      [ROOT]: [entry(`${ROOT}/src`, "directory"), entry(`${ROOT}/README.md`)],
      [`${ROOT}/src`]: [entry(`${ROOT}/src/app.ts`), entry(`${ROOT}/src/big.ts`)],
    },
    expandedDirectories: new Set([`${ROOT}/src`]),
    loadingDirectories: new Set(),
    failedDirectories: new Set(),
    truncatedDirectories: new Set(),
    rootError: null,
    toggleDirectory: () => undefined,
    retryDirectory: () => undefined,
    refresh: () => undefined,
    ...overrides,
  };
}

export function fileTree(
  overrides: Partial<AgentSurfaceFileTreeProps> = {},
): AgentSurfaceFileTreeProps {
  return {
    source: "thread",
    tree: tree(),
    unavailable: null,
    activePath: null,
    revealActivePathSignal: 0,
    fileStatusesByPath: {},
    searchFiles: { shortcut: "Cmd+P" },
    onOpenFile: () => {
      throw new Error("the Files surface must not open the editor");
    },
    onPreviewFile: () => {
      throw new Error("the Files surface must not preview in the editor");
    },
    ...overrides,
  };
}

export function text(relativePath: string, contents: string): FilePreview {
  return {
    kind: "text",
    relativePath,
    contents,
    byteLength: new TextEncoder().encode(contents).byteLength,
    truncated: false,
  };
}

export type Answer = FilePreview | Error | Promise<FilePreview>;

export function memoryReader(files: Record<string, Answer | (() => Answer)>) {
  const calls: Array<{ root: string; path: string }> = [];
  const reader: FilePreviewReader = {
    read: async (root, path) => {
      calls.push({ root, path });
      const found = files[path];
      const answer = typeof found === "function" ? found() : found;
      if (answer === undefined) throw new Error(`No such file: ${path}`);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { reader, calls };
}

export function deferred(): { promise: Promise<FilePreview>; resolve(value: FilePreview): void } {
  let resolve: (value: FilePreview) => void = () => undefined;
  const promise = new Promise<FilePreview>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export interface RenderOptions {
  readonly sessions?: AgentFileViewerSessions;
  readonly font?: { readonly family: string | null; readonly size: number | null };
  readonly treeShown?: boolean;
  readonly reader?: FilePreviewReader | null;
  readonly fileTree?: AgentSurfaceFileTreeProps | null;
  readonly reveal?: AgentFilesReveal | null;
  readonly context?: AgentRightPanelContextValue;
}

let defaultSessions: AgentFileViewerSessions | null = null;

export function render(options: RenderOptions = {}): HTMLElement {
  if (ui === null) defaultSessions = createAgentFileViewerSessions();
  ui = ui ?? mountUi();
  const sessions = options.sessions ?? defaultSessions ?? createAgentFileViewerSessions();
  ui.render(
    <CodeHighlighterProvider highlighter={highlighter} theme="dark-plus">
      <AgentFileViewerProvider
        fontFamily={options.font?.family ?? null}
        fontSize={options.font?.size ?? null}
        reader={options.reader === undefined ? memoryReader({}).reader : options.reader}
        sessions={sessions}
      >
        <WithRightPanelContext value={options.context ?? rightPanelTestContext()}>
          <AgentFilesSurface
            fileTree={options.fileTree === undefined ? fileTree() : options.fileTree}
            reveal={options.reveal ?? null}
            treeShown={options.treeShown ?? true}
          />
        </WithRightPanelContext>
      </AgentFileViewerProvider>
    </CodeHighlighterProvider>,
  );
  return ui.host;
}

export function row(host: HTMLElement, path: string): HTMLElement {
  const element = host.querySelector<HTMLElement>(`.cv-files [title^="${path}"]`);
  if (element === null) throw new Error(`No tree row for ${path}`);
  return element;
}

export function button(host: HTMLElement, label: string): HTMLButtonElement {
  const element = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (element === null) throw new Error(`No button ${label}`);
  return element;
}

export function viewerText(host: HTMLElement): string {
  return [...host.querySelectorAll(".cv-file-viewer .highlighted-code__text")]
    .map((line) => line.textContent ?? "")
    .join("");
}

export async function settle(): Promise<void> {
  await act(async () => undefined);
}

export async function until(check: () => void, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
    }
  }
}
