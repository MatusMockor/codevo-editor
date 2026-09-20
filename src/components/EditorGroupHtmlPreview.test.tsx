// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EditorGroupHtmlPreview,
  type EditorHtmlPreviewEnvironment,
} from "./EditorGroupHtmlPreview";
import { createWorkspaceRootFromPath } from "../domain/workspacePath";

const capture = vi.hoisted(() => vi.fn());
const runtime = vi.hoisted(() => ({ captureGroupPreviewContent: capture }));
vi.mock("./editorRuntimeContext", () => ({
  useEditorRuntimeContext: () => runtime,
}));

const host = document.createElement("div");
let root = createRoot(host);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(host);
  vi.resetAllMocks();
});

function environment(
  prepare = vi.fn(async () => ({
    url: "http://preview/index.html",
    dispose: vi.fn(async () => {}),
  })),
) {
  const parsed = createWorkspaceRootFromPath("/workspace");
  if (!parsed.ok) throw new Error("fixture");
  return {
    gateway: { prepare },
    workspace: {
      workspaceId: "workspace-1",
      canonicalRoot: "/workspace",
      selectedPath: "/workspace",
      caseSensitive: true,
      unicodeNormalizationPolicy: "preserved",
      policy: parsed.value.policy,
    },
  } satisfies EditorHtmlPreviewEnvironment;
}
async function showPreview(
  env: EditorHtmlPreviewEnvironment,
  path = "/workspace/report/index.html",
) {
  await act(async () =>
    root.render(
      <EditorGroupHtmlPreview environment={env} groupId="group" name="index.html" path={path}>
        <textarea defaultValue="source" />
      </EditorGroupHtmlPreview>,
    ),
  );
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Preview")
      ?.click(),
  );
}

describe("EditorGroupHtmlPreview", () => {
  it("uses exact live captured HTML and registered workspace-relative ownership", async () => {
    capture.mockReturnValue({
      html: "<h1>Unsaved live content</h1>",
      workspaceId: "workspace-1",
      isCurrent: () => true,
    });
    const env = environment();
    await showPreview(env);
    expect(capture).toHaveBeenCalledWith("group", "/workspace/report/index.html");
    expect(env.gateway.prepare).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      relativePath: "report/index.html",
      html: "<h1>Unsaved live content</h1>",
    });
    expect(host.querySelector("iframe")).not.toBeNull();
    expect(host.querySelector("textarea")?.value).toBe("source");
  });
  it.each([
    null,
    { html: "secret", workspaceId: "other", isCurrent: () => true },
    { html: "stale", workspaceId: "workspace-1", isCurrent: () => false },
  ])("rejects unavailable, foreign, or stale captures", async (value) => {
    capture.mockReturnValue(value);
    const env = environment();
    await showPreview(env);
    expect(env.gateway.prepare).not.toHaveBeenCalled();
    expect(host.querySelector("iframe")).toBeNull();
  });
  it("revokes a pending preview after its exact document authority changes", async () => {
    let current = true;
    capture.mockReturnValue({ html: "old", workspaceId: "workspace-1", isCurrent: () => current });
    const dispose = vi.fn(async () => {});
    let resolve!: (handle: { url: string; dispose: typeof dispose }) => void;
    const prepare = vi.fn(
      () =>
        new Promise<{ url: string; dispose: typeof dispose }>((accept) => {
          resolve = accept;
        }),
    );
    await showPreview(environment(prepare));
    current = false;
    await act(async () => resolve({ url: "http://preview/index.html", dispose }));
    expect(dispose).toHaveBeenCalledOnce();
    expect(host.querySelector("iframe")).toBeNull();
  });
  it("does not rebuild a preview on a harmless group render", async () => {
    capture.mockReturnValue({ html: "stable", workspaceId: "workspace-1", isCurrent: () => true });
    const env = environment();
    await showPreview(env);
    await act(async () =>
      root.render(
        <EditorGroupHtmlPreview
          environment={env}
          groupId="group"
          name="index.html"
          path="/workspace/report/index.html"
        >
          <textarea defaultValue="updated source view" />
        </EditorGroupHtmlPreview>,
      ),
    );
    expect(env.gateway.prepare).toHaveBeenCalledOnce();
  });

  it("rejects a path outside its registered root", async () => {
    capture.mockReturnValue({ html: "outside", workspaceId: "workspace-1", isCurrent: () => true });
    const env = environment();
    await showPreview(env, "/another/index.html");
    expect(env.gateway.prepare).not.toHaveBeenCalled();
  });
});
