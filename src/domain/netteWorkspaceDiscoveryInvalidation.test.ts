import { describe, expect, it } from "vitest";
import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";
import { workspaceFileChangeInvalidatesNetteServicesDiscovery } from "./netteWorkspaceDiscoveryInvalidation";

describe("workspaceFileChangeInvalidatesNetteServicesDiscovery", () => {
  it.each([
    "composer.json",
    "composer.lock",
    "config/services.neon",
    "app/extra.NEON",
    "app/HomePresenter.php",
    "app/Router/RouterFactory.php",
    "app/templates/Home/default.latte",
  ])("invalidates for %s", (relativePath) => {
    expect(workspaceFileChangeInvalidatesNetteServicesDiscovery(event({ relativePath }))).toBe(
      true,
    );
  });

  it("checks both sides of a rename and normalizes Windows paths", () => {
    expect(
      workspaceFileChangeInvalidatesNetteServicesDiscovery(
        event({
          kind: "renamed",
          previousRelativePath: "config\\services.neon",
          relativePath: "archive/services.txt",
        }),
      ),
    ).toBe(true);
  });

  it("invalidates config directory topology and full rescans", () => {
    expect(
      workspaceFileChangeInvalidatesNetteServicesDiscovery(
        event({ fileKind: "directory", kind: "created", relativePath: "config/packages" }),
      ),
    ).toBe(true);
    expect(
      workspaceFileChangeInvalidatesNetteServicesDiscovery(
        event({ fileKind: "directory", kind: "renamed", relativePath: "app/config/local" }),
      ),
    ).toBe(true);
    expect(
      workspaceFileChangeInvalidatesNetteServicesDiscovery(
        event({ fileKind: "directory", kind: "deleted", relativePath: "app/modules/shop" }),
      ),
    ).toBe(true);
    expect(
      workspaceFileChangeInvalidatesNetteServicesDiscovery(event({ kind: "rescanRequired" })),
    ).toBe(true);
  });

  it("ignores unrelated changes and ordinary directory modifications", () => {
    expect(
      workspaceFileChangeInvalidatesNetteServicesDiscovery(event({ relativePath: "src/App.php" })),
    ).toBe(false);
    expect(
      workspaceFileChangeInvalidatesNetteServicesDiscovery(
        event({ fileKind: "directory", kind: "modified", relativePath: "config" }),
      ),
    ).toBe(false);
  });
});

function event(overrides: Partial<WorkspaceFileChangeEvent> = {}): WorkspaceFileChangeEvent {
  return {
    kind: "modified",
    path: "/workspace/config/services.neon",
    relativePath: "config/services.neon",
    rootPath: "/workspace",
    ...overrides,
  };
}
