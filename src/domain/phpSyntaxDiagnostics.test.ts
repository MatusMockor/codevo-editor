import { describe, expect, it } from "vitest";
import {
  structuralPhpSyntaxDiagnostics,
  suspiciousPhpBareIdentifierDiagnostics,
} from "./phpSyntaxDiagnostics";

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

  it("does not flag multi-line trait use lists", () => {
    expect(
      suspiciousPhpBareIdentifierDiagnostics(`<?php

trait HasTenancy
{
    use HasDatabase,
        HasInternalKeys,
        TenantRun;
}
`),
    ).toEqual([]);
  });
});

describe("structuralPhpSyntaxDiagnostics", () => {
  it("flags an unclosed delimiter at end of file", () => {
    expect(structuralPhpSyntaxDiagnostics("<?php\n\nfunction codevoQaBroken(")).toEqual(
      [
        {
          character: 23,
          endCharacter: 24,
          endLine: 2,
          line: 2,
          message: 'Unclosed delimiter, expected ")".',
        },
      ],
    );
  });

  it("ignores balanced delimiters inside strings and comments", () => {
    expect(
      structuralPhpSyntaxDiagnostics(
        "<?php\n// (\n$text = \"{\";\nfunction ok(): void {}\n",
      ),
    ).toEqual([]);
  });
});
