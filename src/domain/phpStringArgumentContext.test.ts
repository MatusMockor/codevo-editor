import { describe, expect, it } from "vitest";
import {
  phpStringArrayArgumentElementContextAt,
  phpStringArgumentContextAt,
  phpStringAttributeArgumentContextAt,
} from "./phpStringArgumentContext";

describe("phpStringArgumentContext", () => {
  it("detects direct PHP string arguments", () => {
    const source = `<?php\n\nLog::channel('slack');\n`;

    expect(
      phpStringArgumentContextAt(source, positionAfter(source, "slack")),
    ).toMatchObject({
      argumentIndex: 0,
      argumentName: null,
      prefix: "slack",
      value: "slack",
    });
  });

  it("keeps direct string arguments separate from array elements", () => {
    const source = `<?php\n\nLog::stack(['single']);\n`;

    expect(
      phpStringArgumentContextAt(source, positionAfter(source, "single")),
    ).toBeNull();
  });

  it("detects top-level string elements inside array arguments", () => {
    const source = `<?php\n\nLog::stack(['single', 'slack']);\n`;

    expect(
      phpStringArrayArgumentElementContextAt(
        source,
        positionAfter(source, "single"),
      ),
    ).toMatchObject({
      argumentIndex: 0,
      argumentName: null,
      arrayElementIndex: 0,
      prefix: "single",
      value: "single",
    });
    expect(
      phpStringArrayArgumentElementContextAt(
        source,
        positionAfter(source, "slack"),
      ),
    ).toMatchObject({
      argumentIndex: 0,
      argumentName: null,
      arrayElementIndex: 1,
      prefix: "slack",
      value: "slack",
    });
  });

  it("detects named array arguments", () => {
    const source = `<?php\n\nLog::stack(channels: ['single']);\n`;

    expect(
      phpStringArrayArgumentElementContextAt(
        source,
        positionAfter(source, "single"),
      ),
    ).toMatchObject({
      argumentIndex: 0,
      argumentName: "channels",
      arrayElementIndex: 0,
      prefix: "single",
      value: "single",
    });
  });

  it("detects string arguments inside PHP attribute constructors", () => {
    const source = `<?php

use Illuminate\\Container\\Attributes\\Auth;

#[Example, Auth(guard: 'admin')]
class Controller {}
`;

    expect(
      phpStringAttributeArgumentContextAt(source, positionAfter(source, "admin"), [
        "Auth",
      ]),
    ).toMatchObject({
      argumentIndex: 0,
      argumentName: "guard",
      attributeName: "Auth",
      attributeShortName: "Auth",
      prefix: "admin",
      value: "admin",
    });
  });

  it("matches qualified PHP attribute names and ignores nested calls", () => {
    const qualified = `<?php

#[\\Illuminate\\Container\\Attributes\\Auth('web')]
class Controller {}
`;
    const directCall = `<?php\n\nAuth('web');\n`;
    const newCall = `<?php\n\nnew Auth('web');\n`;
    const nestedExpression = `<?php

#[Example(Auth('web'))]
class Controller {}
`;
    const comment = `<?php\n\n// #[Auth('web')]\n`;
    const blockComment = `<?php\n\n/* #[Auth('web')] */\n`;
    const hashComment = `<?php\n\n# #[Auth('web')]\n`;
    const newAttributeExpression = `<?php

#[new Auth('web')]
class Controller {}
`;

    expect(
      phpStringAttributeArgumentContextAt(
        qualified,
        positionAfter(qualified, "web"),
        ["Auth"],
      ),
    ).toMatchObject({
      attributeName: "\\Illuminate\\Container\\Attributes\\Auth",
      attributeShortName: "Auth",
      prefix: "web",
    });
    expect(
      phpStringAttributeArgumentContextAt(
        directCall,
        positionAfter(directCall, "web"),
        ["Auth"],
      ),
    ).toBeNull();
    expect(
      phpStringAttributeArgumentContextAt(newCall, positionAfter(newCall, "web"), [
        "Auth",
      ]),
    ).toBeNull();
    expect(
      phpStringAttributeArgumentContextAt(
        nestedExpression,
        positionAfter(nestedExpression, "web"),
        ["Auth"],
      ),
    ).toBeNull();
    expect(
      phpStringAttributeArgumentContextAt(
        comment,
        positionAfter(comment, "web"),
        ["Auth"],
      ),
    ).toBeNull();
    expect(
      phpStringAttributeArgumentContextAt(
        blockComment,
        positionAfter(blockComment, "web"),
        ["Auth"],
      ),
    ).toBeNull();
    expect(
      phpStringAttributeArgumentContextAt(
        hashComment,
        positionAfter(hashComment, "web"),
        ["Auth"],
      ),
    ).toBeNull();
    expect(
      phpStringAttributeArgumentContextAt(
        newAttributeExpression,
        positionAfter(newAttributeExpression, "web"),
        ["Auth"],
      ),
    ).toBeNull();
  });

  it("ignores array keys, nested arrays, interpolation, and non-array strings", () => {
    const key = `<?php\n\nLog::stack(['single' => true]);\n`;
    const nested = `<?php\n\nLog::stack([['single']]);\n`;
    const expressionWrapped = `<?php\n\nLog::stack($condition ? ['single'] : ['slack']);\n`;
    const interpolated = `<?php\n\nLog::stack(["sin$gle"]);\n`;
    const direct = `<?php\n\nLog::channel('single');\n`;

    expect(
      phpStringArrayArgumentElementContextAt(key, positionAfter(key, "single")),
    ).toBeNull();
    expect(
      phpStringArrayArgumentElementContextAt(
        nested,
        positionAfter(nested, "single"),
      ),
    ).toBeNull();
    expect(
      phpStringArrayArgumentElementContextAt(
        expressionWrapped,
        positionAfter(expressionWrapped, "single"),
      ),
    ).toBeNull();
    expect(
      phpStringArrayArgumentElementContextAt(
        interpolated,
        positionAfter(interpolated, "sin"),
      ),
    ).toBeNull();
    expect(
      phpStringArrayArgumentElementContextAt(
        direct,
        positionAfter(direct, "single"),
      ),
    ).toBeNull();
  });
});

function positionAfter(source: string, token: string) {
  const offset = source.indexOf(token);

  if (offset < 0) {
    throw new Error(`Token not found: ${token}`);
  }

  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < offset + token.length; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}
