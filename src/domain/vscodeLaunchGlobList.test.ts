import { describe, expect, it } from "vitest";
import {
  parseVscodeLaunchGlobList,
  VSCODE_LAUNCH_GLOB_LIST_MAX_ELEMENTS,
  VSCODE_LAUNCH_GLOB_MAX_BYTES,
} from "./vscodeLaunchGlobList";

describe("VS Code launch glob list", () => {
  it("preserves an empty list distinctly from an absent list", () => {
    expect(parseVscodeLaunchGlobList(undefined, "outFiles")).toEqual({
      kind: "ok",
      value: undefined,
    });
    const parsed = parseVscodeLaunchGlobList([], "outFiles");
    expect(parsed).toEqual({ kind: "ok", value: [] });
    if (parsed.kind === "error" || parsed.value === undefined) return;
    expect(Object.isFrozen(parsed.value)).toBe(true);
  });

  it("accepts negated glob strings", () => {
    expect(
      parseVscodeLaunchGlobList(
        ["${workspaceFolder}/**", "!**/node_modules/**"],
        "resolveSourceMapLocations",
      ),
    ).toEqual({
      kind: "ok",
      value: ["${workspaceFolder}/**", "!**/node_modules/**"],
    });
  });

  it("accepts exactly the element and UTF-8 byte limits", () => {
    const glob = "é".repeat(VSCODE_LAUNCH_GLOB_MAX_BYTES / 2);
    const parsed = parseVscodeLaunchGlobList(
      Array.from({ length: VSCODE_LAUNCH_GLOB_LIST_MAX_ELEMENTS }, () => glob),
      "outFiles",
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      value: expect.arrayContaining([glob]),
    });
  });

  it("freezes a non-empty owned copy", () => {
    const input = ["dist/**/*.js"];
    const parsed = parseVscodeLaunchGlobList(input, "outFiles");
    expect(parsed).toEqual({ kind: "ok", value: ["dist/**/*.js"] });
    if (parsed.kind === "error" || parsed.value === undefined) return;

    expect(Object.isFrozen(parsed.value)).toBe(true);
    input[0] = "other/**/*.js";
    input.push("extra/**/*.js");
    expect(parsed.value).toEqual(["dist/**/*.js"]);
  });

  it("rejects sparse arrays", () => {
    expect(parseVscodeLaunchGlobList(Array(2), "outFiles")).toMatchObject({
      kind: "error",
    });
  });

  it.each([
    ["an environment variable", ["${env:BUILD}/**/*.js"]],
    ["a command variable", ["!${command:build}/**/*.js"]],
    ["a variable after the workspace prefix", ["${workspaceFolder}/${env:BUILD}/**/*.js"]],
    ["a variable after a negated workspace prefix", ["!${workspaceFolder}/${config:outDir}/**"]],
  ])("rejects %s", (_case, value) => {
    expect(parseVscodeLaunchGlobList(value, "outFiles")).toMatchObject({
      kind: "error",
    });
  });

  it.each(["dist/\u0001*.js", "dist/\u202e*.js", "dist/\u2066*.js", "dist/\0*.js"])(
    "rejects control and bidirectional formatting characters in %j",
    (value) => {
      expect(parseVscodeLaunchGlobList([value], "outFiles")).toMatchObject({
        kind: "error",
      });
    },
  );

  it.each([
    ["a non-array", "dist/**/*.js"],
    ["a non-string element", ["dist/**/*.js", 1]],
  ])("rejects %s", (_case, value) => {
    expect(parseVscodeLaunchGlobList(value, "outFiles")).toEqual({
      kind: "error",
      message: `outFiles must be an array of at most ${VSCODE_LAUNCH_GLOB_LIST_MAX_ELEMENTS} display-safe glob strings of at most ${VSCODE_LAUNCH_GLOB_MAX_BYTES} UTF-8 bytes each with no dynamic substitutions after an optional leading \${workspaceFolder}.`,
    });
  });

  it("rejects an element count over the cap", () => {
    expect(
      parseVscodeLaunchGlobList(
        Array.from({ length: VSCODE_LAUNCH_GLOB_LIST_MAX_ELEMENTS + 1 }, () => "**/*.js"),
        "outFiles",
      ),
    ).toMatchObject({ kind: "error" });
  });

  it("rejects a UTF-8 byte length over the cap", () => {
    expect(
      parseVscodeLaunchGlobList(
        ["é".repeat(VSCODE_LAUNCH_GLOB_MAX_BYTES / 2 + 1)],
        "resolveSourceMapLocations",
      ),
    ).toMatchObject({ kind: "error" });
  });
});
