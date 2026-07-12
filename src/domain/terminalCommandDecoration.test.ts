import { describe, expect, it } from "vitest";
import { terminalCommandDecoration } from "./terminalCommandDecoration";

describe("terminalCommandDecoration", () => {
  it.each([
    [0, "var(--color-success)", "Exit code 0"],
    [1, "var(--color-error)", "Exit code 1"],
    [127, "var(--color-error)", "Exit code 127"],
  ])(
    "returns the exit-code presentation for %s",
    (exitCode, backgroundColor, tooltip) => {
      expect(terminalCommandDecoration(exitCode)).toEqual({
        backgroundColor,
        tooltip,
      });
    },
  );
});
