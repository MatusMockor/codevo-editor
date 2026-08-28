// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { retryableLazy } from "./retryableLazy";

describe("retryableLazy", () => {
  it("creates a fresh lazy component after a rejected chunk is retried", async () => {
    const load = vi
      .fn<() => Promise<{ default: (props: { label: string }) => React.ReactNode }>>()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce({ default: ({ label }) => <p>{label}</p> });
    const Surface = retryableLazy(load, "test surface");
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(<Surface label="Ready" />);
      await Promise.resolve();
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("chunk unavailable");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[data-action="retry"]')?.click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("Ready");
    expect(load).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
  });
});
