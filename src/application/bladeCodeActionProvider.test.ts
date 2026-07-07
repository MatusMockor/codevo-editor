import { describe, expect, it, vi } from "vitest";
import { provideBladeCodeActions } from "./bladeCodeActionProvider";

describe("provideBladeCodeActions", () => {
  it("wraps the missing Blade view action when the workspace is active", async () => {
    const createMissingBladeViewCodeAction = vi.fn(async () => ({
      edits: [],
      kind: "quickfix",
      title: "Create Blade view invoices.show",
    }));

    await expect(
      provideBladeCodeActions("{{ view('invoices.show') }}", undefined, {
        createMissingBladeViewCodeAction,
        currentWorkspaceRootRef: { current: "/workspace" },
        workspaceRoot: "/workspace",
      }),
    ).resolves.toEqual([
      expect.objectContaining({ title: "Create Blade view invoices.show" }),
    ]);
    expect(createMissingBladeViewCodeAction).toHaveBeenCalledWith(
      "{{ view('invoices.show') }}",
      { end: 0, start: 0 },
      "blade",
      expect.any(Function),
    );
  });

  it("drops async actions after a root switch", async () => {
    const currentWorkspaceRootRef = { current: "/workspace" };
    const createMissingBladeViewCodeAction = vi.fn(async () => {
      currentWorkspaceRootRef.current = "/other";

      return {
        edits: [],
        kind: "quickfix",
        title: "Create Blade view invoices.show",
      };
    });

    await expect(
      provideBladeCodeActions("x", { end: 1, start: 0 }, {
        createMissingBladeViewCodeAction,
        currentWorkspaceRootRef,
        workspaceRoot: "/workspace",
      }),
    ).resolves.toEqual([]);
  });
});
