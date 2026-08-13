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
      expected: "Codevo Editor",
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

  it("names the window after the workspace while agent mode is active", () => {
    expect(
      formatWindowTitle({
        activeFilePath: "/projects/myproject/src/index.ts",
        agentModeActive: true,
        isDirty: true,
        workspaceName: "/projects/myproject",
      }),
    ).toBe("Agents - myproject");
  });

  it("stays truthful in agent mode without a workspace", () => {
    expect(
      formatWindowTitle({
        activeFilePath: null,
        agentModeActive: true,
        isDirty: false,
        workspaceName: null,
      }),
    ).toBe("Agents");
  });

  it("restores the editor title when agent mode ends", () => {
    const input = {
      activeFilePath: "/projects/myproject/src/index.ts",
      isDirty: false,
      workspaceName: "/projects/myproject",
    };

    expect(formatWindowTitle({ ...input, agentModeActive: true })).toBe("Agents - myproject");
    expect(formatWindowTitle({ ...input, agentModeActive: false })).toBe("index.ts - myproject");
  });
});
