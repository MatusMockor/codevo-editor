// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkbenchNotice } from "../application/workbenchNotice";
import {
  languageServerCrashNoticeGroupKey,
  languageServerCrashNoticeToastRenderer,
  languageServerRequestErrorNoticeGroupKey,
  languageServerRequestErrorNoticeToastRenderer,
} from "./LanguageServerCrashNotice";

describe("languageServerCrashNoticeGroupKey", () => {
  it("scopes the group key to the active workspace root so crash notices never leak across project tabs", () => {
    expect(languageServerCrashNoticeGroupKey("/workspace-a")).not.toBe(
      languageServerCrashNoticeGroupKey("/workspace-b"),
    );
  });

  it("returns null without a workspace root", () => {
    expect(languageServerCrashNoticeGroupKey(null)).toBeNull();
  });
});

describe("languageServerCrashNoticeToastRenderer", () => {
  let host: HTMLDivElement;
  let root: Root;

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

  it("does not register a renderer without an active workspace root", () => {
    const entry = languageServerCrashNoticeToastRenderer({
      onOpenRuntimePanel: vi.fn(),
      workspaceRoot: null,
    });

    expect(entry).toBeNull();
  });

  it("renders the crash message with an action that opens the Runtime panel and dismisses", async () => {
    const onOpenRuntimePanel = vi.fn();
    const dismiss = vi.fn();
    const entry = languageServerCrashNoticeToastRenderer({
      onOpenRuntimePanel,
      workspaceRoot: "/workspace",
    });

    expect(entry).not.toBeNull();
    const [groupKey, renderer] = entry!;
    expect(groupKey).toBe(languageServerCrashNoticeGroupKey("/workspace"));

    const notice = createWorkbenchNotice(
      "error",
      "Language Server",
      "phpactor exited with code 1",
      groupKey,
    );

    await act(async () => {
      root.render(<>{renderer(notice, { dismiss })}</>);
    });

    expect(host.textContent).toContain("phpactor exited with code 1");
    expect(host.textContent).toContain("PHP IDE engine crashed");

    const openButton = Array.from(
      host.querySelectorAll("button"),
    ).find((button) => button.textContent === "Open Runtime panel");

    expect(openButton).not.toBeUndefined();

    await act(async () => {
      openButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(onOpenRuntimePanel).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("renders request errors without presenting them as runtime crashes", async () => {
    const dismiss = vi.fn();
    const entry = languageServerRequestErrorNoticeToastRenderer({
      workspaceRoot: "/workspace",
    });

    expect(entry).not.toBeNull();
    const [groupKey, renderer] = entry!;
    expect(groupKey).toBe(
      languageServerRequestErrorNoticeGroupKey("/workspace"),
    );
    expect(groupKey).not.toBe(languageServerCrashNoticeGroupKey("/workspace"));

    const notice = createWorkbenchNotice(
      "error",
      "Language Server",
      "UnknownDocument: still-open document is desynced",
      groupKey,
    );

    await act(async () => {
      root.render(<>{renderer(notice, { dismiss })}</>);
    });

    expect(host.textContent).toContain("PHP IDE request failed");
    expect(host.textContent).not.toContain("PHP IDE engine crashed");
    expect(host.textContent).not.toContain("Open Runtime panel");
  });
});
