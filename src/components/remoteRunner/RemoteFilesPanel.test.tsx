// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waitForReact as waitFor } from "../../test/reactTestLifecycle";
import { RemoteFilesPanel } from "./RemoteFilesPanel";
import type {
  RemoteDirectory,
  RemoteFileContent,
  RemoteRunnerSurfacesGateway,
  RemoteSurfaceScope,
} from "../../domain/remoteRunnerSurfaces";
import { CodeHighlighterProvider } from "../../infrastructure/codeHighlight/CodeHighlighterProvider";
import { createInlineCodeHighlighter } from "../../infrastructure/codeHighlight/inlineCodeHighlighter";
import { createRemoteFileRevealRequest } from "../../application/remoteFileRevealRequest";

type SurfaceRequest<K extends keyof RemoteRunnerSurfacesGateway> = Parameters<
  RemoteRunnerSurfacesGateway[K]
>[0];

class RecordingFilesGateway {
  readonly calls: Array<Readonly<{ method: string; request: unknown }>> = [];
  readonly files = new Map<string, RemoteFileContent>();
  directory: RemoteDirectory = { entries: [], truncated: false, nextOffset: null };
  outage: Error | null = null;

  listDirectory = async (request: SurfaceRequest<"listDirectory">): Promise<RemoteDirectory> => {
    this.calls.push({ method: "listDirectory", request });
    if (this.outage !== null) throw this.outage;
    return this.directory;
  };

  readFile = async (request: SurfaceRequest<"readFile">): Promise<RemoteFileContent> => {
    this.calls.push({ method: "readFile", request });
    if (this.outage !== null) throw this.outage;
    const file = this.files.get(request.path);
    if (file === undefined) throw new Error("missing fixture");
    return file;
  };

  writeFile = async (request: SurfaceRequest<"writeFile">): Promise<RemoteFileContent> => {
    this.calls.push({ method: "writeFile", request });
    throw new Error("Remote files are read-only.");
  };

  methods(): readonly string[] {
    return this.calls.map((call) => call.method);
  }
}

let root: Root;
let host: HTMLDivElement;
const highlighter = createInlineCodeHighlighter();
const scope: RemoteSurfaceScope = { serverId: "ui-server", runnerId: "runner", projectId: "p" };

function textFile(path: string, text: string, version = "v1"): RemoteFileContent {
  return { path, text, version, unavailableReason: null };
}

function withHighlighter(children: ReactNode) {
  return (
    <CodeHighlighterProvider highlighter={highlighter} theme="calm-dark">
      {children}
    </CodeHighlighterProvider>
  );
}

function buttons() {
  return [...host.querySelectorAll("button")];
}

async function click(label: string) {
  const button = buttons().find((item) => item.textContent?.includes(label));
  if (button === undefined) throw new Error(`Missing button ${label}`);
  await act(async () => button.click());
}

function shownLines(): string[] {
  return [...host.querySelectorAll(".highlighted-code__text")].map(
    (line) => line.textContent ?? "",
  );
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("renders a server file read-only with highlighting and never writes", async () => {
  const gateway = new RecordingFilesGateway();
  gateway.directory = {
    entries: [{ name: "index.ts", path: "index.ts", kind: "file" }],
    truncated: false,
    nextOffset: null,
  };
  gateway.files.set("index.ts", textFile("index.ts", "const answer = 42;\nexport { answer };"));

  await act(async () =>
    root.render(withHighlighter(<RemoteFilesPanel scope={scope} gateway={gateway} />)),
  );
  await click("index.ts");

  expect(shownLines()).toEqual(["const answer = 42;", "export { answer };"]);
  await waitFor(() =>
    expect(host.querySelector("[aria-label='File contents']")?.getAttribute("data-highlight")).toBe(
      "highlighted",
    ),
  );
  expect(host.querySelector("textarea, [contenteditable='true'], .monaco-editor")).toBeNull();
  expect(
    buttons().some((button) => /^(Save|Discard changes)$/.test(button.textContent ?? "")),
  ).toBe(false);
  expect(gateway.methods()).toEqual(["listDirectory", "readFile"]);
});

it("explains binary and server-limited files without showing text", async () => {
  const gateway = new RecordingFilesGateway();
  gateway.directory = {
    entries: [
      { name: "logo.png", path: "logo.png", kind: "file" },
      { name: "dump.sql", path: "dump.sql", kind: "file" },
      { name: "link", path: "link", kind: "symlink" },
    ],
    truncated: true,
    nextOffset: 200,
  };
  gateway.files.set("logo.png", {
    path: "logo.png",
    text: "",
    version: null,
    unavailableReason: "binary",
  });
  gateway.files.set("dump.sql", {
    path: "dump.sql",
    text: "",
    version: null,
    unavailableReason: "large",
  });

  await act(async () => root.render(<RemoteFilesPanel scope={scope} gateway={gateway} />));
  expect(buttons().find((button) => button.textContent?.includes("link"))?.disabled).toBe(true);
  await click("logo.png");
  expect(host.textContent).toContain("binary file");
  expect(host.querySelector(".remote-surface-viewer")).toBeNull();
  expect(buttons().some((button) => button.textContent === "Compare with server")).toBe(false);
  await click("dump.sql");
  expect(host.textContent).toContain("too large to show");
  expect(host.querySelector(".remote-surface-viewer")).toBeNull();
  await click("Next files");
  expect(gateway.calls[gateway.calls.length - 1]).toEqual({
    method: "listDirectory",
    request: { ...scope, path: "", offset: 200 },
  });
  expect(gateway.methods()).not.toContain("writeFile");
});

it("windows a large text file and keeps it plain beyond the highlight budget", async () => {
  const gateway = new RecordingFilesGateway();
  const lines = Array.from({ length: 40_000 }, (_, index) => `line ${index + 1}`);
  gateway.directory = {
    entries: [{ name: "big.log", path: "big.log", kind: "file" }],
    truncated: false,
    nextOffset: null,
  };
  gateway.files.set("big.log", textFile("big.log", lines.join("\n")));

  await act(async () =>
    root.render(withHighlighter(<RemoteFilesPanel scope={scope} gateway={gateway} />)),
  );
  await click("big.log");

  const rendered = shownLines();
  expect(rendered[0]).toBe("line 1");
  expect(rendered.length).toBeGreaterThan(0);
  expect(rendered.length).toBeLessThan(1_000);
  await waitFor(() => expect(host.textContent).toContain("too large"));
  expect(host.querySelector("[aria-label='File contents']")?.getAttribute("data-highlight")).toBe(
    "plain",
  );
});

it("reports a runner outage without publishing content", async () => {
  const gateway = new RecordingFilesGateway();
  gateway.outage = new Error("Runner connection failed.");

  await act(async () => root.render(<RemoteFilesPanel scope={scope} gateway={gateway} />));

  expect(host.querySelector("[role='alert']")?.textContent).toBe("Runner connection failed.");
  expect(host.querySelector(".remote-surface-viewer")).toBeNull();
  expect(gateway.methods()).toEqual(["listDirectory"]);
});

it("compares the opened version with the latest server text through the text diff view", async () => {
  const gateway = new RecordingFilesGateway();
  gateway.directory = {
    entries: [{ name: "app.ts", path: "app.ts", kind: "file" }],
    truncated: false,
    nextOffset: null,
  };
  gateway.files.set("app.ts", textFile("app.ts", "const value = 1;"));

  await act(async () => root.render(<RemoteFilesPanel scope={scope} gateway={gateway} />));
  await click("app.ts");
  gateway.files.set("app.ts", textFile("app.ts", "const value = 2;", "v2"));
  await click("Compare with server");

  await waitFor(() => expect(host.querySelector(".cv-diff-file")?.textContent).toContain("2"));
  const diff = host.querySelector(".cv-diff-file")?.textContent ?? "";
  expect(diff).toContain("Opened version");
  expect(diff).toContain("Latest on server");
  expect(diff).toContain("const value = 1;");
  expect(diff).toContain("const value = 2;");
  await click("Show latest version");
  expect(host.querySelector(".cv-diff-file")).toBeNull();
  expect(shownLines()).toEqual(["const value = 2;"]);
  expect(gateway.methods()).toEqual(["listDirectory", "readFile", "readFile"]);
});

it("marks the revealed line of a linked server file", async () => {
  const gateway = new RecordingFilesGateway();
  gateway.files.set("src/app.ts", textFile("src/app.ts", "one\ntwo\nthree"));
  const settled = vi.fn();
  const reveal = createRemoteFileRevealRequest(
    1,
    scope,
    { path: "src/app.ts", line: 2, column: null },
    { settled },
  );

  await act(async () =>
    root.render(<RemoteFilesPanel scope={scope} gateway={gateway} reveal={reveal} />),
  );

  expect(settled).toHaveBeenCalledWith("opened");
  expect(host.querySelector(".highlighted-code__line.is-current")?.textContent).toContain("two");
  expect(gateway.methods()).not.toContain("writeFile");
});
