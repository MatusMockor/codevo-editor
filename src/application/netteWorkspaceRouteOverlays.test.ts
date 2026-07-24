import { describe, expect, it } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { dirtyNetteWorkspaceRouteOverlays } from "./netteWorkspaceRouteOverlays";

describe("dirtyNetteWorkspaceRouteOverlays", () => {
  it("keeps only dirty PHP documents inside the active root", () => {
    expect(
      dirtyNetteWorkspaceRouteOverlays(
        [
          document("/workspace/app/Router/RouterFactory.php", "dirty", "saved"),
          document("/workspace/app/clean.php", "same", "same"),
          document("/workspace/config/routes.neon", "dirty", "saved"),
          document("/other/app/Router.php", "dirty", "saved"),
        ],
        "/workspace",
      ),
    ).toEqual([{ path: "/workspace/app/Router/RouterFactory.php", source: "dirty" }]);
  });
});

function document(path: string, content: string, savedContent: string): EditorDocument {
  return { content, language: "php", name: path.split("/").pop() ?? path, path, savedContent };
}
