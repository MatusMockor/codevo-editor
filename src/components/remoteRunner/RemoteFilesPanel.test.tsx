// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RemoteFilesPanel } from "./RemoteFilesPanel";
import type { RemoteFileContent } from "../../domain/remoteRunnerSurfaces";
let root: Root;
let host: HTMLDivElement;
const scope = { serverId: "ui-server", runnerId: "runner", projectId: "project" };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("browses the exact server, prevents symlink opens, and explains binary files", async () => {
  const gateway = {
    listDirectory: vi.fn(async () => ({
      entries: [
        { name: "logo.png", path: "logo.png", kind: "file" as const },
        { name: "link", path: "link", kind: "symlink" as const },
      ],
      truncated: true,
      nextOffset: 200,
    })),
    readFile: vi.fn(async (): Promise<RemoteFileContent> => ({
      path: "logo.png",
      text: "",
      version: null,
      unavailableReason: "binary",
    })),
    writeFile: vi.fn(async (): Promise<RemoteFileContent> => {
      throw new Error("Should not save");
    }),
  };
  await act(async () => root.render(<RemoteFilesPanel scope={scope} gateway={gateway} />));
  expect(gateway.listDirectory).toHaveBeenCalledWith({ ...scope, path: "", offset: 0 });
  const buttons = () => [...host.querySelectorAll("button")];
  expect(buttons().find((button) => button.textContent?.includes("link"))?.disabled).toBe(true);
  await act(async () =>
    buttons()
      .find((button) => button.textContent?.includes("logo.png"))!
      .click(),
  );
  expect(host.textContent).toContain("binary file");
  expect(buttons().find((button) => button.textContent === "Save")?.disabled).toBe(true);
  await act(async () =>
    buttons()
      .find((button) => button.textContent === "Next files")!
      .click(),
  );
  expect(gateway.listDirectory).toHaveBeenLastCalledWith({ ...scope, path: "", offset: 200 });
});
