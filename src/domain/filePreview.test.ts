import { describe, expect, it } from "vitest";
import {
  FILE_PREVIEW_MAX_BYTES,
  FilePreviewContractError,
  parseFilePreviewPayload,
  parseFilePreviewRequest,
} from "./filePreview";

describe("parseFilePreviewRequest", () => {
  it("accepts an absolute root and a normalized relative path", () => {
    expect(parseFilePreviewRequest("/work/app", "src/main.ts")).toEqual({
      workspaceRoot: "/work/app",
      relativePath: "src/main.ts",
    });
  });

  it.each([
    ["relative/root", "a.ts"],
    ["", "a.ts"],
    ["/root\0", "a.ts"],
    ["/root", ""],
    ["/root", "/abs.ts"],
    ["/root", "../a.ts"],
    ["/root", "a/./b.ts"],
    ["/root", "a//b.ts"],
    ["/root", "a/"],
    ["/root", "a\0b"],
    [`/${"r".repeat(4_096)}`, "a.ts"],
    ["/root", "é".repeat(2_049)],
    [42, "a.ts"],
    ["/root", null],
  ])("rejects root %j with path %j", (root, path) => {
    expect(() => parseFilePreviewRequest(root, path)).toThrow(FilePreviewContractError);
  });
});

describe("parseFilePreviewPayload", () => {
  it("parses a whole text file", () => {
    expect(
      parseFilePreviewPayload(
        {
          kind: "text",
          relativePath: "a.ts",
          contents: "é\n",
          byteLength: 3,
          truncated: false,
        },
        "a.ts",
      ),
    ).toEqual({
      kind: "text",
      relativePath: "a.ts",
      contents: "é\n",
      byteLength: 3,
      truncated: false,
    });
  });

  it("parses a truncated text preview cut on a char boundary", () => {
    const contents = "a".repeat(FILE_PREVIEW_MAX_BYTES - 1);
    expect(
      parseFilePreviewPayload(
        { kind: "text", relativePath: "big.log", contents, byteLength: 5_000_000, truncated: true },
        "big.log",
      ),
    ).toMatchObject({ kind: "text", byteLength: 5_000_000, truncated: true });
  });

  it("parses a binary preview", () => {
    expect(
      parseFilePreviewPayload({ kind: "binary", relativePath: "a.png", byteLength: 12 }, "a.png"),
    ).toEqual({ kind: "binary", relativePath: "a.png", byteLength: 12 });
  });

  const text = {
    kind: "text",
    relativePath: "a.ts",
    contents: "abc",
    byteLength: 3,
    truncated: false,
  };

  it.each([
    ["null", null],
    ["array", []],
    ["string", "text"],
    ["unknown kind", { kind: "image", relativePath: "a.ts", byteLength: 3 }],
    ["missing kind", { relativePath: "a.ts", byteLength: 3 }],
    ["foreign path", { ...text, relativePath: "b.ts" }],
    ["extra text field", { ...text, encoding: "utf8" }],
    ["extra binary field", { kind: "binary", relativePath: "a.ts", byteLength: 3, contents: "" }],
    ["missing contents", { kind: "text", relativePath: "a.ts", byteLength: 3, truncated: false }],
    ["non-string contents", { ...text, contents: 3 }],
    ["non-boolean truncated", { ...text, truncated: "no" }],
    ["negative length", { kind: "binary", relativePath: "a.ts", byteLength: -1 }],
    ["fractional length", { kind: "binary", relativePath: "a.ts", byteLength: 1.5 }],
    ["unsafe length", { kind: "binary", relativePath: "a.ts", byteLength: 2 ** 53 }],
    ["string length", { kind: "binary", relativePath: "a.ts", byteLength: "3" }],
    ["length mismatch", { ...text, byteLength: 4 }],
    ["truncated small file", { ...text, truncated: true }],
    [
      "truncated preview far below the limit",
      { ...text, byteLength: FILE_PREVIEW_MAX_BYTES + 10, truncated: true },
    ],
    [
      "contents over the limit",
      {
        ...text,
        contents: "a".repeat(FILE_PREVIEW_MAX_BYTES + 1),
        byteLength: FILE_PREVIEW_MAX_BYTES + 1,
      },
    ],
    [
      "multibyte contents over the limit",
      {
        ...text,
        contents: "é".repeat(FILE_PREVIEW_MAX_BYTES / 2 + 1),
        byteLength: FILE_PREVIEW_MAX_BYTES * 2,
        truncated: true,
      },
    ],
  ])("rejects %s", (_label, payload) => {
    expect(() => parseFilePreviewPayload(payload, "a.ts")).toThrow(FilePreviewContractError);
  });
});
