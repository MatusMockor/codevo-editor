import { describe, expect, it, vi } from "vitest";
import {
  latteControlCompletions,
  latteControlCompletionAt,
  latteFormFieldMacroCompletionAt,
  latteFormFieldMacroCompletions,
  latteFormNameCompletionAt,
  latteFormNameCompletions,
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

  it("detects label n:name as a field reference inside the active form", () => {
    const source = `<form n:name="contactForm"><label n:name="email">Email</label></form>`;

    expect(netteControlReferenceAt(source, source.indexOf("email") + 2))
      .toEqual({ fieldName: "email", name: "contactForm" });
  });
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

  it("offers literal addComponent names from the template owner", async () => {
    const cache: NetteControlCache = {};

    await expect(
      latteControlCompletions(
        {
          componentCache: cache,
          deps: {
            ...deps,
            readFileContent: vi.fn(async () => `<?php
class PaymentLogsAdminPresenter
{
    public function renderDefault(): void
    {
        $vp = new VisualPaginator();
        $this->addComponent($vp, 'vp');
    }
}
`),
          },
          isRequestedRootActive: () => true,
          maxCompletions: 100,
          requestedRoot: ROOT,
          templateRelativePath:
            "app/modules/efabricaPaymentsModule/templates/PaymentLogsAdmin/default.latte",
          ttlMs: 5000,
        },
        { prefix: "v", replaceEnd: 10, replaceStart: 9 },
      ),
    ).resolves.toContainEqual(
      expect.objectContaining({
        insertText: "vp",
        kind: "component",
        label: "vp",
      }),
    );
  });

  it("offers createComponent names inherited from the parent presenter class", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

use App\\UI\\BasePresenter;

class HomePresenter extends BasePresenter
{
    protected function createComponentLocalList(): LocalListControl
    {
        return new LocalListControl();
    }
}
`;
    const basePresenter = `<?php
namespace App\\UI;

class BasePresenter
{
    protected function createComponentInheritedGrid(): GridControl
    {
        return new GridControl();
    }
}
`;
    const readPhpClassSource = vi.fn(async (className: string) =>
      className === "App\\UI\\BasePresenter"
        ? { path: `${ROOT}/app/UI/BasePresenter.php`, source: basePresenter }
        : null,
    );

    await expect(
      latteControlCompletions(
        {
          componentCache: {},
          deps: {
            ...deps,
            readFileContent: vi.fn(async () => presenter),
            readPhpClassSource,
            resolveDeclaredType: (_source, typeHint) =>
              typeHint === "BasePresenter" ? "App\\UI\\BasePresenter" : typeHint,
          },
          isRequestedRootActive: () => true,
          maxCompletions: 100,
          requestedRoot: ROOT,
          templateRelativePath: "app/UI/Home/default.latte",
          ttlMs: 5000,
        },
        { prefix: "", replaceEnd: 9, replaceStart: 9 },
      ),
    ).resolves.toEqual([
      expect.objectContaining({ label: "inheritedGrid" }),
      expect.objectContaining({ label: "localList" }),
    ]);

    expect(readPhpClassSource).toHaveBeenCalledWith("App\\UI\\BasePresenter");
  });

  it("collects controls from used traits", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

use App\\UI\\Components\\GridTrait;

class HomePresenter
{
    use GridTrait;
}
`;
    const gridTrait = `<?php
namespace App\\UI\\Components;

trait GridTrait
{
    protected function createComponentTraitGrid(): GridControl
    {
        return new GridControl();
    }
}
`;
    const readPhpClassSource = vi.fn(async (className: string) =>
      className === "App\\UI\\Components\\GridTrait"
        ? { path: `${ROOT}/app/UI/Components/GridTrait.php`, source: gridTrait }
        : null,
    );

    await expect(
      latteControlCompletions(
        {
          componentCache: {},
          deps: {
            ...deps,
            readFileContent: vi.fn(async () => presenter),
            readPhpClassSource,
            resolveDeclaredType: (_source, typeHint) =>
              typeHint === "GridTrait"
                ? "App\\UI\\Components\\GridTrait"
                : typeHint,
          },
          isRequestedRootActive: () => true,
          maxCompletions: 100,
          requestedRoot: ROOT,
          templateRelativePath: "app/UI/Home/default.latte",
          ttlMs: 5000,
        },
        { prefix: "trait", replaceEnd: 14, replaceStart: 9 },
      ),
    ).resolves.toEqual([expect.objectContaining({ label: "traitGrid" })]);
  });

  it("does not hang on a cycle in the extends chain", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

class HomePresenter extends LoopPresenter
{
    protected function createComponentLocalList(): LocalListControl
    {
        return new LocalListControl();
    }
}
`;
    const loopPresenter = `<?php
namespace App\\UI\\Home;

class LoopPresenter extends HomePresenter
{
    protected function createComponentLoopGrid(): GridControl
    {
        return new GridControl();
    }
}
`;
    const readPhpClassSource = vi.fn(async (className: string) => {
      if (className === "App\\UI\\Home\\LoopPresenter") {
        return {
          path: `${ROOT}/app/UI/Home/LoopPresenter.php`,
          source: loopPresenter,
        };
      }

      if (className === "App\\UI\\Home\\HomePresenter") {
        return {
          path: `${ROOT}/app/UI/Home/HomePresenter.php`,
          source: presenter,
        };
      }

      return null;
    });

    await expect(
      latteControlCompletions(
        {
          componentCache: {},
          deps: {
            ...deps,
            readFileContent: vi.fn(async () => presenter),
            readPhpClassSource,
            resolveDeclaredType: (_source, typeHint) =>
              typeHint ? `App\\UI\\Home\\${typeHint.replace(/^\\+/, "")}` : typeHint,
          },
          isRequestedRootActive: () => true,
          maxCompletions: 100,
          requestedRoot: ROOT,
          templateRelativePath: "app/UI/Home/default.latte",
          ttlMs: 5000,
        },
        { prefix: "", replaceEnd: 9, replaceStart: 9 },
      ),
    ).resolves.toEqual([
      expect.objectContaining({ label: "localList" }),
      expect.objectContaining({ label: "loopGrid" }),
    ]);

    expect(readPhpClassSource.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("drops inherited results when the requested root goes stale during the ancestor walk", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

class HomePresenter extends BasePresenter
{
    use GridTrait;

    protected function createComponentLocalList(): LocalListControl
    {
        return new LocalListControl();
    }
}
`;
    const basePresenter = `<?php
namespace App\\UI\\Home;

class BasePresenter
{
    protected function createComponentInheritedGrid(): GridControl
    {
        return new GridControl();
    }
}
`;
    const cache: NetteControlCache = {};
    let active = true;
    const readPhpClassSource = vi.fn(async () => {
      active = false;

      return {
        path: `${ROOT}/app/UI/Home/BasePresenter.php`,
        source: basePresenter,
      };
    });

    await expect(
      latteControlCompletions(
        {
          componentCache: cache,
          deps: {
            ...deps,
            readFileContent: vi.fn(async () => presenter),
            readPhpClassSource,
          },
          isRequestedRootActive: () => active,
          maxCompletions: 100,
          requestedRoot: ROOT,
          templateRelativePath: "app/UI/Home/default.latte",
          ttlMs: 5000,
        },
        { prefix: "", replaceEnd: 9, replaceStart: 9 },
      ),
    ).resolves.toEqual([]);

    expect(readPhpClassSource).toHaveBeenCalledTimes(1);
    expect(cache).toEqual({});
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

  it("offers fields from one-hop delegated typed form factories", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

use App\\Forms\\GatewayFormFactory;

class HomePresenter
{
    private GatewayFormFactory $gatewayFormFactory;

    protected function createComponentGatewayForm()
    {
        return $this->gatewayFormFactory->create();
    }
}
`;
    const factory = `<?php
namespace App\\Forms;

class GatewayFormFactory
{
    public function create()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    const readPhpClassSource = vi.fn(async (className: string) =>
      className === "App\\Forms\\GatewayFormFactory"
        ? { path: `${ROOT}/app/Forms/GatewayFormFactory.php`, source: factory }
        : null,
    );
    const source = "{form gatewayForm}{input em}{/form}";
    const offset = source.indexOf("em") + "em".length;
    const completion = latteFormFieldMacroCompletionAt(source, offset);

    await expect(
      latteFormFieldMacroCompletions(
        {
          componentCache: {},
          deps: {
            ...deps,
            readFileContent: vi.fn(async () => presenter),
            readPhpClassSource,
            resolveDeclaredType: (_source, typeHint) =>
              typeHint === "GatewayFormFactory"
                ? "App\\Forms\\GatewayFormFactory"
                : typeHint,
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
    ).resolves.toContainEqual(expect.objectContaining({ label: "email" }));

    expect(readPhpClassSource).toHaveBeenCalledWith(
      "App\\Forms\\GatewayFormFactory",
    );
  });

  it("offers label n:name fields from delegated promoted form factories", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

class HomePresenter
{
    public function __construct(private GatewayFormFactory $gatewayFormFactory)
    {
    }

    protected function createComponentGatewayForm()
    {
        return $this->gatewayFormFactory->create();
    }
}
`;
    const factory = `<?php
class GatewayFormFactory
{
    public function create()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    const source = `<form n:name="gatewayForm"><label n:name="em">Email</label></form>`;
    const offset = source.indexOf("em") + "em".length;
    const completion = latteFormNameCompletionAt(source, offset);

    expect(completion).toEqual({
      prefix: "em",
      replaceEnd: source.indexOf(`">Email`),
      replaceStart: source.indexOf("em"),
    });

    await expect(
      latteFormNameCompletions(
        {
          componentCache: {},
          deps: {
            ...deps,
            readFileContent: vi.fn(async () => presenter),
            readPhpClassSource: vi.fn(async () => ({
              path: `${ROOT}/app/UI/Home/GatewayFormFactory.php`,
              source: factory,
            })),
            resolveDeclaredType: (_source, typeHint) =>
              typeHint === "GatewayFormFactory"
                ? "App\\UI\\Home\\GatewayFormFactory"
                : typeHint,
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
    ).resolves.toContainEqual(expect.objectContaining({ label: "email" }));
  });

  it("offers n:name fields from delegated non-promoted constructor-injected form factories", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

use App\\Forms\\GatewayFormFactory;
use Nette\\Application\\UI\\Form;

class HomePresenter
{
    private $gatewayFormFactory;

    public function __construct(GatewayFormFactory $gatewayFormFactory)
    {
        $this->gatewayFormFactory = $gatewayFormFactory;
    }

    protected function createComponentGatewayForm(): Form
    {
        return $this->gatewayFormFactory->create();
    }
}
`;
    const factory = `<?php
namespace App\\Forms;

use Nette\\Application\\UI\\Form;

class GatewayFormFactory
{
    public function create(): Form
    {
        $form = new Form();
        $form->addText('email', 'Email');
        $form->addPassword('password', 'Password');
        return $form;
    }
}
`;
    const readPhpClassSource = vi.fn(async (className: string) =>
      className === "App\\Forms\\GatewayFormFactory"
        ? { path: `${ROOT}/app/Forms/GatewayFormFactory.php`, source: factory }
        : null,
    );
    const source = `<form n:name="gatewayForm"><input n:name="em"></form>`;
    const offset = source.indexOf("em") + "em".length;
    const completion = latteFormNameCompletionAt(source, offset);

    await expect(
      latteFormNameCompletions(
        {
          componentCache: {},
          deps: {
            ...deps,
            readFileContent: vi.fn(async () => presenter),
            readPhpClassSource,
            resolveDeclaredType: (_source, typeHint) =>
              typeHint === "GatewayFormFactory"
                ? "App\\Forms\\GatewayFormFactory"
                : typeHint,
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
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: "Nette form field",
          insertText: "email",
          label: "email",
        }),
      ]),
    );

    expect(readPhpClassSource).toHaveBeenCalledWith(
      "App\\Forms\\GatewayFormFactory",
    );
  });

  it("offers n:name fields from NEON service-typed delegated form factories", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

class HomePresenter
{
    private $gatewayFormFactory;

    protected function createComponentGatewayForm()
    {
        return $this->gatewayFormFactory->create();
    }
}
`;
    const factory = `<?php
namespace App\\Forms;

class GatewayFormFactory
{
    public function create()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    const readPhpClassSource = vi.fn(async (className: string) =>
      className === "App\\Forms\\GatewayFormFactory"
        ? { path: `${ROOT}/app/Forms/GatewayFormFactory.php`, source: factory }
        : null,
    );
    const source = `<form n:name="gatewayForm"><input n:name="em"></form>`;
    const offset = source.indexOf("em") + "em".length;
    const completion = latteFormNameCompletionAt(source, offset);

    await expect(
      latteFormNameCompletions(
        {
          componentCache: {},
          deps: {
            ...deps,
            readFileContent: vi.fn(async () => presenter),
            readPhpClassSource,
          },
          isRequestedRootActive: () => true,
          loadProjectConfig: vi.fn(async () => ({
            serviceAliases: new Map(),
            serviceNameTypes: new Map([
              ["gatewayFormFactory", "App\\Forms\\GatewayFormFactory"],
            ]),
          })),
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

    expect(readPhpClassSource).toHaveBeenCalledWith(
      "App\\Forms\\GatewayFormFactory",
    );
  });

  it("offers n:name fields from NEON alias-typed delegated form factories", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

class HomePresenter
{
    private $gatewayFormFactory;

    protected function createComponentGatewayForm()
    {
        return $this->gatewayFormFactory->create();
    }
}
`;
    const factory = `<?php
namespace App\\Forms;

class GatewayFormFactory
{
    public function create()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    const readPhpClassSource = vi.fn(async (className: string) =>
      className === "App\\Forms\\GatewayFormFactory"
        ? { path: `${ROOT}/app/Forms/GatewayFormFactory.php`, source: factory }
        : null,
    );
    const source = `<form n:name="gatewayForm"><input n:name="em"></form>`;
    const offset = source.indexOf("em") + "em".length;
    const completion = latteFormNameCompletionAt(source, offset);

    await expect(
      latteFormNameCompletions(
        {
          componentCache: {},
          deps: {
            ...deps,
            readFileContent: vi.fn(async () => presenter),
            readPhpClassSource,
          },
          isRequestedRootActive: () => true,
          loadProjectConfig: vi.fn(async () => ({
            serviceAliases: new Map([["gatewayFormFactory", "realGatewayFactory"]]),
            serviceNameTypes: new Map([
              ["realGatewayFactory", "App\\Forms\\GatewayFormFactory"],
            ]),
          })),
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

  it("offers form fields defined by a factory in the parent presenter class", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

use App\\UI\\BasePresenter;

class HomePresenter extends BasePresenter
{
}
`;
    const basePresenter = `<?php
namespace App\\UI;

class BasePresenter
{
    protected function createComponentContactForm()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    const readPhpClassSource = vi.fn(async (className: string) =>
      className === "App\\UI\\BasePresenter"
        ? { path: `${ROOT}/app/UI/BasePresenter.php`, source: basePresenter }
        : null,
    );
    const source = "{form contactForm}{input em}{/form}";
    const offset = source.indexOf("em") + "em".length;
    const completion = latteFormFieldMacroCompletionAt(source, offset);

    await expect(
      latteFormFieldMacroCompletions(
        {
          componentCache: {},
          deps: {
            ...deps,
            readFileContent: vi.fn(async () => presenter),
            readPhpClassSource,
            resolveDeclaredType: (_source, typeHint) =>
              typeHint === "BasePresenter" ? "App\\UI\\BasePresenter" : typeHint,
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

    expect(readPhpClassSource).toHaveBeenCalledWith("App\\UI\\BasePresenter");
  });

  it("offers form fields from a factory declared in a used trait", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

use App\\UI\\Components\\FormTrait;

class HomePresenter
{
    use FormTrait;
}
`;
    const formTrait = `<?php
namespace App\\UI\\Components;

trait FormTrait
{
    protected function createComponentContactForm()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    const readPhpClassSource = vi.fn(async (className: string) =>
      className === "App\\UI\\Components\\FormTrait"
        ? { path: `${ROOT}/app/UI/Components/FormTrait.php`, source: formTrait }
        : null,
    );
    const source = "{form contactForm}{input em}{/form}";
    const offset = source.indexOf("em") + "em".length;
    const completion = latteFormFieldMacroCompletionAt(source, offset);

    await expect(
      latteFormFieldMacroCompletions(
        {
          componentCache: {},
          deps: {
            ...deps,
            readFileContent: vi.fn(async () => presenter),
            readPhpClassSource,
            resolveDeclaredType: (_source, typeHint) =>
              typeHint === "FormTrait"
                ? "App\\UI\\Components\\FormTrait"
                : typeHint,
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
    ).resolves.toContainEqual(expect.objectContaining({ label: "email" }));
  });

  it("prefers a trait factory over a parent factory for the same component", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

use App\\UI\\Components\\FormTrait;
use App\\UI\\BasePresenter;

class HomePresenter extends BasePresenter
{
    use FormTrait;
}
`;
    const formTrait = `<?php
namespace App\\UI\\Components;

trait FormTrait
{
    protected function createComponentContactForm()
    {
        $form = new Form();
        $form->addText('traitEmail', 'Email');
        return $form;
    }
}
`;
    const basePresenter = `<?php
namespace App\\UI;

class BasePresenter
{
    protected function createComponentContactForm()
    {
        $form = new Form();
        $form->addText('parentEmail', 'Email');
        return $form;
    }
}
`;
    const readPhpClassSource = vi.fn(async (className: string) => {
      if (className === "App\\UI\\Components\\FormTrait") {
        return {
          path: `${ROOT}/app/UI/Components/FormTrait.php`,
          source: formTrait,
        };
      }

      if (className === "App\\UI\\BasePresenter") {
        return {
          path: `${ROOT}/app/UI/BasePresenter.php`,
          source: basePresenter,
        };
      }

      return null;
    });
    const source = "{form contactForm}{input tr}{/form}";
    const offset = source.indexOf("tr}") + "tr".length;
    const completion = latteFormFieldMacroCompletionAt(source, offset);
    const fields = await latteFormFieldMacroCompletions(
      {
        componentCache: {},
        deps: {
          ...deps,
          readFileContent: vi.fn(async () => presenter),
          readPhpClassSource,
          resolveDeclaredType: (_source, typeHint) => {
            if (typeHint === "FormTrait") {
              return "App\\UI\\Components\\FormTrait";
            }

            if (typeHint === "BasePresenter") {
              return "App\\UI\\BasePresenter";
            }

            return typeHint;
          },
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
    );

    expect(fields).toContainEqual(
      expect.objectContaining({ label: "traitEmail" }),
    );
    expect(fields).not.toContainEqual(
      expect.objectContaining({ label: "parentEmail" }),
    );
  });

  it("does not hang on a cycle when collecting inherited form fields", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

class HomePresenter extends LoopPresenter
{
}
`;
    const loopPresenter = `<?php
namespace App\\UI\\Home;

class LoopPresenter extends HomePresenter
{
    protected function createComponentContactForm()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    const readPhpClassSource = vi.fn(async (className: string) => {
      if (className === "App\\UI\\Home\\LoopPresenter") {
        return {
          path: `${ROOT}/app/UI/Home/LoopPresenter.php`,
          source: loopPresenter,
        };
      }

      if (className === "App\\UI\\Home\\HomePresenter") {
        return {
          path: `${ROOT}/app/UI/Home/HomePresenter.php`,
          source: presenter,
        };
      }

      return null;
    });
    const source = "{form contactForm}{input em}{/form}";
    const offset = source.indexOf("em") + "em".length;
    const completion = latteFormFieldMacroCompletionAt(source, offset);

    await expect(
      latteFormFieldMacroCompletions(
        {
          componentCache: {},
          deps: {
            ...deps,
            readFileContent: vi.fn(async () => presenter),
            readPhpClassSource,
            resolveDeclaredType: (_source, typeHint) =>
              typeHint ? `App\\UI\\Home\\${typeHint.replace(/^\\+/, "")}` : typeHint,
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
    ).resolves.toContainEqual(expect.objectContaining({ label: "email" }));

    expect(readPhpClassSource.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("drops inherited form fields when the requested root goes stale during the ancestor walk", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

class HomePresenter extends BasePresenter
{
}
`;
    const basePresenter = `<?php
namespace App\\UI\\Home;

class BasePresenter
{
    protected function createComponentContactForm()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    const cache: NetteControlCache = {};
    let active = true;
    const readPhpClassSource = vi.fn(async () => {
      active = false;

      return {
        path: `${ROOT}/app/UI/Home/BasePresenter.php`,
        source: basePresenter,
      };
    });
    const source = "{form contactForm}{input em}{/form}";
    const offset = source.indexOf("em") + "em".length;
    const completion = latteFormFieldMacroCompletionAt(source, offset);

    await expect(
      latteFormFieldMacroCompletions(
        {
          componentCache: cache,
          deps: {
            ...deps,
            readFileContent: vi.fn(async () => presenter),
            readPhpClassSource,
          },
          isRequestedRootActive: () => active,
          maxCompletions: 100,
          requestedRoot: ROOT,
          templateRelativePath: "app/UI/Home/default.latte",
          ttlMs: 5000,
        },
        source,
        offset,
        completion!,
      ),
    ).resolves.toEqual([]);

    expect(readPhpClassSource).toHaveBeenCalledTimes(1);
    expect(cache).toEqual({});
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

  it("opens literal addComponent registrations when no createComponent factory exists", async () => {
    const openTarget = vi.fn(async () => true);
    const presenter = `<?php
class PaymentLogsAdminPresenter
{
    public function renderDefault(): void
    {
        $vp = new VisualPaginator();
        $this->addComponent($vp, 'vp');
    }
}
`;
    const source = "{control vp}";

    await expect(
      resolveNetteControlDefinition(
        {
          ...deps,
          openTarget,
          readFileContent: vi.fn(async () => presenter),
        },
        ROOT,
        () => true,
        netteControlReferenceAt(source, source.indexOf("vp") + 1),
        "app/modules/efabricaPaymentsModule/templates/PaymentLogsAdmin/default.latte",
      ),
    ).resolves.toBe(true);

    expect(openTarget).toHaveBeenCalledWith(
      `${ROOT}/app/modules/efabricaPaymentsModule/Presenters/PaymentLogsAdminPresenter.php`,
      expect.objectContaining({ lineNumber: 7 }),
      "vp",
    );
  });

  it("keeps createComponent definitions ahead of literal addComponent registrations", async () => {
    const openTarget = vi.fn(async () => true);
    const presenter = `<?php
class HomePresenter
{
    protected function createComponentVp(): VisualPaginator
    {
        return new VisualPaginator();
    }

    public function renderDefault(): void
    {
        $vp = new VisualPaginator();
        $this->addComponent($vp, 'vp');
    }
}
`;
    const source = "{control vp}";

    await expect(
      resolveNetteControlDefinition(
        {
          ...deps,
          openTarget,
          readFileContent: vi.fn(async () => presenter),
        },
        ROOT,
        () => true,
        netteControlReferenceAt(source, source.indexOf("vp") + 1),
        "app/UI/Home/default.latte",
      ),
    ).resolves.toBe(true);

    expect(openTarget).toHaveBeenCalledWith(
      `${ROOT}/app/UI/Home/HomePresenter.php`,
      expect.objectContaining({ lineNumber: 4 }),
      "vp",
    );
  });

  it("navigates {control inheritedGrid} to createComponentInheritedGrid in the parent class file", async () => {
    const openTarget = vi.fn(async () => true);
    const presenter = `<?php
namespace App\\UI\\Home;

use App\\UI\\BasePresenter;

class HomePresenter extends BasePresenter
{
}
`;
    const basePresenter = `<?php
namespace App\\UI;

class BasePresenter
{
    protected function createComponentInheritedGrid(): GridControl
    {
        return new GridControl();
    }
}
`;
    const source = "{control inheritedGrid}";

    await expect(
      resolveNetteControlDefinition(
        {
          ...deps,
          openTarget,
          readFileContent: vi.fn(async () => presenter),
          readPhpClassSource: vi.fn(async (className: string) =>
            className === "App\\UI\\BasePresenter"
              ? { path: `${ROOT}/app/UI/BasePresenter.php`, source: basePresenter }
              : null,
          ),
          resolveDeclaredType: (_source, typeHint) =>
            typeHint === "BasePresenter" ? "App\\UI\\BasePresenter" : typeHint,
        },
        ROOT,
        () => true,
        netteControlReferenceAt(source, source.indexOf("inheritedGrid") + 2),
        "app/UI/Home/default.latte",
      ),
    ).resolves.toBe(true);

    expect(openTarget).toHaveBeenCalledWith(
      `${ROOT}/app/UI/BasePresenter.php`,
      expect.objectContaining({ lineNumber: 6 }),
      "inheritedGrid",
    );
  });

  it("navigates {control traitGrid} to the addComponent registration in a used trait", async () => {
    const openTarget = vi.fn(async () => true);
    const presenter = `<?php
namespace App\\UI\\Home;

use App\\UI\\Components\\GridTrait;

class HomePresenter
{
    use GridTrait;
}
`;
    const gridTrait = `<?php
namespace App\\UI\\Components;

trait GridTrait
{
    public function attachGrid(): void
    {
        $grid = new GridControl();
        $this->addComponent($grid, 'traitGrid');
    }
}
`;
    const source = "{control traitGrid}";

    await expect(
      resolveNetteControlDefinition(
        {
          ...deps,
          openTarget,
          readFileContent: vi.fn(async () => presenter),
          readPhpClassSource: vi.fn(async (className: string) =>
            className === "App\\UI\\Components\\GridTrait"
              ? {
                  path: `${ROOT}/app/UI/Components/GridTrait.php`,
                  source: gridTrait,
                }
              : null,
          ),
          resolveDeclaredType: (_source, typeHint) =>
            typeHint === "GridTrait"
              ? "App\\UI\\Components\\GridTrait"
              : typeHint,
        },
        ROOT,
        () => true,
        netteControlReferenceAt(source, source.indexOf("traitGrid") + 2),
        "app/UI/Home/default.latte",
      ),
    ).resolves.toBe(true);

    expect(openTarget).toHaveBeenCalledWith(
      `${ROOT}/app/UI/Components/GridTrait.php`,
      expect.objectContaining({ lineNumber: 9 }),
      "traitGrid",
    );
  });

  it("does not navigate to ancestors when the requested root goes stale during the walk", async () => {
    const openTarget = vi.fn(async () => true);
    const presenter = `<?php
namespace App\\UI\\Home;

class HomePresenter extends BasePresenter
{
    use GridTrait;
}
`;
    const basePresenter = `<?php
namespace App\\UI\\Home;

class BasePresenter
{
    protected function createComponentInheritedGrid(): GridControl
    {
        return new GridControl();
    }
}
`;
    let active = true;
    const source = "{control inheritedGrid}";
    const readPhpClassSource = vi.fn(async () => {
      active = false;

      return {
        path: `${ROOT}/app/UI/Home/BasePresenter.php`,
        source: basePresenter,
      };
    });

    await expect(
      resolveNetteControlDefinition(
        {
          ...deps,
          openTarget,
          readFileContent: vi.fn(async () => presenter),
          readPhpClassSource,
        },
        ROOT,
        () => active,
        netteControlReferenceAt(source, source.indexOf("inheritedGrid") + 2),
        "app/UI/Home/default.latte",
      ),
    ).resolves.toBe(false);

    expect(readPhpClassSource).toHaveBeenCalledTimes(1);
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("opens delegated factory field definitions from label n:name", async () => {
    const openTarget = vi.fn(async () => true);
    const presenter = `<?php
namespace App\\UI\\Home;

class HomePresenter
{
    public function __construct(private GatewayFormFactory $gatewayFormFactory)
    {
    }

    protected function createComponentGatewayForm()
    {
        return $this->gatewayFormFactory->create();
    }
}
`;
    const factory = `<?php
namespace App\\Forms;

class GatewayFormFactory
{
    public function create()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    const source = `<form n:name="gatewayForm"><label n:name="email">Email</label></form>`;

    await expect(
      resolveNetteControlDefinition(
        {
          ...deps,
          openTarget,
          readFileContent: vi.fn(async () => presenter),
          readPhpClassSource: vi.fn(async () => ({
            path: `${ROOT}/app/Forms/GatewayFormFactory.php`,
            source: factory,
          })),
          resolveDeclaredType: (_source, typeHint) =>
            typeHint === "GatewayFormFactory"
              ? "App\\Forms\\GatewayFormFactory"
              : typeHint,
        },
        ROOT,
        () => true,
        netteControlReferenceAt(source, source.indexOf("email") + 2),
        "app/UI/Home/default.latte",
      ),
    ).resolves.toBe(true);

    expect(openTarget).toHaveBeenCalledWith(
      `${ROOT}/app/Forms/GatewayFormFactory.php`,
      expect.objectContaining({ lineNumber: 9 }),
      "email",
    );
  });

  it("opens delegated non-promoted constructor-injected factory field definitions from n:name", async () => {
    const openTarget = vi.fn(async () => true);
    const presenter = `<?php
namespace App\\UI\\Home;

use App\\Forms\\GatewayFormFactory;
use Nette\\Application\\UI\\Form;

class HomePresenter
{
    private $gatewayFormFactory;

    public function __construct(GatewayFormFactory $gatewayFormFactory)
    {
        $this->gatewayFormFactory = $gatewayFormFactory;
    }

    protected function createComponentGatewayForm(): Form
    {
        return $this->gatewayFormFactory->create();
    }
}
`;
    const factory = `<?php
namespace App\\Forms;

use Nette\\Application\\UI\\Form;

class GatewayFormFactory
{
    public function create(): Form
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    const source = `<form n:name="gatewayForm"><input n:name="email"></form>`;

    await expect(
      resolveNetteControlDefinition(
        {
          ...deps,
          openTarget,
          readFileContent: vi.fn(async () => presenter),
          readPhpClassSource: vi.fn(async (className: string) =>
            className === "App\\Forms\\GatewayFormFactory"
              ? { path: `${ROOT}/app/Forms/GatewayFormFactory.php`, source: factory }
              : null,
          ),
          resolveDeclaredType: (_source, typeHint) =>
            typeHint === "GatewayFormFactory"
              ? "App\\Forms\\GatewayFormFactory"
              : typeHint,
        },
        ROOT,
        () => true,
        netteControlReferenceAt(source, source.indexOf("email") + 2),
        "app/UI/Home/default.latte",
      ),
    ).resolves.toBe(true);

    expect(openTarget).toHaveBeenCalledWith(
      `${ROOT}/app/Forms/GatewayFormFactory.php`,
      expect.objectContaining({ lineNumber: 11 }),
      "email",
    );
  });

  it("opens n:name field definitions from NEON service-typed delegated form factories", async () => {
    const openTarget = vi.fn(async () => true);
    const presenter = `<?php
namespace App\\UI\\Home;

class HomePresenter
{
    private $gatewayFormFactory;

    protected function createComponentGatewayForm()
    {
        return $this->gatewayFormFactory->create();
    }
}
`;
    const factory = `<?php
namespace App\\Forms;

class GatewayFormFactory
{
    public function create()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    const testDeps = {
      ...deps,
      openTarget,
      readFileContent: vi.fn(async () => presenter),
      readPhpClassSource: vi.fn(async (className: string) =>
        className === "App\\Forms\\GatewayFormFactory"
          ? { path: `${ROOT}/app/Forms/GatewayFormFactory.php`, source: factory }
          : null,
      ),
    };
    const source = `<form n:name="gatewayForm"><label n:name="email">Email</label></form>`;

    await expect(
      resolveNetteControlDefinition(
        testDeps,
        ROOT,
        () => true,
        netteControlReferenceAt(source, source.indexOf("email") + 2),
        "app/UI/Home/default.latte",
        {
          componentCache: {},
          deps: testDeps,
          isRequestedRootActive: () => true,
          loadProjectConfig: vi.fn(async () => ({
            serviceAliases: new Map(),
            serviceNameTypes: new Map([
              ["gatewayFormFactory", "App\\Forms\\GatewayFormFactory"],
            ]),
          })),
          maxCompletions: 100,
          requestedRoot: ROOT,
          templateRelativePath: "app/UI/Home/default.latte",
          ttlMs: 5000,
        },
      ),
    ).resolves.toBe(true);

    expect(openTarget).toHaveBeenCalledWith(
      `${ROOT}/app/Forms/GatewayFormFactory.php`,
      expect.objectContaining({ lineNumber: 9 }),
      "email",
    );
  });

  it("navigates {input email} to the addText declaration in the ancestor class file", async () => {
    const openTarget = vi.fn(async () => true);
    const presenter = `<?php
namespace App\\UI\\Home;

use App\\UI\\BasePresenter;

class HomePresenter extends BasePresenter
{
}
`;
    const basePresenter = `<?php
namespace App\\UI;

class BasePresenter
{
    protected function createComponentContactForm()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    const readPhpClassSource = vi.fn(async (className: string) =>
      className === "App\\UI\\BasePresenter"
        ? { path: `${ROOT}/app/UI/BasePresenter.php`, source: basePresenter }
        : null,
    );
    const source = "{form contactForm}{input email}{/form}";

    await expect(
      resolveNetteControlDefinition(
        {
          ...deps,
          openTarget,
          readFileContent: vi.fn(async () => presenter),
          readPhpClassSource,
          resolveDeclaredType: (_source, typeHint) =>
            typeHint === "BasePresenter" ? "App\\UI\\BasePresenter" : typeHint,
        },
        ROOT,
        () => true,
        netteControlReferenceAt(source, source.indexOf("email") + 2),
        "app/UI/Home/default.latte",
      ),
    ).resolves.toBe(true);

    expect(openTarget).toHaveBeenCalledWith(
      `${ROOT}/app/UI/BasePresenter.php`,
      expect.objectContaining({ lineNumber: 9 }),
      "email",
    );
  });

  it("does not navigate to inherited form fields when the requested root goes stale during the ancestor walk", async () => {
    const openTarget = vi.fn(async () => true);
    const presenter = `<?php
namespace App\\UI\\Home;

class HomePresenter extends BasePresenter
{
}
`;
    const basePresenter = `<?php
namespace App\\UI\\Home;

class BasePresenter
{
    protected function createComponentContactForm()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    let active = true;
    const readPhpClassSource = vi.fn(async () => {
      active = false;

      return {
        path: `${ROOT}/app/UI/Home/BasePresenter.php`,
        source: basePresenter,
      };
    });
    const source = "{form contactForm}{input email}{/form}";

    await expect(
      resolveNetteControlDefinition(
        {
          ...deps,
          openTarget,
          readFileContent: vi.fn(async () => presenter),
          readPhpClassSource,
        },
        ROOT,
        () => active,
        netteControlReferenceAt(source, source.indexOf("email") + 2),
        "app/UI/Home/default.latte",
      ),
    ).resolves.toBe(false);

    expect(readPhpClassSource).toHaveBeenCalledTimes(1);
    expect(openTarget).not.toHaveBeenCalled();
  });
});
