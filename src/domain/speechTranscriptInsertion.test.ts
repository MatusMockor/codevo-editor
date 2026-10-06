import { describe, expect, it } from "vitest";
import { insertSpeechTranscript } from "./speechTranscriptInsertion";

const insert = (text: string, start: number, end: number, transcript: string) =>
  insertSpeechTranscript({ text, selectionStart: start, selectionEnd: end, transcript });

describe("insertSpeechTranscript", () => {
  it("inserts into an empty draft without separators", () => {
    expect(insert("", 0, 0, "Ahoj svet")).toEqual({ text: "Ahoj svet", caret: 9 });
  });
  it("separates the transcript from a preceding word", () => {
    expect(insert("Fix the", 7, 7, "login bug")).toEqual({ text: "Fix the login bug", caret: 17 });
  });
  it("does not double a space that already precedes the caret", () => {
    expect(insert("Fix the ", 8, 8, "login bug")).toEqual({
      text: "Fix the login bug",
      caret: 17,
    });
  });
  it("does not add a leading space after a line break", () => {
    expect(insert("First line\n", 11, 11, "second")).toEqual({
      text: "First line\nsecond",
      caret: 17,
    });
  });
  it.each([",", ".", "!", "?", ";", ":", ")", "…"])(
    "attaches a transcript starting with %s to the preceding word",
    (mark) => {
      expect(insert("Hello", 5, 5, `${mark} world`).text).toBe(`Hello${mark} world`);
    },
  );
  it.each(["(", "[", "{", "„"])("does not add a space after the opening mark %s", (mark) => {
    expect(insert(`see ${mark}`, 5, 5, "this").text).toBe(`see ${mark}this`);
  });
  it("separates the transcript from the following word and keeps the caret after the text", () => {
    expect(insert("Fix bug", 4, 4, "the login")).toEqual({ text: "Fix the login bug", caret: 13 });
  });
  it("does not double a space that already follows the caret", () => {
    expect(insert("Fix  bug", 4, 4, "the")).toEqual({ text: "Fix the bug", caret: 7 });
  });
  it.each([".", ",", ")", "?"])("does not add a space before the following mark %s", (mark) => {
    expect(insert(`Run tests${mark}`, 9, 9, "now").text).toBe(`Run tests now${mark}`);
  });
  it("adds both separators in the middle of a word boundary", () => {
    expect(insert("ab", 1, 1, "x")).toEqual({ text: "a x b", caret: 3 });
  });
  it("replaces the selection", () => {
    expect(insert("Fix the old bug now", 8, 15, "login issue")).toEqual({
      text: "Fix the login issue now",
      caret: 19,
    });
  });
  it("treats a reversed selection as the same range", () => {
    expect(insert("Fix the old bug now", 15, 8, "login issue").text).toBe(
      "Fix the login issue now",
    );
  });
  it.each([
    [-5, -1, "new old", 3],
    [99, 120, "old new", 7],
    [Number.NaN, Number.NaN, "old new", 7],
  ])("clamps the out of range selection %d..%d", (start, end, text, caret) => {
    expect(insert("old", start, end, "new")).toEqual({ text, caret });
  });
  it("trims the transcript and ignores an empty one", () => {
    expect(insert("Hello", 5, 5, "  world \n")).toEqual({ text: "Hello world", caret: 11 });
    expect(insert("Hello", 2, 4, "   ")).toEqual({ text: "Hello", caret: 4 });
  });
  it("chains consecutive segments at the returned caret", () => {
    const first = insert("Start. End", 6, 6, "One");
    const second = insert(first.text, first.caret, first.caret, "two.");
    expect(first).toEqual({ text: "Start. One End", caret: 10 });
    expect(second).toEqual({ text: "Start. One two. End", caret: 15 });
  });
});
