// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentHistoryCatalogSurface } from "../../application/useAgentHistoryCatalog";
import { catalogProject, catalogThread } from "../../test/agentHistoryCatalogFixtures";
import { AgentHistoryCatalog } from "./AgentHistoryCatalog";
function surface(): AgentHistoryCatalogSurface {
  return {
    projects: [catalogProject],
    page: {
      rootKey: catalogProject.rootKey,
      threads: [catalogThread()],
      hasEarlier: true,
      beforeThreadId: catalogThread().threadId,
      loading: false,
      error: null,
    },
    choose: vi.fn().mockResolvedValue(undefined),
    older: vi.fn().mockResolvedValue(undefined),
    latest: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    open: vi.fn().mockResolvedValue(true),
  };
}
describe("saved conversations UI", () => {
  it("opens only after restoration succeeds and exposes paging controls", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const catalog = surface();
    const select = vi.fn();
    act(() => root.render(<AgentHistoryCatalog catalog={catalog} onSelect={select} />));
    const button = (text: string) =>
      Array.from(host.querySelectorAll("button")).find((item) => item.textContent === text)!;
    expect(button("Saved conversations").getAttribute("aria-expanded")).toBe("true");
    await act(async () => button(catalogThread().title).click());
    expect(select).toHaveBeenCalledWith(catalogThread().threadId);
    act(() => button("Older conversations").click());
    expect(catalog.older).toHaveBeenCalledOnce();
    act(() => button("Back to newest").click());
    expect(catalog.latest).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
  it("does not navigate when restoration fails or when unmounted", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const catalog = surface();
    let resolve!: (value: boolean) => void;
    const open = vi.fn().mockReturnValue(
      new Promise<boolean>((done) => {
        resolve = done;
      }),
    );
    const select = vi.fn();
    act(() =>
      root.render(<AgentHistoryCatalog catalog={{ ...catalog, open }} onSelect={select} />),
    );
    act(() => {
      Array.from(host.querySelectorAll("button"))
        .find((item) => item.textContent === catalogThread().title)!
        .click();
    });
    act(() => root.unmount());
    await act(async () => resolve(true));
    expect(select).not.toHaveBeenCalled();
  });
});
