import { describe, expect, it } from "vitest";
import { filterPhpLanguageServerDiagnostics } from "./phpLanguageServerDiagnosticFilters";
import type { LanguageServerDiagnostic } from "./languageServerDiagnostics";

describe("filterPhpLanguageServerDiagnostics", () => {
  it("suppresses unresolved Laravel Eloquent static builder methods", () => {
    const source = `<?php

$queryBuilder = Album::whereNull('parent_id');
`;

    expect(
      filterPhpLanguageServerDiagnostics(source, [
        diagnostic({
          character: 23,
          line: 2,
          message: "Method App\\Models\\Album::whereNull() does not exist",
        }),
      ]),
    ).toEqual([]);
  });

  it("keeps unresolved diagnostics for unknown static methods", () => {
    const source = `<?php

$queryBuilder = Album::whereNulll('parent_id');
`;
    const unresolved = diagnostic({
      character: 23,
      line: 2,
      message: "Method App\\Models\\Album::whereNulll() does not exist",
    });

    expect(filterPhpLanguageServerDiagnostics(source, [unresolved])).toEqual([
      unresolved,
    ]);
  });

  it("keeps syntax diagnostics on Laravel lines", () => {
    const source = `<?php

$queryBuilder = Album::whereNull('parent_id')
`;
    const syntax = diagnostic({
      character: 45,
      line: 2,
      message: "unexpected EOF, expecting ';'",
    });

    expect(filterPhpLanguageServerDiagnostics(source, [syntax])).toEqual([
      syntax,
    ]);
  });

  it("suppresses PHPactor docblock hygiene diagnostics for valid legacy interfaces", () => {
    const source = `<?php

interface LocalUserInterface
{
    public function loadByCredentials($login, $password);
}
`;

    expect(
      filterPhpLanguageServerDiagnostics(source, [
        diagnostic({
          character: 20,
          code: "worse.docblock_missing_return_type",
          line: 4,
          message:
            'Method "loadByCredentials" is missing docblock return type: void',
        }),
        diagnostic({
          character: 38,
          code: "worse.docblock_missing_param",
          line: 4,
          message: 'Method "loadByCredentials" is missing @param $login',
        }),
      ]),
    ).toEqual([]);
  });

  it("keeps real PHPactor syntax diagnostics next to filtered docblock warnings", () => {
    const syntax = diagnostic({
      character: 55,
      code: null,
      line: 4,
      message: "unexpected token",
    });

    expect(
      filterPhpLanguageServerDiagnostics("<?php\ninterface Broken\n{\n", [
        diagnostic({
          character: 20,
          code: "worse.docblock_missing_return_type",
          line: 2,
          message: 'Method "broken" is missing docblock return type: void',
        }),
        syntax,
      ]),
    ).toEqual([syntax]);
  });

  it("suppresses PHPactor keyword-as-method false positives on return statements", () => {
    const source = `<?php

return (new CommentResource($comment))->response()->setStatusCode(200);
`;

    expect(
      filterPhpLanguageServerDiagnostics(source, [
        diagnostic({
          character: 0,
          line: 2,
          message:
            'Method "return" does not exist on class "Kontentino\\Communication\\Models\\Comment"',
        }),
      ]),
    ).toEqual([]);
  });

  it("keeps unknown method diagnostics away from return statements", () => {
    const source = `<?php

$comment->return();
`;
    const unresolved = diagnostic({
      character: 10,
      line: 2,
      message:
        'Method "return" does not exist on class "Kontentino\\Communication\\Models\\Comment"',
    });

    expect(filterPhpLanguageServerDiagnostics(source, [unresolved])).toEqual([
      unresolved,
    ]);
  });

  it("suppresses stale PHPactor return parse diagnostics after completed calls", () => {
    const source = `<?php

$comment->forceDelete();
return (new CommentResource($comment))->response()->setStatusCode(200);
`;

    expect(
      filterPhpLanguageServerDiagnostics(source, [
        diagnostic({
          character: 0,
          line: 3,
          message:
            'Parse error: syntax error, unexpected token "return" in Standard input code on line 4 Errors parsing Standard input code',
        }),
      ]),
    ).toEqual([]);
  });

  it("keeps return parse diagnostics when the previous statement is incomplete", () => {
    const source = `<?php

$comment->forceDelete(
return (new CommentResource($comment))->response()->setStatusCode(200);
`;
    const parseError = diagnostic({
      character: 0,
      line: 3,
      message:
        'Parse error: syntax error, unexpected token "return" in Standard input code on line 4 Errors parsing Standard input code',
    });

    expect(filterPhpLanguageServerDiagnostics(source, [parseError])).toEqual([
      parseError,
    ]);
  });
});

function diagnostic(
  overrides: Partial<LanguageServerDiagnostic>,
): LanguageServerDiagnostic {
  return {
    character: 0,
    line: 0,
    message: "Unknown method",
    severity: "error",
    source: "PHPactor",
    ...overrides,
  };
}
