// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  useGitOperationCurrency,
  type GitOperationCurrency,
} from "./useGitOperationCurrency";

const ROOT = "/workspace";
const NESTED_ROOT = `${ROOT}/packages/nested`;

function renderCurrency() {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { currency: GitOperationCurrency | null } = {
    currency: null,
  };
  let workspaceRoot = ROOT;

  function Harness() {
    captured.currency = useGitOperationCurrency(workspaceRoot);
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    currency: () => {
      if (!captured.currency) {
        throw new Error("currency not mounted");
      }

      return captured.currency;
    },
    rerender: (nextRoot: string) => {
      workspaceRoot = nextRoot;
      act(() => root.render(<Harness />));
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("useGitOperationCurrency", () => {
  it("keeps its identity stable until operation loading changes", () => {
    const harness = renderCurrency();
    const initial = harness.currency();
    const initialMethods = {
      reserveOperation: initial.reserveOperation,
      reservePublication: initial.reservePublication,
      isRepositoryCurrent: initial.isRepositoryCurrent,
      releaseOperation: initial.releaseOperation,
      reserveRead: initial.reserveRead,
      isReadCurrent: initial.isReadCurrent,
    };

    harness.rerender(ROOT);

    expect(harness.currency()).toBe(initial);

    let reservation!: ReturnType<GitOperationCurrency["reserveOperation"]>;
    act(() => {
      reservation = harness.currency().reserveOperation([ROOT]);
    });

    const loading = harness.currency();
    expect(loading).not.toBe(initial);
    expect(loading.operationLoading).toBe(true);
    expect({
      reserveOperation: loading.reserveOperation,
      reservePublication: loading.reservePublication,
      isRepositoryCurrent: loading.isRepositoryCurrent,
      releaseOperation: loading.releaseOperation,
      reserveRead: loading.reserveRead,
      isReadCurrent: loading.isReadCurrent,
    }).toEqual(initialMethods);

    act(() => loading.releaseOperation(reservation));
    harness.unmount();
  });

  it("lets a later mutation supersede an older refresh publication", () => {
    const harness = renderCurrency();
    const refresh = harness.currency().reservePublication([ROOT]);
    let mutation!: ReturnType<GitOperationCurrency["reserveOperation"]>;
    act(() => {
      mutation = harness.currency().reserveOperation([ROOT]);
    });

    expect(harness.currency().isRepositoryCurrent(refresh, ROOT)).toBe(false);
    expect(harness.currency().isRepositoryCurrent(mutation, ROOT)).toBe(true);

    act(() => harness.currency().releaseOperation(mutation));
    harness.unmount();
  });

  it("defines a later refresh as the newest publication for its repository", () => {
    const harness = renderCurrency();
    let mutation!: ReturnType<GitOperationCurrency["reserveOperation"]>;
    act(() => {
      mutation = harness.currency().reserveOperation([ROOT]);
    });
    const refresh = harness.currency().reservePublication([ROOT]);

    expect(harness.currency().isRepositoryCurrent(mutation, ROOT)).toBe(false);
    expect(harness.currency().isRepositoryCurrent(refresh, ROOT)).toBe(true);

    act(() => harness.currency().releaseOperation(mutation));
    harness.unmount();
  });

  it("fences a refresh reserved during an active repository mutation", async () => {
    const harness = renderCurrency();
    let mutation!: ReturnType<GitOperationCurrency["reserveOperation"]>;
    act(() => {
      mutation = harness.currency().reserveOperation([ROOT]);
    });
    let finishMutation!: () => void;
    const pendingMutation = new Promise<void>((resolve) => {
      finishMutation = resolve;
    });
    let execution!: ReturnType<GitOperationCurrency["runRepositoryMutation"]>;

    await act(async () => {
      execution = harness.currency().runRepositoryMutation(
        mutation,
        ROOT,
        () => pendingMutation,
      );
      await Promise.resolve();
    });

    const refresh = harness.currency().reservePublication([ROOT]);
    expect(harness.currency().isRepositoryCurrent(refresh, ROOT)).toBe(false);
    expect(harness.currency().isOperationCurrent(mutation, ROOT)).toBe(true);

    await act(async () => {
      finishMutation();
      await execution;
    });

    expect(harness.currency().isRepositoryCurrent(refresh, ROOT)).toBe(false);
    expect(harness.currency().isRepositoryCurrent(mutation, ROOT)).toBe(true);
    act(() => harness.currency().releaseOperation(mutation));
    harness.unmount();
  });

  it("keeps independent nested repository publications current", () => {
    const harness = renderCurrency();
    let primary!: ReturnType<GitOperationCurrency["reserveOperation"]>;
    let nested!: ReturnType<GitOperationCurrency["reserveOperation"]>;
    act(() => {
      primary = harness.currency().reserveOperation([ROOT]);
      nested = harness.currency().reserveOperation([NESTED_ROOT]);
    });

    expect(harness.currency().isRepositoryCurrent(primary, ROOT)).toBe(true);
    expect(
      harness.currency().isRepositoryCurrent(nested, NESTED_ROOT),
    ).toBe(true);

    act(() => harness.currency().releaseOperation(nested));
    expect(harness.currency().operationLoading).toBe(true);
    act(() => harness.currency().releaseOperation(primary));
    expect(harness.currency().operationLoading).toBe(false);
    harness.unmount();
  });

  it("invalidates publication and read reservations across A to B to A", () => {
    const harness = renderCurrency();
    const publication = harness.currency().reservePublication([ROOT]);
    const read = harness.currency().reserveRead(ROOT, "src/App.php", false);

    harness.rerender("/workspace-b");
    harness.rerender(ROOT);

    expect(
      harness.currency().isRepositoryCurrent(publication, ROOT),
    ).toBe(false);
    expect(harness.currency().isReadCurrent(read)).toBe(false);
    harness.unmount();
  });

  it("keeps new A publication current while an old A mutation finishes after A to B to A", async () => {
    const harness = renderCurrency();
    let oldMutation!: ReturnType<GitOperationCurrency["reserveOperation"]>;
    act(() => {
      oldMutation = harness.currency().reserveOperation([ROOT]);
    });
    let finishOldMutation!: (value: string) => void;
    const deferredOldMutation = new Promise<string>((resolve) => {
      finishOldMutation = resolve;
    });
    let oldExecution!: ReturnType<
      GitOperationCurrency["runRepositoryMutation"]
    >;

    await act(async () => {
      oldExecution = harness.currency().runRepositoryMutation(
        oldMutation,
        ROOT,
        () => deferredOldMutation,
      );
      await Promise.resolve();
    });

    harness.rerender("/workspace-b");
    harness.rerender(ROOT);

    const newPublication = harness.currency().reservePublication([ROOT]);
    expect(newPublication.publishableRepositories[ROOT]).toBe(true);
    expect(
      harness.currency().isRepositoryCurrent(newPublication, ROOT),
    ).toBe(true);
    expect(harness.currency().operationLoading).toBe(false);

    let oldResult!: Awaited<typeof oldExecution>;
    await act(async () => {
      finishOldMutation("old A result");
      oldResult = await oldExecution;
    });

    expect(oldResult).toEqual({ executed: true, value: "old A result" });
    expect(harness.currency().isRepositoryCurrent(oldMutation, ROOT)).toBe(
      false,
    );
    expect(
      harness.currency().isRepositoryCurrent(newPublication, ROOT),
    ).toBe(true);

    act(() => harness.currency().releaseOperation(oldMutation));
    expect(harness.currency().operationLoading).toBe(false);
    harness.unmount();
  });
});
