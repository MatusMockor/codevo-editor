import { describe, expect, it, vi } from "vitest";
import {
  collectNetteRedrawControlSnippetCompletionTargets,
  createNetteRedrawControlSnippetTargetCollector,
  latteNetteSnippetNameCompletions,
  phpNetteRedrawControlSnippetNameCompletions,
} from "./netteAjaxSnippetCompletions";

const ROOT = "/ws";
const CURRENT_PHP_PATH =
  "/ws/app/modules/mailerModule/Components/MailLogs/MailLogs.php";
const CURRENT_PHP_RELATIVE_PATH =
  "app/modules/mailerModule/Components/MailLogs/MailLogs.php";
const COLOCATED_TEMPLATE_PATH =
  "/ws/app/modules/mailerModule/Components/MailLogs/mail_logs.latte";
const COLOCATED_TEMPLATE_RELATIVE_PATH =
  "app/modules/mailerModule/Components/MailLogs/mail_logs.latte";
const PLAIN_COMPLETION_BEHAVIOR = {
  insertTextMode: "plain",
  triggerParameterHints: false,
} as const;

function joinWorkspacePath(root: string, relativePath: string): string {
  return `${root}/${relativePath}`;
}

function relativeWorkspacePath(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

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

describe("phpNetteRedrawControlSnippetNameCompletions", () => {
  it("carries presentation metadata on redrawControl snippet completions", () => {
    const source = "<?php\n$this->redrawControl('mai');";
    const offset = source.indexOf("mai") + "mai".length;

    expect(
      phpNetteRedrawControlSnippetNameCompletions(source, offset, [
        {
          name: "mailLogslisting",
          relativePath:
            "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
        },
      ]),
    ).toEqual([
      {
        completionBehavior: PLAIN_COMPLETION_BEHAVIOR,
        declaringClassName:
          "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
        detail:
          "Nette AJAX snippet - app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
        documentation: "Nette AJAX snippet\n\nmailLogslisting",
        insertText: "mailLogslisting",
        kind: "nette.ajax-snippet",
        name: "mailLogslisting",
        parameters: "",
        replaceEnd: source.indexOf("'", source.indexOf("mai")),
        replaceStart: source.indexOf("mai"),
        returnType: null,
      },
    ]);
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
        currentPhpRelativePath: CURRENT_PHP_RELATIVE_PATH,
        deps: {
          joinPath: joinWorkspacePath,
          readFileContent: vi.fn(async (path: string) => {
            if (path === COLOCATED_TEMPLATE_PATH) {
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
        relativePath: COLOCATED_TEMPLATE_RELATIVE_PATH,
      },
      {
        name: "mailSidebar",
        relativePath: COLOCATED_TEMPLATE_RELATIVE_PATH,
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
          joinPath: joinWorkspacePath,
          readFileContent,
        },
        isRequestedRootActive: () => true,
        requestedRoot: ROOT,
      }),
    ).resolves.toEqual([]);
    expect(readFileContent).not.toHaveBeenCalled();
  });
});

describe("createNetteRedrawControlSnippetTargetCollector", () => {
  it("does not read templates when legacy Nette state is stale without a provider", async () => {
    const readNavigationFileContent = vi.fn(
      async () => "{snippet mailLogslisting}",
    );
    const staleLegacyRuntime = {
      isNette: true,
      hasProvider: vi.fn(() => true),
    };

    const collectTargets = createNetteRedrawControlSnippetTargetCollector({
      currentWorkspaceRootRef: { current: ROOT },
      frameworkRuntime: staleLegacyRuntime,
      joinWorkspacePath,
      readNavigationFileContent,
      relativeWorkspacePath,
      workspaceRoot: ROOT,
    });

    await expect(collectTargets(CURRENT_PHP_PATH)).resolves.toEqual([]);
    expect(staleLegacyRuntime.hasProvider).not.toHaveBeenCalled();
    expect(readNavigationFileContent).not.toHaveBeenCalled();
  });

  it("reads colocated Latte templates when the Nette provider is active", async () => {
    const readNavigationFileContent = vi.fn(async (path: string) => {
      if (path === COLOCATED_TEMPLATE_PATH) {
        return "{snippet mailLogslisting}";
      }

      throw new Error(`Missing file: ${path}`);
    });

    const collectTargets = createNetteRedrawControlSnippetTargetCollector({
      currentWorkspaceRootRef: { current: ROOT },
      frameworkRuntime: {
        hasProvider: (providerId) => providerId === "nette",
        supports: (capability) =>
          capability === "netteRedrawControlSnippetCompletions",
      },
      joinWorkspacePath,
      readNavigationFileContent,
      relativeWorkspacePath,
      workspaceRoot: ROOT,
    });

    await expect(collectTargets(CURRENT_PHP_PATH)).resolves.toEqual([
      {
        name: "mailLogslisting",
        relativePath: COLOCATED_TEMPLATE_RELATIVE_PATH,
      },
    ]);
    expect(readNavigationFileContent).toHaveBeenCalledWith(
      COLOCATED_TEMPLATE_PATH,
    );
  });
});
