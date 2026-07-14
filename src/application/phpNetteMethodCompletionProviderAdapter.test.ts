import { describe, expect, it, vi } from "vitest";
import { createPhpNetteMethodCompletionProviderAdapter } from "./phpNetteMethodCompletionProviderAdapter";

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  const before = source.slice(0, offset + needle.length);
  const lines = before.split("\n");

  return {
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    lineNumber: lines.length,
  };
}

describe("phpNetteMethodCompletionProviderAdapter", () => {
  it("returns redrawControl snippet completions from the active document path", async () => {
    const source = "<?php\n$this->redrawControl('mail');";
    const collectNetteRedrawControlSnippetTargets = vi.fn(async () => [
      {
        name: "mailLogslisting",
        relativePath:
          "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
      },
      {
        name: "sidebar",
        relativePath:
          "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
      },
    ]);
    const adapter = createPhpNetteMethodCompletionProviderAdapter({
      collectNetteRedrawControlSnippetTargets,
    });

    const completions = await adapter.literalStringCompletions({
      activeDocumentPath:
        "/workspace/app/modules/mailerModule/Components/MailLogs/MailLogs.php",
      isRequestStillCurrent: () => true,
      position: positionAfter(source, "ma"),
      source,
    });

    expect(completions).toEqual([
      {
        declaringClassName:
          "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
        detail:
          "Nette AJAX snippet - app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
        documentation: "Nette AJAX snippet\n\nmailLogslisting",
        insertText: "mailLogslisting",
        kind: "nette.ajax-snippet",
        name: "mailLogslisting",
        parameters: "",
        replaceEnd: source.indexOf("'", source.indexOf("mail")),
        replaceStart: source.indexOf("mail"),
        returnType: null,
      },
    ]);
    expect(collectNetteRedrawControlSnippetTargets).toHaveBeenCalledWith(
      "/workspace/app/modules/mailerModule/Components/MailLogs/MailLogs.php",
    );
  });

  it("returns handled-empty completions when redraw collection goes stale", async () => {
    const source = "<?php\n$this->redrawControl('mai');";
    const collectNetteRedrawControlSnippetTargets = vi.fn(async () => [
      {
        name: "mailLogslisting",
        relativePath:
          "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
      },
    ]);
    const adapter = createPhpNetteMethodCompletionProviderAdapter({
      collectNetteRedrawControlSnippetTargets,
    });

    await expect(
      adapter.literalStringCompletions({
        activeDocumentPath: "/workspace/app/Presenters/MailerPresenter.php",
        isRequestStillCurrent: () => false,
        position: positionAfter(source, "mai"),
        source,
      }),
    ).resolves.toEqual([]);
  });

  it("returns null outside redrawControl literal strings", async () => {
    const source = "<?php\n$this->redrawControl($name);";
    const collectNetteRedrawControlSnippetTargets = vi.fn(async () => []);
    const adapter = createPhpNetteMethodCompletionProviderAdapter({
      collectNetteRedrawControlSnippetTargets,
    });

    await expect(
      adapter.literalStringCompletions({
        activeDocumentPath: "/workspace/app/Presenters/MailerPresenter.php",
        isRequestStillCurrent: () => true,
        position: positionAfter(source, "name"),
        source,
      }),
    ).resolves.toBeNull();
    expect(collectNetteRedrawControlSnippetTargets).not.toHaveBeenCalled();
  });
});
