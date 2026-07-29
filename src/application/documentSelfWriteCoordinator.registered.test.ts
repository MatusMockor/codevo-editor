import { describe, expect, it } from "vitest";
import { createRegisteredDocumentSaveIdentity } from "./documentSaveIdentity";
import { DocumentSelfWriteCoordinator } from "./documentSelfWriteCoordinator";

const registeredOwnership = (
  workspaceId: string,
  canonicalRoot: string,
  workspaceRelativePath: string,
) => createRegisteredDocumentSaveIdentity(workspaceId, canonicalRoot, workspaceRelativePath)!;

describe("DocumentSelfWriteCoordinator registered ownership", () => {
  it("cancels a registered pending write by canonical root, not workspace id", async () => {
    const coordinator = new DocumentSelfWriteCoordinator();
    const ownership = registeredOwnership("workspace-a", "/workspace", "src/index.ts");
    const lease = coordinator.begin(ownership, "saved content");
    const pending = coordinator.waitForExpectations(ownership);

    coordinator.clearRoot("/workspace");
    lease?.complete(null);

    await expect(pending).resolves.toEqual([]);
    await expect(coordinator.waitForExpectations(ownership, { timeoutMs: 0 })).resolves.toEqual([]);
  });

  it("keeps a registered write for another canonical root pending", async () => {
    const coordinator = new DocumentSelfWriteCoordinator();
    const clearedOwnership = registeredOwnership("workspace-a", "/workspace-a", "src/index.ts");
    const retainedOwnership = registeredOwnership("workspace-a", "/workspace-b", "src/index.ts");
    const clearedLease = coordinator.begin(clearedOwnership, "cleared");
    const retainedLease = coordinator.begin(retainedOwnership, "retained");

    coordinator.clearRoot("/workspace-a");
    retainedLease?.complete(null);
    clearedLease?.complete(null);

    await expect(
      coordinator.waitForExpectations(clearedOwnership, { timeoutMs: 0 }),
    ).resolves.toEqual([]);
    await expect(coordinator.waitForExpectations(retainedOwnership)).resolves.toMatchObject([
      { content: "retained", revision: null },
    ]);
  });
});
