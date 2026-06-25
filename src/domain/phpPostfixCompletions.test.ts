import { describe, expect, it } from "vitest";

import {
  phpPostfixCompletionContextAt,
  phpPostfixCompletionItems,
} from "./phpPostfixCompletions";

function offsetToPosition(source: string, offset: number) {
  const before = source.slice(0, offset);
  const lineNumber = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: offset - lineStart + 1, lineNumber };
}

function contextAtEnd(source: string) {
  return phpPostfixCompletionContextAt(
    source,
    offsetToPosition(source, source.length),
  );
}

describe("phpPostfixCompletionContextAt", () => {
  it("detects a simple variable receiver with the if keyword", () => {
    const source = "<?php\n$user.if";
    const context = contextAtEnd(source);

    expect(context).not.toBeNull();
    expect(context?.receiverExpression).toBe("$user");
    expect(context?.keyword).toBe("if");
  });

  it("returns the replace range covering receiver and dot keyword", () => {
    const source = "<?php\n$user.if";
    const context = contextAtEnd(source);

    expect(context?.replaceRange).toEqual({
      end: source.length,
      start: source.indexOf("$user"),
    });
  });

  it("detects foreach for a variable receiver", () => {
    const source = "<?php\n$items.foreach";
    const context = contextAtEnd(source);

    expect(context?.receiverExpression).toBe("$items");
    expect(context?.keyword).toBe("foreach");
  });

  it("detects a chained method-call receiver", () => {
    const source = "<?php\n$a->b().if";
    const context = contextAtEnd(source);

    expect(context?.receiverExpression).toBe("$a->b()");
    expect(context?.keyword).toBe("if");
    expect(context?.replaceRange.start).toBe(source.indexOf("$a"));
  });

  it("detects an array-access receiver", () => {
    const source = "<?php\n$arr[0].var";
    const context = contextAtEnd(source);

    expect(context?.receiverExpression).toBe("$arr[0]");
    expect(context?.keyword).toBe("var");
    expect(context?.replaceRange.start).toBe(source.indexOf("$arr"));
  });

  it("detects a property receiver with notnull", () => {
    const source = "<?php\n$this->x.notnull";
    const context = contextAtEnd(source);

    expect(context?.receiverExpression).toBe("$this->x");
    expect(context?.keyword).toBe("notnull");
  });

  it("does not match PHP concatenation with surrounding spaces", () => {
    expect(contextAtEnd("<?php\n$a . $b")).toBeNull();
  });

  it("does not match concatenation when the word is not a keyword", () => {
    expect(contextAtEnd("<?php\n$a.$b")).toBeNull();
  });

  it("does not match an unknown trailing word", () => {
    expect(contextAtEnd("<?php\n$a.unknownword")).toBeNull();
  });

  it("does not match when there is a space before the dot", () => {
    expect(contextAtEnd("<?php\n$user .if")).toBeNull();
  });

  it("does not match when there is a space after the dot", () => {
    expect(contextAtEnd("<?php\n$user. if")).toBeNull();
  });

  it("does not leak a postfix match across a statement boundary string", () => {
    const source = "<?php\n$y = 'a.b'; $user.if";
    const context = contextAtEnd(source);

    expect(context?.receiverExpression).toBe("$user");
    expect(context?.keyword).toBe("if");
    expect(context?.replaceRange.start).toBe(source.lastIndexOf("$user"));
  });
});

describe("phpPostfixCompletionItems", () => {
  it("expands if into a guarded block snippet", () => {
    const items = phpPostfixCompletionItems("$user", "if");
    const item = items.find((candidate) => candidate.keyword === "if");

    expect(item?.insertText).toBe("if ($user) {\n\t$0\n}");
  });

  it("expands foreach with an item placeholder", () => {
    const items = phpPostfixCompletionItems("$items", "foreach");
    const item = items.find((candidate) => candidate.keyword === "foreach");

    expect(item?.insertText).toBe(
      "foreach ($items as $${1:item}) {\n\t$0\n}",
    );
  });

  it("expands notnull and the nn alias into the same template", () => {
    const notnull = phpPostfixCompletionItems("$x", "notnull").find(
      (candidate) => candidate.keyword === "notnull",
    );
    const nn = phpPostfixCompletionItems("$x", "nn").find(
      (candidate) => candidate.keyword === "nn",
    );

    expect(notnull?.insertText).toBe("if ($x !== null) {\n\t$0\n}");
    expect(nn?.insertText).toBe("if ($x !== null) {\n\t$0\n}");
  });

  it("expands isset", () => {
    const item = phpPostfixCompletionItems("$x", "isset").find(
      (candidate) => candidate.keyword === "isset",
    );

    expect(item?.insertText).toBe("if (isset($x)) {\n\t$0\n}");
  });

  it("expands var into an assignment to a new variable", () => {
    const item = phpPostfixCompletionItems("$x", "var").find(
      (candidate) => candidate.keyword === "var",
    );

    expect(item?.insertText).toBe("$${1:name} = $x;$0");
  });

  it("expands return", () => {
    const item = phpPostfixCompletionItems("$x", "return").find(
      (candidate) => candidate.keyword === "return",
    );

    expect(item?.insertText).toBe("return $x;");
  });

  it("expands the Laravel dd and dump helpers", () => {
    const dd = phpPostfixCompletionItems("$x", "dd").find(
      (candidate) => candidate.keyword === "dd",
    );
    const dump = phpPostfixCompletionItems("$x", "dump").find(
      (candidate) => candidate.keyword === "dump",
    );

    expect(dd?.insertText).toBe("dd($x);");
    expect(dump?.insertText).toBe("dump($x);");
  });

  it("returns a single item for the requested keyword", () => {
    const items = phpPostfixCompletionItems("$x", "if");

    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("if");
  });
});
