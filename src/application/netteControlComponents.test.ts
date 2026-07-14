import { describe, expect, it, vi } from "vitest";
import {
  latteControlCompletions,
  latteControlCompletionAt,
  latteFormFieldMacroCompletionAt,
  latteFormFieldMacroCompletions,
  netteControlReferenceAt,
  resolveNetteControlDefinition,
} from "./netteControlComponents";
import type { NetteControlCache } from "./netteControlContracts";

const ROOT = "/ws";
const PRESENTER = `<?php
class HomePresenter
{
    protected function createComponentProductList(): ProductListControl
    {
        return new ProductListControl();
    }
}
`;

const deps = {
  joinPath: (root: string, relativePath: string) => `${root}/${relativePath}`,
  openPhpMethodTarget: vi.fn(async () => true),
  openTarget: vi.fn(async () => true),
  readFileContent: vi.fn(async () => PRESENTER),
  resolveDeclaredType: (_source: string, typeHint: string | null) => typeHint,
};

describe("netteControlReferenceAt", () => {
  it("detects control names and render parts", () => {
    const source = "{control productList:pagination}";

    expect(netteControlReferenceAt(source, source.indexOf("pagination")))
      .toEqual({ name: "productList", part: "pagination" });
  });

  it("detects form macros as component references", () => {
    const source = "{form contactForm}{/form}";

    expect(netteControlReferenceAt(source, source.indexOf("contactForm") + 2))
      .toEqual({ name: "contactForm" });
  });

  it.each(["input", "label", "inputError"] as const)(
    "detects {%s email} as a field reference inside the active form",
    (macro) => {
      const source = `{form contactForm}{${macro} email}{/form}`;

      expect(netteControlReferenceAt(source, source.indexOf("email") + 2))
        .toEqual({ fieldName: "email", name: "contactForm" });
    },
  );
});

describe("latteControlCompletions", () => {
  it("offers createComponent names from the template owner", async () => {
    const cache: NetteControlCache = {};

    await expect(
      latteControlCompletions(
        {
          componentCache: cache,
          deps,
          isRequestedRootActive: () => true,
          maxCompletions: 100,
          requestedRoot: ROOT,
          templateRelativePath: "app/UI/Home/default.latte",
          ttlMs: 5000,
        },
        { prefix: "pro", replaceEnd: 13, replaceStart: 10 },
      ),
    ).resolves.toMatchObject([
      {
        insertText: "productList",
        kind: "component",
        label: "productList",
      },
    ]);
  });

  it("detects the completion span inside a control macro", () => {
    const source = "{control pro}";

    expect(latteControlCompletionAt(source, source.indexOf("}")))
      .toEqual({ prefix: "pro", replaceEnd: 12, replaceStart: 9 });
  });

  it("detects the completion span inside a form macro", () => {
    const source = "{form co}";

    expect(latteControlCompletionAt(source, source.indexOf("}")))
      .toEqual({ prefix: "co", replaceEnd: 8, replaceStart: 6 });
  });
});

describe("latteFormFieldMacroCompletions", () => {
  it("offers fields from the active form macro", async () => {
    const source = "{form contactForm}{input em}{/form}";
    const offset = source.indexOf("em") + "em".length;
    const completion = latteFormFieldMacroCompletionAt(source, offset);

    expect(completion).toEqual({
      prefix: "em",
      replaceEnd: offset,
      replaceStart: source.indexOf("em"),
    });

    await expect(
      latteFormFieldMacroCompletions(
        {
          componentCache: {},
          deps: {
            ...deps,
            readFileContent: vi.fn(async () => `<?php
class HomePresenter
{
    protected function createComponentContactForm()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`),
          },
          isRequestedRootActive: () => true,
          maxCompletions: 100,
          requestedRoot: ROOT,
          templateRelativePath: "app/UI/Home/default.latte",
          ttlMs: 5000,
        },
        source,
        offset,
        completion!,
      ),
    ).resolves.toContainEqual(
      expect.objectContaining({
        detail: "Nette form field",
        insertText: "email",
        label: "email",
      }),
    );
  });

  it("continues through readable owner candidates until the requested form fields are found", async () => {
    const readFileContent = vi.fn(async (path: string) => {
      if (path.endsWith("ApiConsoleControl.php")) {
        return `<?php
class ApiConsoleControl
{
    protected function createComponentConsoleForm()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
      }

      return `<?php
class ApiConsoleControlPresenter
{
    protected function createComponentOtherForm()
    {
        $form = new Form();
        $form->addText('unrelated', 'Unrelated');
        return $form;
    }
}
`;
    });
    const source = "{form consoleForm}{input em}{/form}";
    const offset = source.indexOf("em") + "em".length;
    const completion = latteFormFieldMacroCompletionAt(source, offset);

    await expect(
      latteFormFieldMacroCompletions(
        {
          componentCache: {},
          deps: { ...deps, readFileContent },
          isRequestedRootActive: () => true,
          maxCompletions: 100,
          requestedRoot: ROOT,
          templateRelativePath:
            "app/modules/apiModule/Components/ApiConsoleControl/api_console.latte",
          ttlMs: 5000,
        },
        source,
        offset,
        completion!,
      ),
    ).resolves.toContainEqual(expect.objectContaining({ label: "email" }));

    expect(readFileContent.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not leak fields from a later owner when the matching form is dynamic", async () => {
    const readFileContent = vi.fn(async (path: string) => {
      if (path.endsWith("ApiConsoleControlPresenter.php")) {
        return `<?php
class ApiConsoleControlPresenter
{
    protected function createComponentConsoleForm()
    {
        return $this->formFactory->create();
    }
}
`;
      }

      return `<?php
class ApiConsoleControl
{
    protected function createComponentConsoleForm()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    });
    const source = "{form consoleForm}{input em}{/form}";
    const offset = source.indexOf("em") + "em".length;
    const completion = latteFormFieldMacroCompletionAt(source, offset);

    await expect(
      latteFormFieldMacroCompletions(
        {
          componentCache: {},
          deps: { ...deps, readFileContent },
          isRequestedRootActive: () => true,
          maxCompletions: 100,
          requestedRoot: ROOT,
          templateRelativePath:
            "app/modules/apiModule/Components/ApiConsoleControl/api_console.latte",
          ttlMs: 5000,
        },
        source,
        offset,
        completion!,
      ),
    ).resolves.toEqual([]);
  });
});

describe("resolveNetteControlDefinition", () => {
  it("opens render part methods before falling back to the factory", async () => {
    const openPhpMethodTarget = vi.fn(async () => true);
    const openTarget = vi.fn(async () => true);

    await expect(
      resolveNetteControlDefinition(
        { ...deps, openPhpMethodTarget, openTarget },
        ROOT,
        () => true,
        { name: "productList", part: "pagination" },
        "app/UI/Home/default.latte",
      ),
    ).resolves.toBe(true);

    expect(openPhpMethodTarget).toHaveBeenCalledWith(
      "ProductListControl",
      "renderPagination",
    );
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("opens form macro component factories", async () => {
    const openTarget = vi.fn(async () => true);
    const source = "{form productList}{/form}";

    await expect(
      resolveNetteControlDefinition(
        { ...deps, openTarget },
        ROOT,
        () => true,
        netteControlReferenceAt(source, source.indexOf("productList") + 2),
        "app/UI/Home/default.latte",
      ),
    ).resolves.toBe(true);

    expect(openTarget).toHaveBeenCalledWith(
      `${ROOT}/app/UI/Home/HomePresenter.php`,
      expect.objectContaining({ lineNumber: 4 }),
      "productList",
    );
  });
});
