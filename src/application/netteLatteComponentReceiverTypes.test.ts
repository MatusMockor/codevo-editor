import { describe, expect, it, vi } from "vitest";
import {
  resolveNetteLatteComponentReceiverType,
  type NetteLatteComponentReceiverTypeContext,
} from "./netteLatteComponentReceiverTypes";

const TEMPLATE_PATH =
  "app/modules/apiModule/templates/ApiTokensAdmin/show.latte";
const PRESENTER_PATH =
  "app/modules/apiModule/Presenters/ApiTokensAdminPresenter.php";

describe("resolveNetteLatteComponentReceiverType", () => {
  it("resolves a static delegated Form field to its concrete Nette control", async () => {
    const root = "/workspace";
    const factoryClass = "App\\Forms\\ApiTokenMetaFormFactory";
    const context = receiverContext(root, {
      [`${root}/${PRESENTER_PATH}`]: presenterSource(),
    }, {
      [factoryClass]: factorySource("$form->addText('key');"),
    });

    await expect(
      resolveNetteLatteComponentReceiverType(
        context,
        `$control["apiTokenMetaForm"]['key']`,
      ),
    ).resolves.toBe("Nette\\Forms\\Controls\\TextInput");
  });

  it.each([
    `$control[$component]['key']`,
    `$control['apiTokenMetaForm'][$field]`,
    `$control['apiTokenMetaForm']['key']['nested']`,
    `$other['apiTokenMetaForm']['key']`,
  ])("rejects non-static or non-control receiver %s", async (receiver) => {
    const context = receiverContext("/workspace", {});

    await expect(
      resolveNetteLatteComponentReceiverType(context, receiver),
    ).resolves.toBeNull();
    expect(context.deps.readFileContent).not.toHaveBeenCalled();
  });

  it("keeps unknown fields and custom builders untyped", async () => {
    const root = "/workspace";
    const factoryClass = "App\\Forms\\ApiTokenMetaFormFactory";
    const context = receiverContext(root, {
      [`${root}/${PRESENTER_PATH}`]: presenterSource(),
    }, {
      [factoryClass]: factorySource("$form->addCustomWidget('custom');"),
    });

    await expect(
      resolveNetteLatteComponentReceiverType(
        context,
        `$control['apiTokenMetaForm']['missing']`,
      ),
    ).resolves.toBeNull();
    await expect(
      resolveNetteLatteComponentReceiverType(
        context,
        `$control['apiTokenMetaForm']['custom']`,
      ),
    ).resolves.toBeNull();
  });

  it("finds fields declared by an inherited factory create method", async () => {
    const root = "/workspace";
    const childClass = "App\\Forms\\ApiTokenMetaFormFactory";
    const baseClass = "App\\Forms\\BaseFactory";
    const context = receiverContext(root, {
      [`${root}/${PRESENTER_PATH}`]: presenterSource(),
    }, {
      [baseClass]: baseFactorySource(),
      [childClass]: childFactorySource(),
    });

    await expect(
      resolveNetteLatteComponentReceiverType(
        context,
        `$control['apiTokenMetaForm']['key']`,
      ),
    ).resolves.toBe("Nette\\Forms\\Controls\\TextInput");
    expect(context.deps.readPhpClassSource).toHaveBeenNthCalledWith(
      1,
      childClass,
    );
    expect(context.deps.readPhpClassSource).toHaveBeenNthCalledWith(
      2,
      baseClass,
    );
  });

  it("drops an inherited field when the root switches during the parent read", async () => {
    const root = "/workspace-a";
    const currentRoot = { value: root };
    const childClass = "App\\Forms\\ApiTokenMetaFormFactory";
    const baseClass = "App\\Forms\\BaseFactory";
    const context = receiverContext(root, {
      [`${root}/${PRESENTER_PATH}`]: presenterSource(),
    }, {
      [baseClass]: baseFactorySource(),
      [childClass]: childFactorySource(),
    });
    const factorySources: Record<string, string> = {
      [baseClass]: baseFactorySource(),
      [childClass]: childFactorySource(),
    };
    const readPhpClassSource = vi.mocked(context.deps.readPhpClassSource!);
    context.isRequestedRootActive = () => currentRoot.value === root;
    readPhpClassSource.mockImplementation(async (className) => {
      if (className === baseClass) {
        currentRoot.value = "/workspace-b";
      }

      const source = factorySources[className];

      return source ? { path: `${root}/${className}.php`, source } : null;
    });

    await expect(
      resolveNetteLatteComponentReceiverType(
        context,
        `$control['apiTokenMetaForm']['key']`,
      ),
    ).resolves.toBeNull();
    expect(readPhpClassSource).toHaveBeenCalledWith(baseClass);
  });

  it("drops a receiver type when the requested root switches during discovery", async () => {
    const root = "/workspace-a";
    const currentRoot = { value: root };
    const context = receiverContext(root, {
      [`${root}/${PRESENTER_PATH}`]: presenterSource(),
    });
    context.isRequestedRootActive = () => currentRoot.value === root;
    vi.mocked(context.deps.readFileContent).mockImplementation(async (path) => {
      currentRoot.value = "/workspace-b";

      if (path === `${root}/${PRESENTER_PATH}`) {
        return presenterSource();
      }

      throw new Error(`missing ${path}`);
    });

    await expect(
      resolveNetteLatteComponentReceiverType(
        context,
        `$control['apiTokenMetaForm']['key']`,
      ),
    ).resolves.toBeNull();
    expect(context.deps.readPhpClassSource).not.toHaveBeenCalled();
  });
});

function receiverContext(
  root: string,
  files: Record<string, string>,
  classes: Record<string, string> = {},
): NetteLatteComponentReceiverTypeContext {
  return {
    deps: {
      joinPath: (rootPath, relativePath) => `${rootPath}/${relativePath}`,
      openPhpMethodTarget: vi.fn(async () => false),
      openTarget: vi.fn(async () => false),
      readFileContent: vi.fn(async (path) => {
        const source = files[path];

        if (!source) {
          throw new Error(`missing ${path}`);
        }

        return source;
      }),
      readPhpClassSource: vi.fn(async (className) => {
        const source = classes[className];

        return source ? { path: `${root}/${className}.php`, source } : null;
      }),
      resolveDeclaredType: (_source, typeHint) =>
        typeHint === "ApiTokenMetaFormFactory"
          ? "App\\Forms\\ApiTokenMetaFormFactory"
          : typeHint,
    },
    isRequestedRootActive: () => true,
    requestedRoot: root,
    templateRelativePath: TEMPLATE_PATH,
  };
}

function presenterSource(): string {
  return `<?php
namespace App\\Presenters;
use App\\Forms\\ApiTokenMetaFormFactory;

class ApiTokensAdminPresenter
{
    public ApiTokenMetaFormFactory $apiTokenMetaFormFactory;

    protected function createComponentApiTokenMetaForm(): Form
    {
        return $this->apiTokenMetaFormFactory->create($this->apiToken);
    }
}`;
}

function factorySource(fieldStatement: string): string {
  return `<?php
namespace App\\Forms;
use Nette\\Application\\UI\\Form;

class ApiTokenMetaFormFactory
{
    public function create(): Form
    {
        $form = new Form();
        ${fieldStatement}
        return $form;
    }
}`;
}

function childFactorySource(): string {
  return `<?php
namespace App\\Forms;
class ApiTokenMetaFormFactory extends \\App\\Forms\\BaseFactory
{
}`;
}

function baseFactorySource(): string {
  return `<?php
namespace App\\Forms;
use Nette\\Application\\UI\\Form;
class BaseFactory
{
    public function create(): Form
    {
        $form = new Form();
        $form->addText('key');
        return $form;
    }
}`;
}
