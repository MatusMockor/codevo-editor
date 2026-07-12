import { describe, expect, it } from "vitest";
import { formatWindowTitle } from "./windowTitle";

describe("formatWindowTitle", () => {
  it.each([
    {
      input: {
        activeFilePath: "/projects/myproject/src/index.ts",
        isDirty: true,
        workspaceName: "/projects/myproject",
      },
      expected: "• index.ts - myproject",
    },
    {
      input: {
        activeFilePath: "/projects/myproject/src/index.ts",
        isDirty: false,
        workspaceName: "/projects/myproject",
      },
      expected: "index.ts - myproject",
    },
    {
      input: {
        activeFilePath: null,
        isDirty: false,
        workspaceName: "/projects/myproject",
      },
      expected: "myproject",
    },
    {
      input: {
        activeFilePath: "/projects/myproject/src/index.ts",
        isDirty: false,
        workspaceName: null,
      },
      expected: "Mockor Editor",
    },
    {
      input: {
        activeFilePath: "/projects/myproject/src/index.ts",
        isDirty: false,
        workspaceName: "/projects/myproject/",
      },
      expected: "index.ts - myproject",
    },
    {
      input: {
        activeFilePath: "C:\\projects\\myproject\\src\\index.ts",
        isDirty: false,
        workspaceName: "C:\\projects\\myproject\\",
      },
      expected: "index.ts - myproject",
    },
    {
      input: {
        activeFilePath: "/index.ts",
        isDirty: false,
        workspaceName: "/projects/myproject",
      },
      expected: "index.ts - myproject",
    },
  ])("formats $expected", ({ input, expected }) => {
    expect(formatWindowTitle(input)).toBe(expected);
  });
});
