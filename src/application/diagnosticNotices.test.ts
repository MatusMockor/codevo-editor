import { describe, expect, it } from "vitest";
import {
  activeDotenvLocalDiagnosticNotices,
  activePhpLocalDiagnosticNotices,
  buildDiagnosticOverflowNotice,
  composeEffectiveDiagnosticNotices,
  DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT,
  diagnosticNoticeNavigationTarget,
  GLOBAL_NOTICE_LIMIT,
  isCappableDiagnosticNotice,
  javaScriptTypeScriptDiagnosticNoticeGroup,
  localPhpDiagnosticsFromSource,
  PHP_LOCAL_DIAGNOSTIC_NOTICE_GROUP_PREFIX,
  phpLocalDiagnosticNoticeGroup,
} from "./diagnosticNotices";
import {
  createWorkbenchNotice,
  GLOBAL_NOTICE_OVERFLOW_GROUP_KEY,
} from "./workbenchNotice";
import { fileUriFromPath } from "../domain/languageServerDocumentSync";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";

describe("diagnostic-notice caps", () => {
  it("keeps the documented per-document and global limits", () => {
    expect(DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT).toBe(100);
    expect(GLOBAL_NOTICE_LIMIT).toBe(2000);
    expect(PHP_LOCAL_DIAGNOSTIC_NOTICE_GROUP_PREFIX).toBe(
      "php-local-diagnostics:",
    );
  });
});

describe("isCappableDiagnosticNotice", () => {
  it("returns false when the notice has no groupKey", () => {
    const notice = createWorkbenchNotice("error", "runtime", "server crashed");

    expect(isCappableDiagnosticNotice(notice)).toBe(false);
  });

  it("returns false for a groupKey outside the diagnostic families", () => {
    const notice = createWorkbenchNotice(
      "error",
      "runtime",
      "server crashed",
      "php-setup",
    );

    expect(isCappableDiagnosticNotice(notice)).toBe(false);
  });

  it("returns true for language server diagnostic groups", () => {
    const notice = createWorkbenchNotice(
      "error",
      "phpactor",
      "boom",
      "language-server-diagnostics:file:///a.php",
    );

    expect(isCappableDiagnosticNotice(notice)).toBe(true);
  });

  it("returns true for JavaScript/TypeScript diagnostic groups", () => {
    const notice = createWorkbenchNotice(
      "error",
      "tsserver",
      "boom",
      javaScriptTypeScriptDiagnosticNoticeGroup("file:///a.ts"),
    );

    expect(isCappableDiagnosticNotice(notice)).toBe(true);
  });

  it("returns true for PHP local diagnostic groups", () => {
    const notice = createWorkbenchNotice(
      "error",
      "PHP Syntax",
      "boom",
      phpLocalDiagnosticNoticeGroup("/project/app/Foo.php"),
    );

    expect(isCappableDiagnosticNotice(notice)).toBe(true);
  });
});

describe("buildDiagnosticOverflowNotice", () => {
  it("reports the truthful shown/total counts and marks the notice as overflow", () => {
    const notice = buildDiagnosticOverflowNotice(
      "Language Server",
      "language-server-diagnostics:file:///a.php",
      42,
    );

    expect(notice.severity).toBe("info");
    expect(notice.source).toBe("Language Server");
    expect(notice.groupKey).toBe("language-server-diagnostics:file:///a.php");
    expect(notice.kind).toBe("overflow");
    expect(notice.message).toBe(
      `Showing ${DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT} of ${
        DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT + 42
      } diagnostics — 42 more hidden. Open the file to see all markers.`,
    );
  });
});

describe("javaScriptTypeScriptDiagnosticNoticeGroup", () => {
  it("prefixes the uri with the javascript-typescript-diagnostics namespace", () => {
    expect(javaScriptTypeScriptDiagnosticNoticeGroup("file:///a.ts")).toBe(
      "javascript-typescript-diagnostics:file:///a.ts",
    );
  });
});

describe("phpLocalDiagnosticNoticeGroup", () => {
  it("prefixes the path's file uri with the php-local-diagnostics namespace", () => {
    const path = "/project/app/Foo.php";

    expect(phpLocalDiagnosticNoticeGroup(path)).toBe(
      `${PHP_LOCAL_DIAGNOSTIC_NOTICE_GROUP_PREFIX}${fileUriFromPath(path)}`,
    );
  });
});

describe("localPhpDiagnosticsFromSource", () => {
  it("maps passed-in syntax diagnostics to PHP Syntax errors and skips the structural fallback", () => {
    const syntaxDiagnostics = [
      {
        character: 0,
        endCharacter: 1,
        endLine: 0,
        line: 0,
        message: "Unexpected token.",
      },
    ];

    // Source that would otherwise trigger a structural diagnostic (unclosed
    // delimiter); it must be ignored because syntaxDiagnostics is non-empty.
    const diagnostics = localPhpDiagnosticsFromSource(
      "<?php\n\nfunction codevoQaBroken(",
      syntaxDiagnostics,
    );

    expect(diagnostics).toEqual([
      {
        character: 0,
        endCharacter: 1,
        endLine: 0,
        line: 0,
        message: "Unexpected token.",
        severity: "error",
        source: "PHP Syntax",
      },
    ]);
  });

  it("falls back to the structural syntax scan when no syntax diagnostics are provided", () => {
    const diagnostics = localPhpDiagnosticsFromSource(
      "<?php\n\nfunction codevoQaBroken(",
      [],
    );

    expect(diagnostics).toEqual([
      {
        character: 23,
        endCharacter: 24,
        endLine: 2,
        line: 2,
        message: 'Unclosed delimiter, expected ")".',
        severity: "error",
        source: "PHP Syntax",
      },
    ]);
  });

  it("always includes bare-identifier diagnostics alongside the passed syntax diagnostics", () => {
    const diagnostics = localPhpDiagnosticsFromSource(
      "<?php\n$agent = new CommentsAgent();asdasdad;\n",
      [],
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Unexpected bare PHP identifier "asdasdad".',
          severity: "error",
          source: "PHP Syntax",
        }),
      ]),
    );
  });

  it("appends inspection diagnostics as warnings and tags unnecessary code", () => {
    const source = `<?php

namespace App;

use App\\Services\\UsedService;
use App\\Services\\UnusedService;

class Foo
{
    public function bar(UsedService $service): void
    {
    }
}
`;

    const diagnostics = localPhpDiagnosticsFromSource(source, []);
    const inspectionDiagnostic = diagnostics.find(
      (diagnostic) => diagnostic.source === "PHP Inspection",
    );

    expect(inspectionDiagnostic).toMatchObject({
      message: "Unused import App\\Services\\UnusedService.",
      severity: "warning",
      source: "PHP Inspection",
      tags: [1],
    });
  });
});

describe("diagnosticNoticeNavigationTarget", () => {
  const diagnostic: LanguageServerDiagnostic = {
    character: 4,
    endCharacter: 10,
    endLine: 2,
    line: 1,
    message: "boom",
    severity: "error",
    source: "phpactor",
  };

  it("returns undefined for a non-file uri", () => {
    expect(
      diagnosticNoticeNavigationTarget("untitled:Untitled-1", diagnostic),
    ).toBeUndefined();
  });

  it("converts the 0-based diagnostic range to a 1-based navigation target", () => {
    const uri = fileUriFromPath("/project/app/Foo.php");

    expect(diagnosticNoticeNavigationTarget(uri, diagnostic)).toEqual({
      path: "/project/app/Foo.php",
      range: {
        end: { column: 11, lineNumber: 3 },
        start: { column: 5, lineNumber: 2 },
      },
    });
  });

  it("falls back to the start position when the diagnostic has no end position", () => {
    const uri = fileUriFromPath("/project/app/Foo.php");
    const diagnosticWithoutEnd: LanguageServerDiagnostic = {
      character: 4,
      line: 1,
      message: "boom",
      severity: "error",
      source: "phpactor",
    };

    expect(
      diagnosticNoticeNavigationTarget(uri, diagnosticWithoutEnd),
    ).toEqual({
      path: "/project/app/Foo.php",
      range: {
        end: { column: 5, lineNumber: 2 },
        start: { column: 5, lineNumber: 2 },
      },
    });
  });
});

describe("active local diagnostic notices", () => {
  const path = "/project/app/Foo.php";
  const dotenvPath = "/project/.env";

  const diagnostic = (
    overrides: Partial<LanguageServerDiagnostic> = {},
  ): LanguageServerDiagnostic => {
    const { source = null, ...rest } = overrides;

    return {
      character: 0,
      endCharacter: 3,
      endLine: 0,
      line: 0,
      message: "boom",
      severity: "error",
      ...rest,
      source,
    };
  };

  it("builds active PHP notices in the active-file local diagnostic group", () => {
    const notices = activePhpLocalDiagnosticNotices(
      { language: "php", path },
      { [path]: [diagnostic()] },
    );

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      groupKey: phpLocalDiagnosticNoticeGroup(path),
      severity: "error",
      source: "PHP",
    });
    expect(notices[0].message).toContain("boom");
    expect(notices[0].navigationTarget).toEqual({
      path,
      range: {
        end: { column: 4, lineNumber: 1 },
        start: { column: 1, lineNumber: 1 },
      },
    });
  });

  it("builds active dotenv notices with the same active-file grouping behavior", () => {
    const notices = activeDotenvLocalDiagnosticNotices(
      { language: "dotenv", path: dotenvPath },
      { [dotenvPath]: [diagnostic({ severity: "warning" })] },
    );

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      groupKey: phpLocalDiagnosticNoticeGroup(dotenvPath),
      severity: "warning",
      source: "dotenv",
    });
    expect(notices[0].message).toContain("boom");
  });

  it("returns no active notices for non-matching document languages or empty diagnostics", () => {
    expect(
      activePhpLocalDiagnosticNotices(
        { language: "txt", path },
        { [path]: [diagnostic()] },
      ),
    ).toEqual([]);
    expect(
      activeDotenvLocalDiagnosticNotices(
        { language: "dotenv", path: dotenvPath },
        {},
      ),
    ).toEqual([]);
  });

  it("caps active local notices and appends a truthful overflow indicator", () => {
    const diagnostics = Array.from(
      { length: DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT + 2 },
      (_unused, index) => diagnostic({ message: `boom ${index}` }),
    );

    const notices = activePhpLocalDiagnosticNotices(
      { language: "php", path },
      { [path]: diagnostics },
    );

    expect(notices).toHaveLength(DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT + 1);
    expect(notices[notices.length - 1]).toMatchObject({
      groupKey: phpLocalDiagnosticNoticeGroup(path),
      kind: "overflow",
      message: `Showing ${DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT} of ${
        DIAGNOSTIC_NOTICES_PER_DOCUMENT_LIMIT + 2
      } diagnostics — 2 more hidden. Open the file to see all markers.`,
      source: "PHP",
    });
  });
});

describe("composeEffectiveDiagnosticNotices", () => {
  const path = "/project/app/Foo.php";
  const groupKey = phpLocalDiagnosticNoticeGroup(path);

  it("leaves notices unchanged for non-PHP/non-dotenv active documents", () => {
    const notices = [createWorkbenchNotice("warning", "runtime", "keep")];

    expect(
      composeEffectiveDiagnosticNotices({
        activeDocument: { language: "txt", path },
        activeDotenvDiagnosticNotices: [],
        activePhpLocalDiagnosticNotices: [
          createWorkbenchNotice("error", "PHP", "new", groupKey),
        ],
        notices,
      }),
    ).toBe(notices);
  });

  it("removes stale active local notices when active PHP diagnostics are empty", () => {
    const stale = createWorkbenchNotice("error", "PHP", "stale", groupKey);
    const other = createWorkbenchNotice(
      "warning",
      "phpactor",
      "other",
      "language-server-diagnostics:file:///other.php",
    );

    expect(
      composeEffectiveDiagnosticNotices({
        activeDocument: { language: "php", path },
        activeDotenvDiagnosticNotices: [],
        activePhpLocalDiagnosticNotices: [],
        notices: [stale, other],
      }),
    ).toEqual([other]);
  });

  it("replaces stale active dotenv notices with active diagnostics", () => {
    const stale = createWorkbenchNotice("error", "dotenv", "stale", groupKey);
    const fresh = createWorkbenchNotice("warning", "dotenv", "fresh", groupKey);
    const other = createWorkbenchNotice("info", "runtime", "keep");

    expect(
      composeEffectiveDiagnosticNotices({
        activeDocument: { language: "dotenv", path },
        activeDotenvDiagnosticNotices: [fresh],
        activePhpLocalDiagnosticNotices: [],
        notices: [stale, other],
      }),
    ).toEqual([other, fresh]);
  });

  it("applies the global diagnostic cap while keeping protected notices", () => {
    const protectedNotice = createWorkbenchNotice(
      "error",
      "runtime",
      "server crashed",
      "php-setup",
    );
    const stale = createWorkbenchNotice("error", "PHP", "stale", groupKey);
    const existingDiagnosticNotices = Array.from(
      { length: GLOBAL_NOTICE_LIMIT - 1 },
      (_unused, index) =>
        createWorkbenchNotice(
          "error",
          "phpactor",
          `diagnostic ${index}`,
          `language-server-diagnostics:file-${index}`,
        ),
    );
    const activeNotice = createWorkbenchNotice("error", "PHP", "active", groupKey);
    const hiddenActiveNotice = createWorkbenchNotice(
      "error",
      "PHP",
      "hidden active",
      groupKey,
    );

    const effective = composeEffectiveDiagnosticNotices({
      activeDocument: { language: "php", path },
      activeDotenvDiagnosticNotices: [],
      activePhpLocalDiagnosticNotices: [activeNotice, hiddenActiveNotice],
      notices: [protectedNotice, stale, ...existingDiagnosticNotices],
    });

    expect(effective).toContain(protectedNotice);
    expect(effective).toContain(activeNotice);
    expect(effective).not.toContain(hiddenActiveNotice);
    expect(effective).not.toContain(stale);
    expect(
      effective.filter(
        (notice) => notice.groupKey === GLOBAL_NOTICE_OVERFLOW_GROUP_KEY,
      ),
    ).toHaveLength(1);
  });
});
