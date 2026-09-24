// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaletteBranch, PaletteBranchSource } from "./commandPaletteProvider";
import type { PaletteBranchesView } from "./commandPaletteProvider";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { usePaletteBranches } from "./usePaletteBranches";

let ui: MountedUi | null = null;
let view: PaletteBranchesView = { status: "idle" };

function Harness({ source }: { source: PaletteBranchSource | null }) {
  view = usePaletteBranches({
    source,
    enabled: true,
    unavailableReason: "Branch switching for this project is not available here.",
  });
  return null;
}

function source(key: string, load: () => Promise<readonly PaletteBranch[]>): PaletteBranchSource {
  return { scopeKey: key, scopeLabel: key, load, switchTo: vi.fn(async () => undefined) };
}

afterEach(() => {
  ui?.unmount();
  ui = null;
});

describe("usePaletteBranches", () => {
  it("drops a late list from a replaced source", async () => {
    let resolveA: (value: readonly PaletteBranch[]) => void = () => undefined;
    const a = source(
      "a",
      () =>
        new Promise((resolve) => {
          resolveA = resolve;
        }),
    );
    const b = source("b", async () => [{ name: "main", current: true, remote: false }]);
    ui = mountUi();
    ui.render(<Harness source={a} />);
    expect(view.status).toBe("loading");
    await act(async () => ui?.render(<Harness source={b} />));
    await act(async () => resolveA([{ name: "stale", current: false, remote: false }]));
    expect(view).toEqual({
      status: "ready",
      scopeLabel: "b",
      branches: [{ name: "main", current: true, remote: false }],
    });
  });

  it("reports unavailable without a source and a bounded error message on failure", async () => {
    ui = mountUi();
    ui.render(<Harness source={null} />);
    expect(view).toEqual({
      status: "unavailable",
      reason: "Branch switching for this project is not available here.",
    });
    await act(async () =>
      ui?.render(
        <Harness source={source("c", async () => Promise.reject(new Error("x".repeat(900))))} />,
      ),
    );
    expect(view.status).toBe("error");
    expect(view.status === "error" ? view.message.length : 0).toBeLessThanOrEqual(300);
  });
});
