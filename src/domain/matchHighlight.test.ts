import { describe, expect, it } from "vitest";
import { splitQueryHighlight } from "./matchHighlight";

describe("splitQueryHighlight", () => {
  it.each([
    [
      "contiguous",
      "User.php",
      "user",
      [
        { text: "User", highlighted: true },
        { text: ".php", highlighted: false },
      ],
    ],
    [
      "camel subsequence",
      "UserController.php",
      "uc",
      [
        { text: "U", highlighted: true },
        { text: "ser", highlighted: false },
        { text: "C", highlighted: true },
        { text: "ontroller.php", highlighted: false },
      ],
    ],
    [
      "multi-token",
      "src/Http/Controllers/UserController.php",
      "user controller",
      [
        { text: "src/Http/Controllers/", highlighted: false },
        { text: "UserController", highlighted: true },
        { text: ".php", highlighted: false },
      ],
    ],
    [
      "reversed multi-token",
      "app/Models/User.php",
      "user model",
      [
        { text: "app/", highlighted: false },
        { text: "Model", highlighted: true },
        { text: "s/", highlighted: false },
        { text: "User", highlighted: true },
        { text: ".php", highlighted: false },
      ],
    ],
  ])("highlights a %s match", (_label, text, query, expected) => {
    expect(splitQueryHighlight(text, query)).toEqual(expected);
  });

  it.each([
    ["empty query", "User.php", ""],
    ["whitespace query", "User.php", "   "],
    ["missing subsequence", "User.php", "post"],
    ["literal extension wildcard", "User.php", "*.php"],
  ])("returns no segments for %s", (_label, text, query) => {
    expect(splitQueryHighlight(text, query)).toEqual([]);
  });
});
