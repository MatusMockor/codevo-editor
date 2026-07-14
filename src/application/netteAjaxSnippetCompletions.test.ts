import { describe, expect, it, vi } from "vitest";
import {
  collectNetteRedrawControlSnippetCompletionTargets,
  latteNetteSnippetNameCompletions,
} from "./netteAjaxSnippetCompletions";

const ROOT = "/ws";

describe("latteNetteSnippetNameCompletions", () => {
  it("offers matching snippet names from the current Latte template", () => {
    const source = [
      "{snippet mailLogslisting}",
      "{/snippet}",
      '<div n:snippet="mailSidebar"></div>',
      "{snippet mail}",
    ].join("\n");
    const offset = source.lastIndexOf("mail") + "mail".length;
    const replaceEnd = source.lastIndexOf("}");
    const replaceStart = source.lastIndexOf("mail");

    expect(latteNetteSnippetNameCompletions(source, offset)).toEqual([
      {
        detail: "Latte snippet",
        insertText: "mailLogslisting",
        kind: "snippet",
        label: "mailLogslisting",
        replaceEnd,
        replaceStart,
      },
      {
        detail: "Latte snippet",
        insertText: "mailSidebar",
        kind: "snippet",
        label: "mailSidebar",
        replaceEnd,
        replaceStart,
      },
      {
        detail: "Latte snippet",
        insertText: "mail",
        kind: "snippet",
        label: "mail",
        replaceEnd,
        replaceStart,
      },
    ]);
  });

  it("returns null outside snippet completion contexts", () => {
    expect(latteNetteSnippetNameCompletions("{if $mail}", 5)).toBeNull();
  });

  it("deduplicates repeated snippet names", () => {
    const source = [
      "{snippet listing}",
      "{/snippet}",
      '<div n:snippet="listing"></div>',
      "{snippet lis}",
    ].join("\n");
    const offset = source.lastIndexOf("lis") + "lis".length;
    const labels =
      latteNetteSnippetNameCompletions(source, offset)?.map(
        (completion) => completion.label,
      ) ?? [];

    expect(labels).toEqual(["listing", "lis"]);
  });
});

describe("collectNetteRedrawControlSnippetCompletionTargets", () => {
  it("collects static snippet names from colocated component template candidates", async () => {
    const template = [
      "{snippet mailLogslisting}",
      "{/snippet}",
      '<div n:snippet="mailSidebar"></div>',
      "{snippet $dynamic}",
    ].join("\n");

    await expect(
      collectNetteRedrawControlSnippetCompletionTargets({
        currentPhpRelativePath:
          "app/modules/mailerModule/Components/MailLogs/MailLogs.php",
        deps: {
          joinPath: (root, relativePath) => `${root}/${relativePath}`,
          readFileContent: vi.fn(async (path: string) => {
            if (
              path ===
              `${ROOT}/app/modules/mailerModule/Components/MailLogs/mail_logs.latte`
            ) {
              return template;
            }

            throw new Error(`Missing file: ${path}`);
          }),
        },
        isRequestedRootActive: () => true,
        requestedRoot: ROOT,
      }),
    ).resolves.toEqual([
      {
        name: "mailLogslisting",
        relativePath:
          "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
      },
      {
        name: "mailSidebar",
        relativePath:
          "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
      },
    ]);
  });

  it("does not read templates for non-colocated component paths", async () => {
    const readFileContent = vi.fn(async () => "");

    await expect(
      collectNetteRedrawControlSnippetCompletionTargets({
        currentPhpRelativePath:
          "app/modules/mailerModule/presenters/MailPresenter.php",
        deps: {
          joinPath: (root, relativePath) => `${root}/${relativePath}`,
          readFileContent,
        },
        isRequestedRootActive: () => true,
        requestedRoot: ROOT,
      }),
    ).resolves.toEqual([]);
    expect(readFileContent).not.toHaveBeenCalled();
  });
});
