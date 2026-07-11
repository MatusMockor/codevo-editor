import { describe, expect, it } from "vitest";
import { parseConflictMarkers } from "./conflictMarkers";

describe("parseConflictMarkers", () => {
  it("parses a conflict without a base section and builds all replacements", () => {
    const text = [
      "before",
      "<<<<<<< current",
      "ours one",
      "ours two",
      "=======",
      "theirs",
      ">>>>>>> incoming",
      "after",
    ].join("\n");

    expect(parseConflictMarkers(text)).toEqual([
      {
        base: null,
        block: {
          endLineNumber: 7,
          endOffset: 73,
          startLineNumber: 2,
          startOffset: 7,
        },
        currentMarker: {
          endLineNumber: 2,
          endOffset: 23,
          startLineNumber: 2,
          startOffset: 7,
        },
        incomingMarker: {
          endLineNumber: 7,
          endOffset: 73,
          startLineNumber: 7,
          startOffset: 56,
        },
        ours: {
          endLineNumber: 4,
          endOffset: 41,
          startLineNumber: 3,
          startOffset: 23,
        },
        replacements: {
          both: "ours one\nours two\ntheirs\n",
          current: "ours one\nours two\n",
          incoming: "theirs\n",
        },
        separatorMarker: {
          endLineNumber: 5,
          endOffset: 49,
          startLineNumber: 5,
          startOffset: 41,
        },
        theirs: {
          endLineNumber: 6,
          endOffset: 56,
          startLineNumber: 6,
          startOffset: 49,
        },
      },
    ]);
  });

  it("parses a diff3 base section", () => {
    const text =
      "<<<<<<< ours\nours\n||||||| base\nancestor\n=======\ntheirs\n>>>>>>> theirs\n";
    const [block] = parseConflictMarkers(text);

    expect(block?.base).toEqual({
      endLineNumber: 4,
      endOffset: 40,
      startLineNumber: 4,
      startOffset: 31,
    });
    expect(block?.baseMarker).toEqual({
      endLineNumber: 3,
      endOffset: 31,
      startLineNumber: 3,
      startOffset: 18,
    });
    expect(block?.replacements).toEqual({
      both: "ours\ntheirs\n",
      current: "ours\n",
      incoming: "theirs\n",
    });
  });

  it("parses multiple blocks", () => {
    const text =
      "<<<<<<< a\none\n=======\ntwo\n>>>>>>> b\nmiddle\n<<<<<<< c\nthree\n=======\nfour\n>>>>>>> d\n";
    const blocks = parseConflictMarkers(text);

    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.replacements.both)).toEqual([
      "one\ntwo\n",
      "three\nfour\n",
    ]);
    expect(blocks.map((block) => block.block.startLineNumber)).toEqual([1, 7]);
  });

  it("ignores an unterminated block", () => {
    expect(parseConflictMarkers("<<<<<<< ours\nours\n=======\ntheirs\n")).toEqual(
      [],
    );
  });

  it("ignores marker-like lines with fewer or more than seven characters", () => {
    const texts = [
      "<<<<<< ours\ncurrent\n=======\nincoming\n>>>>>>> theirs\n",
      "<<<<<<<< ours\ncurrent\n=======\nincoming\n>>>>>>> theirs\n",
      "<<<<<<< ours\ncurrent\n======\nincoming\n>>>>>>> theirs\n",
      "<<<<<<< ours\ncurrent\n========\nincoming\n>>>>>>> theirs\n",
      "<<<<<<< ours\ncurrent\n=======\nincoming\n>>>>>> theirs\n",
      "<<<<<<< ours\ncurrent\n=======\nincoming\n>>>>>>>> theirs\n",
    ];

    texts.forEach((text) => expect(parseConflictMarkers(text)).toEqual([]));
  });

  it("recognizes line-anchored markers regardless of surrounding source syntax", () => {
    const text =
      "const value = `\n<<<<<<< ours\ncurrent\n=======\nincoming\n>>>>>>> theirs\n`;\n";

    expect(parseConflictMarkers(text)).toHaveLength(1);
  });

  it("preserves CRLF endings in ranges and replacements", () => {
    const text =
      "<<<<<<< ours\r\ncurrent\r\n=======\r\nincoming\r\n>>>>>>> theirs\r\n";
    const [block] = parseConflictMarkers(text);

    expect(block?.block).toEqual({
      endLineNumber: 5,
      endOffset: text.length,
      startLineNumber: 1,
      startOffset: 0,
    });
    expect(block?.replacements).toEqual({
      both: "current\r\nincoming\r\n",
      current: "current\r\n",
      incoming: "incoming\r\n",
    });
  });

  it("parses a block at EOF without a trailing newline", () => {
    const text =
      "<<<<<<< ours\ncurrent\n=======\nincoming\n>>>>>>> theirs";
    const [block] = parseConflictMarkers(text);

    expect(block?.block.endOffset).toBe(text.length);
    expect(block?.incomingMarker.endOffset).toBe(text.length);
    expect(block?.replacements.incoming).toBe("incoming\n");
  });
});
