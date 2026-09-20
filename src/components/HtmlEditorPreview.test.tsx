// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  HtmlFilePreviewHandle,
  HtmlFilePreviewPort,
} from "../application/htmlFilePreviewPort";
import { HtmlEditorPreview } from "./HtmlEditorPreview";

function setup(preview: HtmlFilePreviewPort) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const render = (port = preview) =>
    act(() =>
      root.render(
        <HtmlEditorPreview name="index.html" path="/workspace/index.html" preview={port}>
          <textarea defaultValue="unsaved source" />
        </HtmlEditorPreview>,
      ),
    );
  render();
  const click = async (label: string) => {
    await act(async () => {
      [...host.querySelectorAll("button")].find((button) => button.textContent === label)?.click();
    });
  };
  return { host, render, click, unmount: () => act(() => root.unmount()) };
}
function deferred() {
  let resolve!: (value: HtmlFilePreviewHandle) => void;
  const promise = new Promise<HtmlFilePreviewHandle>((value) => {
    resolve = value;
  });
  return { promise, resolve };
}
const handle = () => ({
  url: "codevo-artifact-preview://localhost/token",
  dispose: vi.fn(async () => {}),
});
afterEach(() => vi.useRealTimers());

describe("HTML editor preview", () => {
  it("captures on demand, preserves the editing surface, and revokes when returning to source", async () => {
    const ready = handle();
    const prepare = vi.fn(async () => ready);
    const ui = setup({ prepare });
    const source = ui.host.querySelector("textarea");
    expect(prepare).not.toHaveBeenCalled();
    await ui.click("Preview");
    expect(prepare).toHaveBeenCalledWith("/workspace/index.html");
    expect(ui.host.querySelector("textarea")).toBe(source);
    expect(source?.closest("[hidden]")).not.toBeNull();
    const frame = ui.host.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame?.getAttribute("src")).toBe(ready.url);
    await ui.click("Source");
    expect(ui.host.querySelector("iframe")).toBeNull();
    expect(source?.closest("[hidden]")).toBeNull();
    expect(ready.dispose).toHaveBeenCalledTimes(1);
    ui.unmount();
  });

  it("disposes a late result after closing preview and starts a fresh request on reopening", async () => {
    const first = deferred();
    const stale = handle();
    const fresh = handle();
    const prepare = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(fresh);
    const ui = setup({ prepare });
    await ui.click("Preview");
    await ui.click("Source");
    await ui.click("Preview");
    await act(async () => first.resolve(stale));
    expect(stale.dispose).toHaveBeenCalledTimes(1);
    expect(fresh.dispose).not.toHaveBeenCalled();
    ui.unmount();
    expect(fresh.dispose).toHaveBeenCalledTimes(1);
  });

  it("releases the previous snapshot when refreshing and shows recoverable preparation failures", async () => {
    const ready = handle();
    const prepare = vi
      .fn()
      .mockResolvedValueOnce(ready)
      .mockRejectedValueOnce(new Error("private path"));
    const ui = setup({ prepare });
    await ui.click("Preview");
    await ui.click("Refresh preview");
    expect(ready.dispose).toHaveBeenCalledTimes(1);
    expect(ui.host.textContent).toContain("Could not prepare");
    expect(ui.host.textContent).not.toContain("private path");
    expect(ui.host.querySelector("iframe")).toBeNull();
    ui.unmount();
  });

  it("expires preparation and revokes late handles without showing stale content", async () => {
    vi.useFakeTimers();
    const pending = deferred();
    const stale = handle();
    const ui = setup({ prepare: () => pending.promise });
    await ui.click("Preview");
    act(() => vi.advanceTimersByTime(20_000));
    expect(ui.host.textContent).toContain("Could not prepare");
    await act(async () => pending.resolve(stale));
    expect(stale.dispose).toHaveBeenCalledTimes(1);
    expect(ui.host.querySelector("iframe")).toBeNull();
    ui.unmount();
  });

  it("fails and releases a prepared frame that never loads", async () => {
    vi.useFakeTimers();
    const ready = handle();
    const ui = setup({ prepare: async () => ready });
    await ui.click("Preview");
    act(() => vi.advanceTimersByTime(20_000));
    expect(ui.host.textContent).toContain("Could not prepare");
    expect(ui.host.querySelector("iframe")).toBeNull();
    expect(ready.dispose).toHaveBeenCalledTimes(1);
    ui.unmount();
    expect(ready.dispose).toHaveBeenCalledTimes(1);
  });

  it("revokes a frame that reports a navigation error", async () => {
    const ready = handle();
    const ui = setup({ prepare: async () => ready });
    await ui.click("Preview");
    act(() =>
      ui.host.querySelector("iframe")?.dispatchEvent(new Event("error", { bubbles: true })),
    );
    expect(ui.host.querySelector("iframe")).toBeNull();
    expect(ready.dispose).toHaveBeenCalledTimes(1);
    ui.unmount();
  });

  it("hides and revokes a previous owner snapshot while replacement preparation is pending", async () => {
    const ready = handle();
    const pending = deferred();
    const next = handle();
    const ui = setup({ prepare: async () => ready });
    await ui.click("Preview");
    ui.render({ prepare: () => pending.promise });
    expect(ui.host.querySelector("iframe")).toBeNull();
    expect(ready.dispose).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(next));
    expect(ui.host.querySelector("iframe")).not.toBeNull();
    ui.unmount();
    expect(next.dispose).toHaveBeenCalledTimes(1);
  });

  it("expires a displayed snapshot before its native capability expires", async () => {
    vi.useFakeTimers();
    const ready = handle();
    const ui = setup({ prepare: async () => ready });
    await ui.click("Preview");
    act(() => ui.host.querySelector("iframe")?.dispatchEvent(new Event("load")));
    act(() => vi.advanceTimersByTime(25 * 60_000));
    expect(ui.host.querySelector("iframe")).toBeNull();
    expect(ready.dispose).toHaveBeenCalledTimes(1);
    ui.unmount();
    expect(ready.dispose).toHaveBeenCalledTimes(1);
  });
});
