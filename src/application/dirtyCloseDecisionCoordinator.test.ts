import { describe, expect, it, vi } from "vitest";
import { DirtyCloseDecisionCoordinator } from "./dirtyCloseDecisionCoordinator";

describe("DirtyCloseDecisionCoordinator", () => {
  it("publishes a request and resolves it with a typed decision", async () => {
    const coordinator = new DirtyCloseDecisionCoordinator();
    const listener = vi.fn();
    coordinator.subscribe(listener);

    const decision = coordinator.decideDirtyClose({
      scope: "tab",
      documentNames: ["notes.ts"],
    });

    expect(coordinator.getSnapshot()).toEqual({
      scope: "tab",
      documentNames: ["notes.ts"],
    });
    expect(listener).toHaveBeenCalledTimes(1);

    const request = coordinator.getSnapshot();
    if (!request) {
      throw new Error("Expected an active dirty-close request");
    }

    coordinator.resolveActive(request, "save");

    await expect(decision).resolves.toBe("save");
    expect(coordinator.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent decisions and snapshots mutable input", async () => {
    const coordinator = new DirtyCloseDecisionCoordinator();
    const documentNames = ["first.ts"];
    const first = coordinator.decideDirtyClose({
      scope: "group",
      documentNames,
    });
    const second = coordinator.decideDirtyClose({
      scope: "workspace",
      documentNames: ["second.ts", "third.ts"],
    });
    documentNames.push("changed-after-request.ts");

    expect(coordinator.getSnapshot()?.documentNames).toEqual(["first.ts"]);

    const firstRequest = coordinator.getSnapshot();
    if (!firstRequest) {
      throw new Error("Expected the first dirty-close request");
    }

    coordinator.resolveActive(firstRequest, "discard");
    await expect(first).resolves.toBe("discard");
    expect(coordinator.getSnapshot()).toEqual({
      scope: "workspace",
      documentNames: ["second.ts", "third.ts"],
    });

    const secondRequest = coordinator.getSnapshot();
    if (!secondRequest) {
      throw new Error("Expected the second dirty-close request");
    }

    coordinator.resolveActive(secondRequest, "cancel");
    await expect(second).resolves.toBe("cancel");
  });

  it("snapshots stable workspace document descriptors for queued prompts", async () => {
    const coordinator = new DirtyCloseDecisionCoordinator();
    const documents = [{
      id: "workspace-a:config",
      name: "config.php",
      relativePath: "config/config.php",
      workspaceLabel: "api",
    }];
    const decision = coordinator.decideDirtyClose({
      scope: "quit",
      documentNames: ["config.php"],
      documents,
    });

    documents[0].workspaceLabel = "mutated";

    expect(coordinator.getSnapshot()?.documents).toEqual([{
      id: "workspace-a:config",
      name: "config.php",
      relativePath: "config/config.php",
      workspaceLabel: "api",
    }]);
    const request = coordinator.getSnapshot();
    if (!request) {
      throw new Error("Expected an active request");
    }
    coordinator.resolveActive(request, "cancel");
    await decision;
  });

  it("ignores duplicate stale decisions while a queued request is active", async () => {
    const coordinator = new DirtyCloseDecisionCoordinator();
    const first = coordinator.decideDirtyClose({
      scope: "tab",
      documentNames: ["first.ts"],
    });
    const firstRequest = coordinator.getSnapshot();
    const second = coordinator.decideDirtyClose({
      scope: "tab",
      documentNames: ["second.ts"],
    });
    if (!firstRequest) {
      throw new Error("Expected the first dirty-close request");
    }

    coordinator.resolveActive(firstRequest, "save");
    await expect(first).resolves.toBe("save");
    const secondRequest = coordinator.getSnapshot();

    coordinator.resolveActive(firstRequest, "discard");

    expect(coordinator.getSnapshot()).toBe(secondRequest);
    if (!secondRequest) {
      throw new Error("Expected the queued dirty-close request");
    }

    coordinator.resolveActive(secondRequest, "cancel");
    await expect(second).resolves.toBe("cancel");
  });

  it("cancels active and queued requests when the host is disposed", async () => {
    const coordinator = new DirtyCloseDecisionCoordinator();
    const first = coordinator.decideDirtyClose({
      scope: "quit",
      documentNames: ["first.ts"],
    });
    const second = coordinator.decideDirtyClose({
      scope: "tab",
      documentNames: ["second.ts"],
    });

    coordinator.cancelAll();

    await expect(first).resolves.toBe("cancel");
    await expect(second).resolves.toBe("cancel");
    expect(coordinator.getSnapshot()).toBeNull();
  });
});
