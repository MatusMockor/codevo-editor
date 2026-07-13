import { describe, expect, it, vi } from "vitest";
import type {
  NetteLatteSnippetReference,
} from "../domain/netteAjaxSnippets";
import {
  findNetteRedrawControlSnippetDefinitionTarget,
  resolveNetteRedrawControlSnippetDefinition,
  resolveNetteAjaxSnippetDefinition,
  type NetteAjaxSnippetDefinitionDependencies,
} from "./netteAjaxSnippetDefinitions";

const ROOT = "/ws";

function deps(
  files: Record<string, string>,
  openTarget = vi.fn(async () => true),
): NetteAjaxSnippetDefinitionDependencies {
  return {
    joinPath: (root, relativePath) => `${root}/${relativePath}`,
    openTarget,
    readFileContent: vi.fn(async (path: string) => {
      const content = files[path];

      if (content === undefined) {
        throw new Error(`Missing file: ${path}`);
      }

      return content;
    }),
  };
}

function reference(name: string): NetteLatteSnippetReference {
  return { kind: "tag", name, nameEnd: name.length, nameStart: 0 };
}

describe("resolveNetteAjaxSnippetDefinition", () => {
  it("opens a matching redrawControl static string in the template owner", async () => {
    const source = `<?php
class MailLogs
{
    public function handleRefresh(): void
    {
        $this->redrawControl('mailLogslisting');
    }
}
`;
    const openTarget = vi.fn(async () => true);

    await expect(
      resolveNetteAjaxSnippetDefinition(
        {
          currentTemplateRelativePath:
            "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
          deps: deps(
            {
              [`${ROOT}/app/modules/mailerModule/Components/MailLogs/MailLogs.php`]:
                source,
            },
            openTarget,
          ),
          isRequestedRootActive: () => true,
          requestedRoot: ROOT,
        },
        reference("mailLogslisting"),
      ),
    ).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      `${ROOT}/app/modules/mailerModule/Components/MailLogs/MailLogs.php`,
      { column: 31, lineNumber: 6 },
      "mailLogslisting",
    );
  });

  it("returns false when the matching redrawControl is dynamic or absent", async () => {
    const openTarget = vi.fn(async () => true);

    await expect(
      resolveNetteAjaxSnippetDefinition(
        {
          currentTemplateRelativePath:
            "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
          deps: deps(
            {
              [`${ROOT}/app/modules/mailerModule/Components/MailLogs/MailLogs.php`]:
                "<?php $this->redrawControl($name);",
            },
            openTarget,
          ),
          isRequestedRootActive: () => true,
          requestedRoot: ROOT,
        },
        reference("mailLogslisting"),
      ),
    ).resolves.toBe(false);
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("stops without opening when the requested root is no longer active", async () => {
    const openTarget = vi.fn(async () => true);

    await expect(
      resolveNetteAjaxSnippetDefinition(
        {
          currentTemplateRelativePath:
            "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
          deps: deps(
            {
              [`${ROOT}/app/modules/mailerModule/Components/MailLogs/MailLogs.php`]:
                "<?php $this->redrawControl('mailLogslisting');",
            },
            openTarget,
          ),
          isRequestedRootActive: () => false,
          requestedRoot: ROOT,
        },
        reference("mailLogslisting"),
      ),
    ).resolves.toBe(false);
    expect(openTarget).not.toHaveBeenCalled();
  });
});

describe("resolveNetteRedrawControlSnippetDefinition", () => {
  it("opens a matching colocated Latte snippet from a redrawControl call", async () => {
    const template = `<div>
    {snippet mailLogslisting}
    {/snippet}
</div>
`;
    const openTarget = vi.fn(async () => true);

    await expect(
      resolveNetteRedrawControlSnippetDefinition(
        {
          currentPhpRelativePath:
            "app/modules/mailerModule/Components/MailLogs/MailLogs.php",
          deps: deps(
            {
              [`${ROOT}/app/modules/mailerModule/Components/MailLogs/mail_logs.latte`]:
                template,
            },
            openTarget,
          ),
          isRequestedRootActive: () => true,
          requestedRoot: ROOT,
        },
        {
          name: "mailLogslisting",
          nameEnd: "mailLogslisting".length,
          nameStart: 0,
        },
      ),
    ).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      `${ROOT}/app/modules/mailerModule/Components/MailLogs/mail_logs.latte`,
      { column: 14, lineNumber: 2 },
      "mailLogslisting",
    );
  });

  it("returns false when the PHP path is not a colocated component class", async () => {
    const openTarget = vi.fn(async () => true);

    await expect(
      resolveNetteRedrawControlSnippetDefinition(
        {
          currentPhpRelativePath:
            "app/modules/mailerModule/presenters/MailPresenter.php",
          deps: deps({}, openTarget),
          isRequestedRootActive: () => true,
          requestedRoot: ROOT,
        },
        {
          name: "mailLogslisting",
          nameEnd: "mailLogslisting".length,
          nameStart: 0,
        },
      ),
    ).resolves.toBe(false);
    expect(openTarget).not.toHaveBeenCalled();
  });
});

describe("findNetteRedrawControlSnippetDefinitionTarget", () => {
  it("finds a static snippet in a colocated component template", async () => {
    const template = `<div>
    {snippet mailLogslisting}
    {/snippet}
</div>
`;

    await expect(
      findNetteRedrawControlSnippetDefinitionTarget(
        {
          currentPhpRelativePath:
            "app/modules/mailerModule/Components/MailLogs/MailLogs.php",
          deps: deps({
            [`${ROOT}/app/modules/mailerModule/Components/MailLogs/mail_logs.latte`]:
              template,
          }),
          isRequestedRootActive: () => true,
          requestedRoot: ROOT,
        },
        "mailLogslisting",
      ),
    ).resolves.toEqual({
      name: "mailLogslisting",
      path: `${ROOT}/app/modules/mailerModule/Components/MailLogs/mail_logs.latte`,
      position: { column: 14, lineNumber: 2 },
      relativePath:
        "app/modules/mailerModule/Components/MailLogs/mail_logs.latte",
    });
  });

  it("does not scan non-component presenter paths", async () => {
    const readFileContent = vi.fn(async () => "");

    await expect(
      findNetteRedrawControlSnippetDefinitionTarget(
        {
          currentPhpRelativePath:
            "app/modules/mailerModule/presenters/MailPresenter.php",
          deps: {
            joinPath: (root, relativePath) => `${root}/${relativePath}`,
            readFileContent,
          },
          isRequestedRootActive: () => true,
          requestedRoot: ROOT,
        },
        "mailLogslisting",
      ),
    ).resolves.toBeNull();
    expect(readFileContent).not.toHaveBeenCalled();
  });
});
