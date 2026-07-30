// @vitest-environment jsdom

import type { SmartModeGateway } from "../domain/intelligence";
import type { FileEntry } from "../domain/workspace";
import {
  act,
  createDeferred,
  defaultAppSettings,
  describe,
  directoryEntry,
  expect,
  fileEntry,
  flushAsyncTurns,
  it,
  setupWorkbenchControllerTestHarness,
  trustedDescriptor,
  vi,
  waitForReact,
} from "./useWorkbenchController.preview/testSupport";

describe("useWorkbenchController directory cache fast path", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

  it("projects the exact cached tree before its authoritative refresh settles", async () => {
    const workspaceA = "/workspace-a";
    const workspaceB = "/workspace-b";
    const cachedEntry = fileEntry(`${workspaceA}/cached.ts`, "cached.ts");
    const refreshedEntry = fileEntry(`${workspaceA}/refreshed.ts`, "refreshed.ts");
    const refreshedDirectory = createDeferred<FileEntry[]>();
    const returningSmartMode = createDeferred<Awaited<ReturnType<SmartModeGateway["setMode"]>>>();
    let workspaceAReadCount = 0;
    let workspaceAModeCount = 0;
    const readDirectory = vi.fn(async (path: string) => {
      if (path !== workspaceA) {
        return [];
      }

      workspaceAReadCount += 1;
      return workspaceAReadCount === 1 ? [cachedEntry] : refreshedDirectory.promise;
    });
    const smartModeGateway: SmartModeGateway = {
      getState: vi.fn(async () => ({
        message: "Basic",
        mode: "basic" as const,
        status: "off" as const,
      })),
      setMode: vi.fn(async (rootPath, mode) => {
        if (rootPath === workspaceA) {
          workspaceAModeCount += 1;
          if (workspaceAModeCount === 2) {
            return returningSmartMode.promise;
          }
        }

        return {
          message: "Updated",
          mode,
          status: "ready" as const,
        };
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: workspaceA,
        workspaceTabs: [workspaceA, workspaceB],
      },
      readDirectory,
      smartModeGateway,
    });

    await waitForReact(() => {
      expect(getWorkbench().entriesByDirectory[workspaceA]).toEqual([cachedEntry]);
    });
    await act(async () => {
      await getWorkbench().activateWorkspaceTab(workspaceB);
    });

    let returningToA!: Promise<void>;
    await act(async () => {
      returningToA = getWorkbench().activateWorkspaceTab(workspaceA);
      await flushAsyncTurns(8);
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceRoot).toBe(workspaceA);
      expect(getWorkbench().entriesByDirectory[workspaceA]).toEqual([cachedEntry]);
    });
    expect(workspaceAReadCount).toBe(1);

    returningSmartMode.resolve({
      message: "Updated",
      mode: "basic",
      status: "ready",
    });
    await waitForReact(() => {
      expect(workspaceAReadCount).toBe(2);
    });
    expect(getWorkbench().entriesByDirectory[workspaceA]).toEqual([cachedEntry]);

    refreshedDirectory.resolve([refreshedEntry]);
    await act(async () => {
      await returningToA;
    });

    expect(getWorkbench().entriesByDirectory[workspaceA]).toEqual([refreshedEntry]);
    expect(readDirectory.mock.calls.filter(([path]) => path === workspaceA)).toHaveLength(2);
  });

  it("boundedly refreshes restored expanded directories after an inactive workspace changes", async () => {
    const workspaceA = "/workspace-a";
    const workspaceB = "/workspace-b";
    const sourceDirectory = `${workspaceA}/src`;
    const sourceEntry = directoryEntry(sourceDirectory, "src");
    const cachedChild = fileEntry(`${sourceDirectory}/cached.ts`, "cached.ts");
    const refreshedChild = fileEntry(`${sourceDirectory}/refreshed.ts`, "refreshed.ts");
    let sourceReadCount = 0;
    const readDirectory = vi.fn(async (path: string): Promise<FileEntry[]> => {
      if (path === workspaceA) {
        return [sourceEntry];
      }
      if (path === sourceDirectory) {
        sourceReadCount += 1;
        return sourceReadCount === 1 ? [cachedChild] : [refreshedChild];
      }
      return [];
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: workspaceA,
        workspaceTabs: [workspaceA, workspaceB],
      },
      readDirectory,
    });

    await waitForReact(() => {
      expect(getWorkbench().entriesByDirectory[workspaceA]).toEqual([sourceEntry]);
    });
    await act(async () => {
      await getWorkbench().toggleDirectory(sourceDirectory);
    });
    expect(getWorkbench().entriesByDirectory[sourceDirectory]).toEqual([cachedChild]);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab(workspaceB);
      await getWorkbench().activateWorkspaceTab(workspaceA);
    });
    expect(getWorkbench().expandedDirectories.has(sourceDirectory)).toBe(true);
    await waitForReact(() => {
      expect(sourceReadCount).toBe(2);
      expect(getWorkbench().entriesByDirectory[sourceDirectory]).toEqual([refreshedChild]);
    });

    expect(readDirectory.mock.calls.filter(([path]) => path === sourceDirectory)).toHaveLength(2);
    expect(sourceReadCount).toBe(2);
  });

  it("defers a collapsed cached directory refresh until its next expansion", async () => {
    const workspaceA = "/workspace-a";
    const workspaceB = "/workspace-b";
    const sourceDirectory = `${workspaceA}/src`;
    const sourceEntry = directoryEntry(sourceDirectory, "src");
    const cachedChild = fileEntry(`${sourceDirectory}/cached.ts`, "cached.ts");
    const refreshedChild = fileEntry(`${sourceDirectory}/refreshed.ts`, "refreshed.ts");
    let sourceReadCount = 0;
    const readDirectory = vi.fn(async (path: string): Promise<FileEntry[]> => {
      if (path === workspaceA) {
        return [sourceEntry];
      }
      if (path === sourceDirectory) {
        sourceReadCount += 1;
        return sourceReadCount === 1 ? [cachedChild] : [refreshedChild];
      }
      return [];
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: workspaceA,
        workspaceTabs: [workspaceA, workspaceB],
      },
      readDirectory,
    });

    await waitForReact(() => {
      expect(getWorkbench().entriesByDirectory[workspaceA]).toEqual([sourceEntry]);
    });
    await act(async () => {
      await getWorkbench().toggleDirectory(sourceDirectory);
    });
    await act(async () => {
      await getWorkbench().toggleDirectory(sourceDirectory);
    });
    expect(getWorkbench().expandedDirectories.has(sourceDirectory)).toBe(false);
    await act(async () => {
      await getWorkbench().activateWorkspaceTab(workspaceB);
      await getWorkbench().activateWorkspaceTab(workspaceA);
    });

    expect(sourceReadCount).toBe(1);
    expect(getWorkbench().entriesByDirectory[sourceDirectory]).toEqual([cachedChild]);
    await act(async () => {
      await getWorkbench().toggleDirectory(sourceDirectory);
    });

    expect(sourceReadCount).toBe(2);
    expect(getWorkbench().entriesByDirectory[sourceDirectory]).toEqual([refreshedChild]);
  });

  it("never primes another owner's cached tree during a same-path generation replacement", async () => {
    const workspaceRoot = "/workspace";
    const sourceDirectory = `${workspaceRoot}/src`;
    const testDirectory = `${workspaceRoot}/test`;
    const ownerA = trustedDescriptor("workspace-owner-a", workspaceRoot);
    const ownerB = trustedDescriptor("workspace-owner-b", workspaceRoot);
    let requestedOwner = ownerA;
    let renderHistory: Array<{
      readonly entries: Record<string, readonly string[]>;
      readonly ownerId: string | null;
    }> = [];
    const readDirectory = vi.fn(async (path: string): Promise<FileEntry[]> => {
      if (path === workspaceRoot) {
        return requestedOwner === ownerA
          ? [directoryEntry(sourceDirectory, "src")]
          : [directoryEntry(testDirectory, "test")];
      }
      if (path === sourceDirectory) {
        return [fileEntry(`${sourceDirectory}/a.ts`, "a.ts")];
      }
      if (path === testDirectory) {
        return [fileEntry(`${testDirectory}/b.ts`, "b.ts")];
      }
      return [];
    });
    const { getWorkbench } = renderController({
      onWorkbenchRender: (workbench) => {
        renderHistory.push({
          entries: Object.fromEntries(
            Object.entries(workbench.entriesByDirectory).map(([path, entries]) => [
              path,
              entries.map((entry) => entry.name),
            ]),
          ),
          ownerId: workbench.workspaceIdentityDescriptor?.workspaceId ?? null,
        });
      },
      readDirectory,
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => requestedOwner),
        unregister: vi.fn(async () => undefined),
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(workspaceRoot);
      await getWorkbench().toggleDirectory(sourceDirectory);
    });
    requestedOwner = ownerB;
    await act(async () => {
      await getWorkbench().openWorkspaceRoot(workspaceRoot);
      await getWorkbench().toggleDirectory(testDirectory);
    });

    renderHistory = [];
    requestedOwner = ownerA;
    await act(async () => {
      await getWorkbench().openWorkspaceRoot(workspaceRoot);
    });

    expect(
      renderHistory.some(
        (snapshot) =>
          snapshot.ownerId === ownerB.workspaceId &&
          snapshot.entries[workspaceRoot]?.includes("src"),
      ),
    ).toBe(false);
    expect(
      renderHistory.some(
        (snapshot) =>
          snapshot.entries[sourceDirectory]?.includes("a.ts") &&
          snapshot.entries[testDirectory]?.includes("b.ts"),
      ),
    ).toBe(false);
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(ownerA);
    expect(getWorkbench().entriesByDirectory[workspaceRoot]).toEqual([
      directoryEntry(sourceDirectory, "src"),
    ]);
  });
});
