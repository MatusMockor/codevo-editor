import { describe, expect, it } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { dirtyNetteWorkspacePresenterOverlays } from "./netteWorkspacePresenterOverlays";

describe("dirtyNetteWorkspacePresenterOverlays", () => {
  it("keeps dirty presenters and Latte templates inside the active root", () => {
    expect(
      dirtyNetteWorkspacePresenterOverlays(
        [
          document("/workspace/app/HomePresenter.php", "changed", "saved"),
          document("/workspace/app/templates/Home/default.latte", "dirty", "saved"),
          document("/workspace/app/Service.php", "changed", "saved"),
          document("/other/app/OtherPresenter.php", "changed", "saved"),
        ],
        "/workspace",
      ),
    ).toEqual([
      { path: "/workspace/app/HomePresenter.php", source: "changed" },
      { path: "/workspace/app/templates/Home/default.latte", source: "dirty" },
    ]);
  });
});

function document(path: string, content: string, savedContent: string): EditorDocument {
  return { content, language: "php", name: path.split("/").pop() ?? path, path, savedContent };
}
