import { describe, expect, it } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { dirtyNetteWorkspaceServiceOverlays } from "./netteWorkspaceServiceOverlays";

describe("dirtyNetteWorkspaceServiceOverlays", () => {
  it("keeps only dirty NEON documents inside the active root", () => {
    expect(
      dirtyNetteWorkspaceServiceOverlays(
        [
          document("/workspace/config/services.neon", "services:\n  app: App\\Service", ""),
          document("/workspace/config/clean.neon", "parameters: []"),
          document("/workspace/src/App.php", "<?php", ""),
          document("/other/config/services.neon", "services: []", ""),
        ],
        "/workspace",
      ),
    ).toEqual([
      {
        path: "/workspace/config/services.neon",
        source: "services:\n  app: App\\Service",
      },
    ]);
  });

  it("returns no overlays without a workspace", () => {
    expect(dirtyNetteWorkspaceServiceOverlays([document("/a.neon", "changed", "")], null)).toEqual(
      [],
    );
  });
});

function document(path: string, content: string, savedContent = content): EditorDocument {
  return {
    content,
    language: "neon",
    name: path.split("/").pop() ?? path,
    path,
    savedContent,
  };
}
