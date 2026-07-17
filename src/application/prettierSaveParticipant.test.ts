import { describe, expect, it, vi } from "vitest";
import type {
  PrettierFormatResult,
  PrettierFormattingGateway,
} from "../domain/prettierFormatting";
import { defaultWorkspaceSettings } from "../domain/settings";
import type { WorkspaceSettings } from "../domain/settings";
import type { EditorDocument } from "../domain/workspace";
import type { DocumentSaveParticipantContext } from "./documentSaveParticipants";
import {
  createPrettierSaveParticipant,
  isPrettierFormattableDocument,
  prettierFormattableExtensions,
  prettierSaveParticipantId,
  PRETTIER_SAVE_PARTICIPANT_TIMEOUT_MS,
} from "./prettierSaveParticipant";

const ROOT = "/workspace";
const PATH = `${ROOT}/src/App.ts`;

function tsDocument(overrides: Partial<EditorDocument> = {}): EditorDocument {
  return {
    content: "const value=1\n",
    language: "typescript",
    name: "App.ts",
    path: PATH,
    savedContent: "const value=1\n",
    ...overrides,
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
    settings: settings({ prettierFormatOnSave: true }),
    isStale: () => false,
    ...overrides,
  };
}

function gateway(result: PrettierFormatResult): PrettierFormattingGateway {
  return { format: vi.fn(async () => result) };
}

describe("prettierFormattableExtensions", () => {
  it("covers the conservative JS/TS, JSON, and CSS/SCSS families", () => {
    expect([...prettierFormattableExtensions]).toEqual([
      "js",
      "jsx",
      "cjs",
      "mjs",
      "ts",
      "tsx",
      "cts",
      "mts",
      "json",
      "css",
      "scss",
    ]);
  });
});

describe("isPrettierFormattableDocument", () => {
  it("accepts documents with a formattable extension", () => {
    expect(isPrettierFormattableDocument(tsDocument())).toBe(true);
    expect(
      isPrettierFormattableDocument(
        tsDocument({ name: "app.json", path: `${ROOT}/app.json` }),
      ),
    ).toBe(true);
    expect(
      isPrettierFormattableDocument(
        tsDocument({ name: "app.SCSS", path: `${ROOT}/app.SCSS` }),
      ),
    ).toBe(true);
  });

  it("rejects unsupported and extensionless documents", () => {
    expect(
      isPrettierFormattableDocument(
        tsDocument({ language: "php", name: "User.php", path: `${ROOT}/User.php` }),
      ),
    ).toBe(false);
    expect(
      isPrettierFormattableDocument(
        tsDocument({ name: "README.md", path: `${ROOT}/README.md` }),
      ),
    ).toBe(false);
    expect(
      isPrettierFormattableDocument(
        tsDocument({ name: "Makefile", path: `${ROOT}/Makefile` }),
      ),
    ).toBe(false);
  });
});

describe("createPrettierSaveParticipant", () => {
  it("gives itself a longer timeout than the pipeline default", () => {
    const prettierParticipant = createPrettierSaveParticipant({
      prettierFormatting: gateway({ status: "ok", formatted: "" }),
    });

    expect(prettierParticipant.id).toBe(prettierSaveParticipantId);
    expect(prettierParticipant.timeoutMs).toBe(
      PRETTIER_SAVE_PARTICIPANT_TIMEOUT_MS,
    );
    expect(PRETTIER_SAVE_PARTICIPANT_TIMEOUT_MS).toBe(5_000);
  });

  it("applies only when the setting is on and the document is formattable", () => {
    const prettierParticipant = createPrettierSaveParticipant({
      prettierFormatting: gateway({ status: "ok", formatted: "" }),
    });

    expect(
      prettierParticipant.appliesTo(
        tsDocument(),
        settings({ prettierFormatOnSave: true }),
      ),
    ).toBe(true);
    expect(
      prettierParticipant.appliesTo(
        tsDocument(),
        settings({ prettierFormatOnSave: false }),
      ),
    ).toBe(false);
    expect(
      prettierParticipant.appliesTo(
        tsDocument({ language: "php", name: "User.php", path: `${ROOT}/User.php` }),
        settings({ prettierFormatOnSave: true }),
      ),
    ).toBe(false);
  });

  it("formats through the gateway using the workspace-relative path", async () => {
    const prettierFormatting = gateway({
      status: "ok",
      formatted: "const value = 1;\n",
    });
    const prettierParticipant = createPrettierSaveParticipant({
      prettierFormatting,
    });

    await expect(
      prettierParticipant.run("const value=1\n", context()),
    ).resolves.toBe("const value = 1;\n");
    expect(prettierFormatting.format).toHaveBeenCalledWith(
      ROOT,
      "src/App.ts",
      "const value=1\n",
    );
  });

  it("keeps content untouched for documents outside the requested root", async () => {
    const prettierFormatting = gateway({
      status: "ok",
      formatted: "formatted",
    });
    const prettierParticipant = createPrettierSaveParticipant({
      prettierFormatting,
    });
    const document = tsDocument({ path: "/elsewhere/src/App.ts" });

    await expect(
      prettierParticipant.run("const value=1\n", context({ document })),
    ).resolves.toBe("const value=1\n");
    expect(prettierFormatting.format).not.toHaveBeenCalled();
  });

  it("keeps content untouched without workspace trust", async () => {
    const prettierFormatting = gateway({
      status: "ok",
      formatted: "formatted",
    });
    const prettierParticipant = createPrettierSaveParticipant({
      prettierFormatting,
      isWorkspaceTrusted: () => false,
    });

    await expect(
      prettierParticipant.run("const value=1\n", context()),
    ).resolves.toBe("const value=1\n");
    expect(prettierFormatting.format).not.toHaveBeenCalled();
  });

  it("keeps content untouched when the save goes stale during formatting", async () => {
    let stale = false;
    const prettierFormatting: PrettierFormattingGateway = {
      format: vi.fn(async () => {
        stale = true;
        return { status: "ok" as const, formatted: "formatted" };
      }),
    };
    const prettierParticipant = createPrettierSaveParticipant({
      prettierFormatting,
    });

    await expect(
      prettierParticipant.run(
        "const value=1\n",
        context({ isStale: () => stale }),
      ),
    ).resolves.toBe("const value=1\n");
  });

  it("silently keeps content when prettier is unavailable in the project", async () => {
    const prettierParticipant = createPrettierSaveParticipant({
      prettierFormatting: gateway({
        status: "unavailable",
        message: "prettier is not installed",
      }),
    });

    await expect(
      prettierParticipant.run("const value=1\n", context()),
    ).resolves.toBe("const value=1\n");
  });

  it("silently keeps content on a syntax error so the save never fails", async () => {
    const prettierParticipant = createPrettierSaveParticipant({
      prettierFormatting: gateway({
        status: "error",
        kind: "syntax",
        message: "Unexpected token",
      }),
    });

    await expect(
      prettierParticipant.run("const value=(\n", context()),
    ).resolves.toBe("const value=(\n");
  });

  it.each(["timeout", "failed", "inputTooLarge"] as const)(
    "throws on a %s error so the pipeline surfaces a save participant failure",
    async (kind) => {
      const prettierParticipant = createPrettierSaveParticipant({
        prettierFormatting: gateway({
          status: "error",
          kind,
          message: `prettier ${kind}`,
        }),
      });

      await expect(
        prettierParticipant.run("const value=1\n", context()),
      ).rejects.toThrowError(`prettier ${kind}`);
    },
  );
});
