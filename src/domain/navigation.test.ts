import { describe, expect, it } from "vitest";
import {
  createNavigationHistory,
  navigateBack,
  navigateForward,
  recordNavigationLocation,
} from "./navigation";

describe("navigation history", () => {
  it("records locations and clears forward history", () => {
    const first = location("/project/A.php", 1, 1);
    const second = location("/project/B.php", 2, 3);
    const history = {
      backStack: [first],
      forwardStack: [location("/project/C.php", 3, 1)],
    };

    expect(recordNavigationLocation(history, second)).toEqual({
      backStack: [first, second],
      forwardStack: [],
    });
  });

  it("does not record duplicate consecutive locations", () => {
    const first = location("/project/A.php", 1, 1);
    const history = recordNavigationLocation(createNavigationHistory(), first);

    expect(recordNavigationLocation(history, first)).toBe(history);
  });

  it("navigates back and forward", () => {
    const first = location("/project/A.php", 1, 1);
    const second = location("/project/B.php", 2, 3);
    const current = location("/project/C.php", 4, 5);
    const back = navigateBack(
      { backStack: [first, second], forwardStack: [] },
      current,
    );

    expect(back.target).toEqual(second);
    expect(back.history).toEqual({
      backStack: [first],
      forwardStack: [current],
    });

    const forward = navigateForward(back.history, second);

    expect(forward.target).toEqual(current);
    expect(forward.history).toEqual({
      backStack: [first, second],
      forwardStack: [],
    });
  });

  it("preserves the history owner through back and forward playback", () => {
    const first = location("/project/A.php", 1, 1);
    const current = location("/project/B.php", 2, 3);
    const ownerKey = "workspace-owner";
    const back = navigateBack(
      { backStack: [first], forwardStack: [], ownerKey },
      current,
    );

    expect(back.history.ownerKey).toBe(ownerKey);

    const forward = navigateForward(back.history, first);

    expect(forward.history.ownerKey).toBe(ownerKey);
  });
});

function location(path: string, lineNumber: number, column: number) {
  return {
    path,
    position: {
      column,
      lineNumber,
    },
  };
}
