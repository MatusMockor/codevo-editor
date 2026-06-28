import { describe, expect, it, vi } from "vitest";
import { TauriLocalHistoryGateway } from "./tauriLocalHistoryGateway";

describe("TauriLocalHistoryGateway", () => {
  it("records a snapshot via the Tauri command", async () => {
    const version = { id: "000000000001", sizeBytes: 4, timestampMs: 1700000000000 };
    const invoke = vi.fn(async () => version);
    const gateway = new TauriLocalHistoryGateway(invoke, () => true);

    const stored = await gateway.recordSnapshot(
      "/workspace",
      "src/User.php",
      "data",
    );

    expect(invoke).toHaveBeenCalledWith("record_local_history_snapshot", {
      content: "data",
      relativePath: "src/User.php",
      rootPath: "/workspace",
    });
    expect(stored).toEqual(version);
  });

  it("returns null when a snapshot is deduped (command returns null)", async () => {
    const invoke = vi.fn(async () => null);
    const gateway = new TauriLocalHistoryGateway(invoke, () => true);

    const stored = await gateway.recordSnapshot(
      "/workspace",
      "src/User.php",
      "data",
    );

    expect(stored).toBeNull();
  });

  it("lists versions newest-first via the Tauri command", async () => {
    const versions = [
      { id: "000000000002", sizeBytes: 8, timestampMs: 1700100000000 },
      { id: "000000000001", sizeBytes: 4, timestampMs: 1700000000000 },
    ];
    const invoke = vi.fn(async () => versions);
    const gateway = new TauriLocalHistoryGateway(invoke, () => true);

    const result = await gateway.listVersions("/workspace", "src/User.php");

    expect(invoke).toHaveBeenCalledWith("get_local_history_versions", {
      relativePath: "src/User.php",
      rootPath: "/workspace",
    });
    expect(result).toEqual(versions);
  });

  it("reads a version's content via the Tauri command", async () => {
    const invoke = vi.fn(async () => "<?php previous");
    const gateway = new TauriLocalHistoryGateway(invoke, () => true);

    const content = await gateway.readVersion(
      "/workspace",
      "src/User.php",
      "000000000001",
    );

    expect(invoke).toHaveBeenCalledWith("get_local_history_version_content", {
      relativePath: "src/User.php",
      rootPath: "/workspace",
      versionId: "000000000001",
    });
    expect(content).toBe("<?php previous");
  });

  it("is inert outside Tauri", async () => {
    const invoke = vi.fn();
    const gateway = new TauriLocalHistoryGateway(invoke, () => false);

    await expect(
      gateway.recordSnapshot("/workspace", "src/User.php", "data"),
    ).resolves.toBeNull();
    await expect(
      gateway.listVersions("/workspace", "src/User.php"),
    ).resolves.toEqual([]);
    await expect(
      gateway.readVersion("/workspace", "src/User.php", "000000000001"),
    ).resolves.toBe("");
    expect(invoke).not.toHaveBeenCalled();
  });
});
