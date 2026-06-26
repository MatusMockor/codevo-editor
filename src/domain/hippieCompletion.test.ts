import { describe, expect, it } from "vitest";
import {
  advanceHippieSession,
  hippieCandidates,
  startHippieSession,
} from "./hippieCompletion";

describe("hippieCandidates", () => {
  it("collects unique words that start with the prefix", () => {
    const text = "const counter = count + counter;";
    // cursor sits right after the bare "count" token near the end.
    const cursorOffset = "const counter = count".length;

    expect(hippieCandidates(text, "count", cursorOffset)).toEqual([
      "counter",
    ]);
  });

  it("orders the nearest match before farther ones (backward search first)", () => {
    const text = "valueAlpha\nvalueBeta\nval\nvalueGamma";
    // cursor right after the bare prefix "val" on line 3.
    const cursorOffset = "valueAlpha\nvalueBeta\nval".length;

    // Backward from the caret: valueBeta (closest), then valueAlpha; then
    // forward: valueGamma.
    expect(hippieCandidates(text, "val", cursorOffset)).toEqual([
      "valueBeta",
      "valueAlpha",
      "valueGamma",
    ]);
  });

  it("excludes the prefix token under the caret but keeps later identical-prefix words", () => {
    const text = "name nameField name nameValue";
    const cursorOffset = "name nameField name".length;

    // The "name" token directly under the caret is excluded; the leading "name"
    // is also exactly the prefix and excluded; only the longer words remain.
    expect(hippieCandidates(text, "name", cursorOffset)).toEqual([
      "nameField",
      "nameValue",
    ]);
  });

  it("is case-sensitive", () => {
    const text = "Counter counter COUNTER cou";
    const cursorOffset = text.length;

    expect(hippieCandidates(text, "cou", cursorOffset)).toEqual(["counter"]);
  });

  it("treats $ and _ and digits as word characters (PHP/JS identifiers)", () => {
    const text = "$user_id $user_name $u";
    const cursorOffset = text.length;

    expect(hippieCandidates(text, "$u", cursorOffset)).toEqual([
      "$user_name",
      "$user_id",
    ]);
  });

  it("returns no candidates for an empty prefix", () => {
    const text = "alpha beta gamma";

    expect(hippieCandidates(text, "", 0)).toEqual([]);
  });

  it("returns no candidates when nothing matches", () => {
    const text = "alpha beta gamma";

    expect(hippieCandidates(text, "zz", text.length)).toEqual([]);
  });

  it("dedupes repeated matches keeping the nearest occurrence", () => {
    const text = "fooBar baz fooBaz fooBar fo";
    const cursorOffset = text.length;

    // Backward order from caret: fooBar (nearest), fooBaz; the second fooBar is
    // a duplicate and dropped.
    expect(hippieCandidates(text, "fo", cursorOffset)).toEqual([
      "fooBar",
      "fooBaz",
    ]);
  });
});

describe("startHippieSession", () => {
  it("expands the prefix to the first (nearest) candidate", () => {
    const text = "calculateTotal\ncalc";
    const cursorOffset = text.length;

    const session = startHippieSession(text, "calc", cursorOffset);

    expect(session).not.toBeNull();
    expect(session?.prefix).toBe("calc");
    expect(session?.anchorOffset).toBe(cursorOffset - "calc".length);
    expect(session?.candidates).toEqual(["calculateTotal"]);
    expect(session?.index).toBe(0);
    expect(session?.word).toBe("calculateTotal");
  });

  it("returns null when there are no candidates (no-op)", () => {
    const text = "alpha beta gamma";

    expect(startHippieSession(text, "zz", text.length)).toBeNull();
    expect(startHippieSession(text, "", 0)).toBeNull();
  });
});

describe("advanceHippieSession", () => {
  it("cycles to the next candidate on repeated expansion", () => {
    const text = "fooOne\nfooTwo\nfooThree\nfoo";
    const cursorOffset = text.length;
    const session = startHippieSession(text, "foo", cursorOffset);

    expect(session?.word).toBe("fooThree");

    const second = advanceHippieSession(session!);
    expect(second.index).toBe(1);
    expect(second.word).toBe("fooTwo");

    const third = advanceHippieSession(second);
    expect(third.index).toBe(2);
    expect(third.word).toBe("fooOne");
  });

  it("wraps back to the original prefix after the last candidate", () => {
    const text = "fooOne\nfooTwo\nfoo";
    const cursorOffset = text.length;
    const session = startHippieSession(text, "foo", cursorOffset);

    expect(session?.word).toBe("fooTwo");
    const second = advanceHippieSession(session!);
    expect(second.word).toBe("fooOne");

    // After the last candidate, wrap to the original typed prefix.
    const wrapped = advanceHippieSession(second);
    expect(wrapped.index).toBe(-1);
    expect(wrapped.word).toBe("foo");

    // Then cycle forward again to the first candidate.
    const restarted = advanceHippieSession(wrapped);
    expect(restarted.index).toBe(0);
    expect(restarted.word).toBe("fooTwo");
  });

  it("keeps the same anchor, prefix, and candidate list while cycling", () => {
    const text = "fooOne\nfooTwo\nfoo";
    const session = startHippieSession(text, "foo", text.length)!;
    const next = advanceHippieSession(session);

    expect(next.anchorOffset).toBe(session.anchorOffset);
    expect(next.prefix).toBe(session.prefix);
    expect(next.candidates).toEqual(session.candidates);
  });
});
