import { describe, expect, it, vi } from "vitest";
import type {
  EslintAnalysisResult,
  EslintFix,
} from "../domain/eslintDiagnostics";
import { defaultWorkspaceSettings } from "../domain/settings";
import type { WorkspaceSettings } from "../domain/settings";
import type { EditorDocument } from "../domain/workspace";
import {
  createEslintFixOnSaveParticipant,
  ESLINT_FIX_ON_SAVE_TIMEOUT_MS,
  eslintFixOnSaveParticipantId,
  orderedDocumentSaveParticipants,
  runDocumentSaveParticipants,
  type DocumentSaveParticipant,
  type DocumentSaveParticipantContext,
} from "./documentSaveParticipants";

const ROOT = "/workspace";
const PATH = `${ROOT}/src/main.ts`;

function tsDocument(
  content = "const value = 1;;\n",
  savedContent = content,
): EditorDocument {
  return {
    content,
    language: "typescript",
    name: "main.ts",
    path: PATH,
    savedContent,
  };
}

function settings(
  overrides: Partial<WorkspaceSettings> = {},
): WorkspaceSettings {
  return { ...defaultWorkspaceSettings(), ...overrides };
}

function context(
  overrides: Partial<DocumentSaveParticipantContext> = {},
): DocumentSaveParticipantContext {
  return {
    document: tsDocument(),
    requestedRoot: ROOT,
    settings: settings(),
    isStale: () => false,
    ...overrides,
  };
}

function participant(
  overrides: Partial<DocumentSaveParticipant> = {},
): DocumentSaveParticipant {
  return {
    id: "test.participant",
    appliesTo: () => true,
    run: async (content) => content,
    ...overrides,
  };
}

function eslintAnalysis(fixes: readonly EslintFix[]): EslintAnalysisResult {
  return {
    status: "ok",
    diagnostics: fixes.map((fix) => ({
      filePath: "src/main.ts",
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 2,
      message: "Fixable",
      identifier: "test-rule",
      severity: 2,
      fix,
    })),
    totals: { errorCount: fixes.length, warningCount: 0, fileCount: 1 },
  };
}

describe("runDocumentSaveParticipants", () => {
  it("threads content through participants in deterministic order", async () => {
    const first = participant({
      id: "first",
      run: async (content) => `${content}+first`,
    });
    const second = participant({
      id: "second",
      run: async (content) => `${content}+second`,
    });

    const run = await runDocumentSaveParticipants({
      participants: [first, second],
      content: "base",
      context: context(),
    });

    expect(run.content).toBe("base+first+second");
    expect(run.failures).toEqual([]);
  });

  it("skips participants that do not apply to the document", async () => {
    const skipped = participant({
      id: "skipped",
      appliesTo: () => false,
      run: vi.fn(async (content: string) => `${content}+skipped`),
    });
    const applied = participant({
      id: "applied",
      run: async (content) => `${content}+applied`,
    });

    const run = await runDocumentSaveParticipants({
      participants: [skipped, applied],
      content: "base",
      context: context(),
    });

    expect(run.content).toBe("base+applied");
    expect(skipped.run).not.toHaveBeenCalled();
  });

  it("continues with the previous content when a participant throws", async () => {
    const error = new Error("participant exploded");
    const failing = participant({
      id: "failing",
      run: async () => {
        throw error;
      },
    });
    const following = participant({
      id: "following",
      run: async (content) => `${content}+following`,
    });

    const run = await runDocumentSaveParticipants({
      participants: [failing, following],
      content: "base",
      context: context(),
    });

    expect(run.content).toBe("base+following");
    expect(run.failures).toEqual([
      { participantId: "failing", reason: "error", error },
    ]);
  });

  it("times out a hanging participant and ignores its late result", async () => {
    const hanging = participant({
      id: "hanging",
      run: () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("late"), 50);
        }),
    });
    const following = participant({
      id: "following",
      run: async (content) => `${content}+following`,
    });

    const run = await runDocumentSaveParticipants({
      participants: [hanging, following],
      content: "base",
      context: context(),
      timeoutMs: 5,
    });

    expect(run.content).toBe("base+following");
    expect(run.failures).toEqual([
      expect.objectContaining({ participantId: "hanging", reason: "timeout" }),
    ]);
  });

  it("lets a participant extend its own timeout beyond the run default", async () => {
    const slow = participant({
      id: "slow",
      timeoutMs: 100,
      run: (content) =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve(`${content}+slow`), 20);
        }),
    });

    const run = await runDocumentSaveParticipants({
      participants: [slow],
      content: "base",
      context: context(),
      timeoutMs: 5,
    });

    expect(run.content).toBe("base+slow");
    expect(run.failures).toEqual([]);
  });

  it("records a failure when a participant resolves to a non-string", async () => {
    const invalid = participant({
      id: "invalid",
      run: async () => undefined as unknown as string,
    });

    const run = await runDocumentSaveParticipants({
      participants: [invalid],
      content: "base",
      context: context(),
    });

    expect(run.content).toBe("base");
    expect(run.failures).toEqual([
      expect.objectContaining({ participantId: "invalid", reason: "error" }),
    ]);
  });

  it("returns the original content when the request goes stale mid-run", async () => {
    let stale = false;
    const first = participant({
      id: "first",
      run: async (content) => {
        stale = true;
        return `${content}+first`;
      },
    });
    const second = participant({
      id: "second",
      run: vi.fn(async (content: string) => `${content}+second`),
    });

    const run = await runDocumentSaveParticipants({
      participants: [first, second],
      content: "base",
      context: context({ isStale: () => stale }),
    });

    expect(run.content).toBe("base");
    expect(second.run).not.toHaveBeenCalled();
  });
});

describe("orderedDocumentSaveParticipants", () => {
  it("runs the ESLint fix participant before the Prettier participant", () => {
    const eslintFixOnSave = participant({ id: eslintFixOnSaveParticipantId });
    const prettierFormatOnSave = participant({ id: "prettier.formatOnSave" });

    expect(
      orderedDocumentSaveParticipants({ eslintFixOnSave, prettierFormatOnSave }),
    ).toEqual([eslintFixOnSave, prettierFormatOnSave]);
  });
});

describe("createEslintFixOnSaveParticipant", () => {
  const fixableContent = "const value = 1;;\n";
  const fixedContent = "const value = 1;\n";
  const semicolonFix: EslintFix = { range: [16, 17], text: "" };

  it("finishes before the generic save-participant timeout", () => {
    const eslintParticipant = createEslintFixOnSaveParticipant({
      analyseDocument: async () => eslintAnalysis([]),
    });

    expect(eslintParticipant.timeoutMs).toBe(ESLINT_FIX_ON_SAVE_TIMEOUT_MS);
    expect(ESLINT_FIX_ON_SAVE_TIMEOUT_MS).toBeLessThan(2_000);
  });

  it("analyses and fixes the current JS/TS document content", async () => {
    const fixes = [semicolonFix];
    const analyseDocument = vi.fn(async () => eslintAnalysis(fixes));
    const eslintParticipant = createEslintFixOnSaveParticipant({
      analyseDocument,
    });
    const document = tsDocument(fixableContent);

    expect(
      eslintParticipant.appliesTo(
        document,
        settings({ eslintFixOnSave: true }),
      ),
    ).toBe(true);
    await expect(
      eslintParticipant.run(fixableContent, context({ document })),
    ).resolves.toBe(fixedContent);
    expect(analyseDocument).toHaveBeenCalledWith(
      ROOT,
      PATH,
      fixableContent,
      null,
    );
  });

  it("does not apply when the setting is off or the language is not JS/TS", () => {
    const eslintParticipant = createEslintFixOnSaveParticipant({
      analyseDocument: async () => eslintAnalysis([semicolonFix]),
    });

    expect(
      eslintParticipant.appliesTo(
        tsDocument(),
        settings({ eslintFixOnSave: false }),
      ),
    ).toBe(false);
    expect(
      eslintParticipant.appliesTo(
        { ...tsDocument(), language: "php", path: `${ROOT}/src/User.php` },
        settings({ eslintFixOnSave: true }),
      ),
    ).toBe(false);
  });

  it("fixes a dirty buffer from a fresh analysis of that exact content", async () => {
    const analyseDocument = vi.fn(async () => eslintAnalysis([semicolonFix]));
    const eslintParticipant = createEslintFixOnSaveParticipant({
      analyseDocument,
    });
    const document = tsDocument(fixableContent, "different saved content");

    await expect(
      eslintParticipant.run(fixableContent, context({ document })),
    ).resolves.toBe(fixedContent);
    expect(analyseDocument).toHaveBeenCalledWith(
      ROOT,
      PATH,
      fixableContent,
      null,
    );
  });

  it("keeps content untouched without workspace trust", async () => {
    const eslintParticipant = createEslintFixOnSaveParticipant({
      analyseDocument: async () => eslintAnalysis([semicolonFix]),
      isWorkspaceTrusted: () => false,
    });
    const document = tsDocument(fixableContent);

    await expect(
      eslintParticipant.run(fixableContent, context({ document })),
    ).resolves.toBe(fixableContent);
  });

  it("drops fixes when workspace trust is revoked during analysis", async () => {
    let trusted = true;
    const eslintParticipant = createEslintFixOnSaveParticipant({
      analyseDocument: async () => {
        trusted = false;
        return eslintAnalysis([semicolonFix]);
      },
      isWorkspaceTrusted: () => trusted,
    });

    await expect(
      eslintParticipant.run(
        fixableContent,
        context({ document: tsDocument(fixableContent) }),
      ),
    ).resolves.toBe(fixableContent);
  });

  it("keeps content untouched when no fixes are stored", async () => {
    const eslintParticipant = createEslintFixOnSaveParticipant({
      analyseDocument: async () => eslintAnalysis([]),
    });
    const document = tsDocument(fixableContent);

    await expect(
      eslintParticipant.run(fixableContent, context({ document })),
    ).resolves.toBe(fixableContent);
  });

  it("re-applies the same fixes when a discarded save repeats the same content", async () => {
    const eslintParticipant = createEslintFixOnSaveParticipant({
      analyseDocument: async () => eslintAnalysis([semicolonFix]),
    });
    const document = tsDocument(fixableContent);

    await expect(
      eslintParticipant.run(fixableContent, context({ document })),
    ).resolves.toBe(fixedContent);
    await expect(
      eslintParticipant.run(fixableContent, context({ document })),
    ).resolves.toBe(fixedContent);
  });

  it("uses fresh offsets for already fixed content", async () => {
    const eslintParticipant = createEslintFixOnSaveParticipant({
      analyseDocument: async (_root, _path, content) =>
        eslintAnalysis(content === fixableContent ? [{ ...semicolonFix }] : []),
    });
    const document = tsDocument(fixableContent);

    await expect(
      eslintParticipant.run(fixableContent, context({ document })),
    ).resolves.toBe(fixedContent);

    const savedAfterFix = tsDocument(fixedContent);
    await expect(
      eslintParticipant.run(
        fixedContent,
        context({ document: savedAfterFix }),
      ),
    ).resolves.toBe(fixedContent);
  });

  it("applies a fresh analysis result after a previous apply", async () => {
    let fixes: EslintFix[] = [semicolonFix];
    const eslintParticipant = createEslintFixOnSaveParticipant({
      analyseDocument: async () => eslintAnalysis(fixes),
    });

    await expect(
      eslintParticipant.run(
        fixableContent,
        context({ document: tsDocument(fixableContent) }),
      ),
    ).resolves.toBe(fixedContent);

    fixes = [{ range: [6, 11], text: "count" }];
    await expect(
      eslintParticipant.run(
        fixedContent,
        context({ document: tsDocument(fixedContent) }),
      ),
    ).resolves.toBe("const count = 1;\n");
  });

  it("drops an analysis result when the save request goes stale", async () => {
    let stale = false;
    const eslintParticipant = createEslintFixOnSaveParticipant({
      analyseDocument: async () => {
        stale = true;
        return eslintAnalysis([semicolonFix]);
      },
    });

    await expect(
      eslintParticipant.run(
        fixableContent,
        context({ document: tsDocument(fixableContent), isStale: () => stale }),
      ),
    ).resolves.toBe(fixableContent);
  });
});
