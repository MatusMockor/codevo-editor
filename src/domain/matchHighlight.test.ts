import { describe, expect, it } from "vitest";
import { splitQueryHighlight } from "./matchHighlight";

describe("splitQueryHighlight", () => {
  it("returns the whole text unmatched when the query is empty", () => {
    expect(splitQueryHighlight("User.php", "")).toEqual({
      before: "User.php",
      match: "",
      after: "",
    });
  });

  it("returns the whole text unmatched when the query is only whitespace", () => {
    expect(splitQueryHighlight("User.php", "   ")).toEqual({
      before: "User.php",
      match: "",
      after: "",
    });
  });

  it("splits out the first case-insensitive substring match", () => {
    expect(splitQueryHighlight("User.php", "user")).toEqual({
      before: "",
      match: "User",
      after: ".php",
    });
  });

  it("matches a substring in the middle of the text", () => {
    expect(splitQueryHighlight("src/Domain/User.php", "domain")).toEqual({
      before: "src/",
      match: "Domain",
      after: "/User.php",
    });
  });

  it("preserves the original casing of the matched slice", () => {
    expect(splitQueryHighlight("UserController", "usercontroller")).toEqual({
      before: "",
      match: "UserController",
      after: "",
    });
  });

  it("returns no match when the query is not found in the text", () => {
    expect(splitQueryHighlight("User.php", "post")).toEqual({
      before: "User.php",
      match: "",
      after: "",
    });
  });

  it("matches only the first occurrence when the query repeats", () => {
    expect(splitQueryHighlight("UserUser.php", "user")).toEqual({
      before: "",
      match: "User",
      after: "User.php",
    });
  });
});
