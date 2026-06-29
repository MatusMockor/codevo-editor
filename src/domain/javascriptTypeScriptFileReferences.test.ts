import { describe, expect, it } from "vitest";
import {
  filterFileReferenceLocationsToWorkspace,
  findAllFileReferencesCommand,
} from "./javascriptTypeScriptFileReferences";

describe("javascriptTypeScriptFileReferences", () => {
  it("builds the tsserver file references command payload", () => {
    expect(findAllFileReferencesCommand("/workspace/src/User Service.ts")).toEqual({
      arguments: ["file:///workspace/src/User%20Service.ts"],
      command: "_typescript.findAllFileReferences",
      title: "Find File References",
    });
  });

  it("filters file reference locations to the active workspace root", () => {
    const inside = {
      uri: "file:///workspace/src/userService.ts",
      range: range(1, 2, 1, 13),
    };
    const siblingPrefix = {
      uri: "file:///workspace-other/src/userService.ts",
      range: range(2, 2, 2, 13),
    };
    const outside = {
      uri: "file:///other/src/userService.ts",
      range: range(3, 2, 3, 13),
    };
    const nonFile = {
      uri: "untitled:User.ts",
      range: range(4, 2, 4, 13),
    };

    expect(
      filterFileReferenceLocationsToWorkspace(
        [inside, siblingPrefix, outside, nonFile],
        "/workspace",
      ),
    ).toEqual([inside]);
  });
});

function range(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
) {
  return {
    end: { character: endCharacter, line: endLine },
    start: { character: startCharacter, line: startLine },
  };
}
