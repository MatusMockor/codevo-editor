import { describe, expect, it } from "vitest";
import { suspiciousPhpBareIdentifierDiagnostics } from "./phpSyntaxDiagnostics";

describe("suspiciousPhpBareIdentifierDiagnostics", () => {
  it("flags a bare identifier statement after valid PHP code", () => {
    expect(
      suspiciousPhpBareIdentifierDiagnostics(
        "<?php\n$agent = new CommentsAgent();asdasdad;\n",
      ),
    ).toEqual([
      {
        character: 29,
        endCharacter: 37,
        endLine: 1,
        line: 1,
        message: 'Unexpected bare PHP identifier "asdasdad".',
      },
    ]);
  });

  it("does not flag reserved words or constant-style identifiers", () => {
    expect(
      suspiciousPhpBareIdentifierDiagnostics(
        "<?php\nreturn $value;\nPHP_EOL;\ntrue;\n",
      ),
    ).toEqual([]);
  });
});
