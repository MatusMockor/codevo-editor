import { describe, expect, it } from "vitest";
import {
  detectLatteControlAt,
  detectLatteFormFieldMacroAt,
  detectLatteFormFieldMacroCompletionAt,
  detectLatteFormMacroAt,
  detectLatteFormMacroCompletionAt,
  detectLatteFormNameAt,
  detectLatteFormNameCompletionAt,
  detectNetteCreateComponentAt,
  latteActiveFormComponentAt,
  netteAddComponentRegistrations,
  netteComponentAncestorReferences,
  netteComponentClassFromCreateMethod,
  netteDelegatedFormFactoryInCreateComponent,
  netteCreateComponentFactoryContextAt,
  netteCreateComponentFactoryContexts,
  netteComponentUsagesInLatte,
  netteCreateComponentMethodName,
  netteFormFieldDefinitionsInCreateComponent,
  netteFormFieldDefinitionsInFactoryCreateMethod,
  netteMethodParameterFormFactoryInCreateComponent,
  nettePresenterLifecycleInfo,
} from "./netteComponents";

/**
 * Returns the offset of the FIRST occurrence of `needle` in `source`, advanced
 * by `withinOffset` characters so a test can target a precise cursor position.
 */
function offsetOf(source: string, needle: string, withinOffset = 0): number {
  const index = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`needle not found in source: ${needle}`);
  }

  return index + withinOffset;
}

describe("detectLatteControlAt", () => {
  it("detects {control contactForm} on the name", () => {
    const source = "<div>{control contactForm}</div>";
    const offset = offsetOf(source, "contactForm", 3);

    expect(detectLatteControlAt(source, offset)).toEqual({
      name: "contactForm",
      nameStart: source.indexOf("contactForm"),
      nameEnd: source.indexOf("contactForm") + "contactForm".length,
    });
  });

  it("captures the base name AND the render part of {control x:part}", () => {
    const source = "{control productList:pagination}";
    const offset = offsetOf(source, "productList", 2);

    const result = detectLatteControlAt(source, offset);

    expect(result?.name).toBe("productList");
    expect(result?.part).toBe("pagination");
    expect(result?.nameStart).toBe(source.indexOf("productList"));
    expect(result?.nameEnd).toBe(source.indexOf("productList") + "productList".length);
  });

  it("still resolves the base name when the cursor is on the part", () => {
    const source = "{control productList:pagination}";
    const offset = offsetOf(source, "pagination", 2);

    const result = detectLatteControlAt(source, offset);

    expect(result?.name).toBe("productList");
    expect(result?.part).toBe("pagination");
  });

  it("captures trailing arguments after the control name", () => {
    const source = "{control productList $page}";
    const offset = offsetOf(source, "productList", 2);

    const result = detectLatteControlAt(source, offset);

    expect(result?.name).toBe("productList");
    expect(result?.args).toBe("$page");
  });

  it("detects a quoted static {control 'contactForm'} name", () => {
    const source = "{control 'contactForm'}";
    const offset = offsetOf(source, "contactForm", 3);

    expect(detectLatteControlAt(source, offset)).toEqual({
      name: "contactForm",
      nameStart: source.indexOf("contactForm"),
      nameEnd: source.indexOf("contactForm") + "contactForm".length,
    });
  });

  it("returns null for a dynamic {control $dynamic}", () => {
    const source = "{control $dynamic}";
    const offset = offsetOf(source, "dynamic", 2);

    expect(detectLatteControlAt(source, offset)).toBeNull();
  });

  it("returns null when the cursor is on the tag keyword, not the name", () => {
    const source = "{control contactForm}";
    const offset = offsetOf(source, "control", 2);

    expect(detectLatteControlAt(source, offset)).toBeNull();
  });

  it("returns null for a {control} inside a Latte comment", () => {
    const source = "{* {control contactForm} *}";
    const offset = offsetOf(source, "contactForm", 3);

    expect(detectLatteControlAt(source, offset)).toBeNull();
  });

  it("returns null outside any control tag", () => {
    const source = "plain text";

    expect(detectLatteControlAt(source, 3)).toBeNull();
  });

  it("stays bounded on a very large document", () => {
    const source = `${"x".repeat(200000)}{control contactForm}`;
    const offset = offsetOf(source, "contactForm", 3);

    expect(detectLatteControlAt(source, offset)?.name).toBe("contactForm");
  });
});

describe("detectLatteFormNameAt", () => {
  it("detects a <form n:name> as a component name", () => {
    const source = '<form n:name="contactForm"></form>';
    const offset = offsetOf(source, "contactForm", 3);

    expect(detectLatteFormNameAt(source, offset)).toEqual({
      name: "contactForm",
      nameStart: source.indexOf("contactForm"),
      nameEnd: source.indexOf("contactForm") + "contactForm".length,
      elementTag: "form",
    });
  });

  it("detects an <input n:name> as a field name (element tag input)", () => {
    const source = '<input n:name="email" type="text">';
    const offset = offsetOf(source, "email", 2);

    const result = detectLatteFormNameAt(source, offset);

    expect(result?.name).toBe("email");
    expect(result?.elementTag).toBe("input");
  });

  it("supports single-quoted n:name values", () => {
    const source = "<form n:name='signIn'>";
    const offset = offsetOf(source, "signIn", 2);

    expect(detectLatteFormNameAt(source, offset)?.name).toBe("signIn");
  });

  it("supports unquoted n:name values", () => {
    const source = "<form n:name=contactForm >";
    const offset = offsetOf(source, "contactForm", 3);

    const result = detectLatteFormNameAt(source, offset);

    expect(result?.name).toBe("contactForm");
    expect(result?.elementTag).toBe("form");
  });

  it("returns null for the data-n:name lookalike attribute", () => {
    const source = '<div data-n:name="nope"></div>';
    const offset = offsetOf(source, "nope", 2);

    expect(detectLatteFormNameAt(source, offset)).toBeNull();
  });

  it("returns null for a dynamic n:name value", () => {
    const source = '<form n:name="$form"></form>';
    const offset = offsetOf(source, "$form", 2);

    expect(detectLatteFormNameAt(source, offset)).toBeNull();
  });

  it("returns null when the n:name sits inside a Latte comment", () => {
    const source = '{* <form n:name="contactForm"> *}';
    const offset = offsetOf(source, "contactForm", 3);

    expect(detectLatteFormNameAt(source, offset)).toBeNull();
  });

  it("returns null when the cursor is outside the value", () => {
    const source = '<form n:name="contactForm">body</form>';
    const offset = offsetOf(source, "body", 2);

    expect(detectLatteFormNameAt(source, offset)).toBeNull();
  });
});

describe("detectLatteFormNameCompletionAt", () => {
  it("returns a completion span inside an empty form n:name value", () => {
    const source = '<form n:name=""></form>';
    const offset = source.indexOf('">');

    expect(detectLatteFormNameCompletionAt(source, offset)).toEqual({
      elementTag: "form",
      prefix: "",
      replaceStart: offset,
      replaceEnd: offset,
    });
  });

  it("returns the typed prefix and replaces the whole partial value", () => {
    const source = '<form n:name="cont"></form>';
    const offset = offsetOf(source, "cont", "cont".length);

    expect(detectLatteFormNameCompletionAt(source, offset)).toEqual({
      elementTag: "form",
      prefix: "cont",
      replaceStart: source.indexOf("cont"),
      replaceEnd: source.indexOf("cont") + "cont".length,
    });
  });

  it("does not complete a dynamic n:name expression", () => {
    const source = '<form n:name="$form"></form>';
    const offset = offsetOf(source, "$form", 3);

    expect(detectLatteFormNameCompletionAt(source, offset)).toBeNull();
  });
});

describe("detectLatteFormMacroAt", () => {
  it("detects a static {form contactForm} macro on the name", () => {
    const source = "{form contactForm}{/form}";
    const offset = offsetOf(source, "contactForm", 3);

    expect(detectLatteFormMacroAt(source, offset)).toEqual({
      name: "contactForm",
      nameStart: source.indexOf("contactForm"),
      nameEnd: source.indexOf("contactForm") + "contactForm".length,
    });
  });

  it("rejects dynamic and masked form macros", () => {
    const dynamic = "{form $form}{/form}";
    const masked = "{* {form contactForm} *}";

    expect(detectLatteFormMacroAt(dynamic, offsetOf(dynamic, "$form", 2)))
      .toBeNull();
    expect(detectLatteFormMacroAt(masked, offsetOf(masked, "contactForm", 2)))
      .toBeNull();
  });

  it("rejects callable-looking form macro arguments", () => {
    const source = "{form contactForm()}";

    expect(
      detectLatteFormMacroAt(source, offsetOf(source, "contactForm", 2)),
    ).toBeNull();
  });
});

describe("detectLatteFormMacroCompletionAt", () => {
  it("returns a completion span inside a form macro", () => {
    const source = "{form co}";
    const offset = offsetOf(source, "co", 2);

    expect(detectLatteFormMacroCompletionAt(source, offset)).toEqual({
      prefix: "co",
      replaceStart: source.indexOf("co"),
      replaceEnd: source.indexOf("co") + "co".length,
    });
  });

  it("does not complete a dynamic form macro", () => {
    const source = "{form $form}";

    expect(
      detectLatteFormMacroCompletionAt(source, offsetOf(source, "$form", 2)),
    ).toBeNull();
  });
});

describe("latteActiveFormComponentAt", () => {
  it("returns the enclosing static form component for a field n:name", () => {
    const source = '<form n:name="contactForm"><input n:name="email"></form>';
    const offset = offsetOf(source, "email", 2);

    expect(latteActiveFormComponentAt(source, offset)).toEqual({
      name: "contactForm",
      nameStart: source.indexOf("contactForm"),
      nameEnd: source.indexOf("contactForm") + "contactForm".length,
    });
  });

  it("returns null after the form closes", () => {
    const source = '<form n:name="contactForm"></form><input n:name="email">';
    const offset = offsetOf(source, "email", 2);

    expect(latteActiveFormComponentAt(source, offset)).toBeNull();
  });

  it("returns null for a dynamic enclosing form name", () => {
    const source = '<form n:name="$form"><input n:name="email"></form>';
    const offset = offsetOf(source, "email", 2);

    expect(latteActiveFormComponentAt(source, offset)).toBeNull();
  });

  it("returns the enclosing static {form} macro component", () => {
    const source = "{form contactForm}\n{input email}\n{/form}";
    const offset = offsetOf(source, "email", 2);

    expect(latteActiveFormComponentAt(source, offset)).toEqual({
      name: "contactForm",
      nameStart: source.indexOf("contactForm"),
      nameEnd: source.indexOf("contactForm") + "contactForm".length,
    });
  });

  it("returns the enclosing static {form} macro component with attributes", () => {
    const source =
      "{form contactForm class => 'form-horizontal'}\n{input email}\n{/form}";
    const offset = offsetOf(source, "email", 2);

    expect(latteActiveFormComponentAt(source, offset)).toEqual({
      name: "contactForm",
      nameStart: source.indexOf("contactForm"),
      nameEnd: source.indexOf("contactForm") + "contactForm".length,
    });
  });

  it("returns null after a {/form} macro", () => {
    const source = "{form contactForm}{/form}\n{input email}";
    const offset = offsetOf(source, "email", 2);

    expect(latteActiveFormComponentAt(source, offset)).toBeNull();
  });

  it("ignores form-looking text inside another Latte expression", () => {
    const source = `{var $template = "{form contactForm}"}\n{input email}`;
    const offset = offsetOf(source, "email", 2);

    expect(latteActiveFormComponentAt(source, offset)).toBeNull();
  });

  it("restores the outer form after a nested form closes", () => {
    const source = "{form outer}{form inner}{/form}{input email}{/form}";
    const offset = offsetOf(source, "email", 2);

    expect(latteActiveFormComponentAt(source, offset)).toEqual({
      name: "outer",
      nameStart: source.indexOf("outer"),
      nameEnd: source.indexOf("outer") + "outer".length,
    });
  });
});

describe("detectLatteFormFieldMacroAt", () => {
  it.each(["input", "label", "inputError"] as const)(
    "detects a static {%s email} macro inside an active form",
    (macro) => {
      const source = `{form contactForm}{${macro} email}{/form}`;
      const offset = offsetOf(source, "email", 2);

      expect(detectLatteFormFieldMacroAt(source, offset)).toMatchObject({
        formName: "contactForm",
        macro,
        name: "email",
        nameStart: source.indexOf("email"),
        nameEnd: source.indexOf("email") + "email".length,
      });
    },
  );

  it("rejects dynamic field names and fields outside a static form", () => {
    const dynamic = "{form contactForm}{input $field}{/form}";
    const standalone = "{input email}";
    const callable = "{form contactForm}{input email()}{/form}";

    expect(
      detectLatteFormFieldMacroAt(dynamic, offsetOf(dynamic, "$field", 2)),
    ).toBeNull();
    expect(
      detectLatteFormFieldMacroAt(standalone, offsetOf(standalone, "email", 2)),
    ).toBeNull();
    expect(
      detectLatteFormFieldMacroAt(callable, offsetOf(callable, "email", 2)),
    ).toBeNull();
  });
});

describe("detectLatteFormFieldMacroCompletionAt", () => {
  it("returns a field completion span inside an active form macro", () => {
    const source = "{form contactForm}{input em}{/form}";
    const offset = offsetOf(source, "em", 2);

    expect(detectLatteFormFieldMacroCompletionAt(source, offset)).toEqual({
      formName: "contactForm",
      prefix: "em",
      replaceStart: source.indexOf("em"),
      replaceEnd: source.indexOf("em") + "em".length,
    });
  });

  it("does not complete dynamic field macros", () => {
    const source = "{form contactForm}{input $field}{/form}";

    expect(
      detectLatteFormFieldMacroCompletionAt(source, offsetOf(source, "$field", 2)),
    ).toBeNull();
  });
});

describe("netteFormFieldDefinitionsInCreateComponent", () => {
  it("finds static fields added to a Form variable in the component factory", () => {
    const source = `<?php
use Nette\\Application\\UI\\Form;

class HomePresenter
{
    protected function createComponentContactForm(): Form
    {
        $form = new Form();
        $form->addText('email', 'Email');
        $form->addSelect("role", 'Role');

        return $form;
    }
}
`;

    expect(
      netteFormFieldDefinitionsInCreateComponent(source, "contactForm"),
    ).toEqual([
      {
        controlClass: "Nette\\Forms\\Controls\\TextInput",
        methodName: "addText",
        name: "email",
        nameStart: source.indexOf("email"),
        nameEnd: source.indexOf("email") + "email".length,
      },
      {
        controlClass: "Nette\\Forms\\Controls\\SelectBox",
        methodName: "addSelect",
        name: "role",
        nameStart: source.indexOf("role"),
        nameEnd: source.indexOf("role") + "role".length,
      },
    ]);
  });

  it("skips dynamic field names and calls on non-form variables", () => {
    const source = `<?php
class HomePresenter
{
    protected function createComponentContactForm()
    {
        $form = new Form();
        $form->addText($fieldName, 'Dynamic');
        $other->addText('notAForm', 'Nope');
    }
}
`;

    expect(
      netteFormFieldDefinitionsInCreateComponent(source, "contactForm"),
    ).toEqual([]);
  });

  it("preserves the builder and leaves unknown add methods untyped", () => {
    const source = `<?php
use Nette\\Application\\UI\\Form;

class HomePresenter
{
    protected function createComponentContactForm()
    {
        $form = new Form();
        $form->addTextArea('message');
        $form->addCustomWidget('custom');
    }
}
`;

    expect(
      netteFormFieldDefinitionsInCreateComponent(source, "contactForm"),
    ).toEqual([
      {
        controlClass: "Nette\\Forms\\Controls\\TextArea",
        methodName: "addTextArea",
        name: "message",
        nameEnd: source.indexOf("message") + "message".length,
        nameStart: source.indexOf("message"),
      },
      {
        controlClass: null,
        methodName: "addCustomWidget",
        name: "custom",
        nameEnd: source.indexOf("custom") + "custom".length,
        nameStart: source.indexOf("custom"),
      },
    ]);
  });

  it("does not type fields on an imported custom Form", () => {
    const source = `<?php
namespace App\\Presenters;

use App\\Custom\\Form;

class HomePresenter
{
    protected function createComponentContactForm(): Form
    {
        $form = new Form();
        $form->addText('email');
        return $form;
    }
}
`;

    expect(
      netteFormFieldDefinitionsInCreateComponent(source, "contactForm"),
    ).toEqual([]);
  });

  it("leaves an unqualified Form without a reliable import untyped", () => {
    const source = `<?php
class HomePresenter
{
    protected function createComponentContactForm(): Form
    {
        $form = new Form();
        $form->addText('email');
        return $form;
    }
}`;

    expect(
      netteFormFieldDefinitionsInCreateComponent(source, "contactForm"),
    ).toEqual([]);
  });

  it("types fields on imported and fully-qualified Nette Forms", () => {
    const imported = `<?php
use Nette\\Forms\\Form as NetteForm;
class ImportedFactory
{
    public function create()
    {
        $form = new NetteForm();
        $form->addText('imported');
    }
}`;
    const fullyQualified = `<?php
class FullyQualifiedFactory
{
    public function create()
    {
        $form = new \\Nette\\Application\\UI\\Form();
        $form->addHidden('qualified');
    }
}`;

    expect(
      netteFormFieldDefinitionsInFactoryCreateMethod(
        imported,
        "ImportedFactory",
      ),
    ).toEqual([
      expect.objectContaining({
        controlClass: "Nette\\Forms\\Controls\\TextInput",
        methodName: "addText",
        name: "imported",
      }),
    ]);
    expect(
      netteFormFieldDefinitionsInFactoryCreateMethod(
        fullyQualified,
        "FullyQualifiedFactory",
      ),
    ).toEqual([
      expect.objectContaining({
        controlClass: "Nette\\Forms\\Controls\\HiddenField",
        methodName: "addHidden",
        name: "qualified",
      }),
    ]);
  });

  it("finds fields in a one-hop delegated typed form factory present in the same source", () => {
    const source = `<?php
use Nette\\Application\\UI\\Form;

class GatewayPresenter
{
    private StepperGatewayFormFactory $gatewayFormFactory;

    protected function createComponentGatewayForm(): Form
    {
        return $this->gatewayFormFactory->create();
    }
}

class StepperGatewayFormFactory
{
    public function create(): Form
    {
        $form = new Form;
        $form->addHidden('subscription_type_link_id');
        $form->addText('email', 'Email');

        return $form;
    }
}
`;

    expect(
      netteFormFieldDefinitionsInCreateComponent(source, "gatewayForm"),
    ).toEqual([
      {
        controlClass: "Nette\\Forms\\Controls\\HiddenField",
        methodName: "addHidden",
        name: "subscription_type_link_id",
        nameStart: source.indexOf("subscription_type_link_id"),
        nameEnd:
          source.indexOf("subscription_type_link_id") +
          "subscription_type_link_id".length,
      },
      {
        controlClass: "Nette\\Forms\\Controls\\TextInput",
        methodName: "addText",
        name: "email",
        nameStart: source.indexOf("email"),
        nameEnd: source.indexOf("email") + "email".length,
      },
    ]);
  });

  it("supports assigning the delegated factory result and immediately returning it", () => {
    const source = `<?php
use Nette\\Application\\UI\\Form;

class GatewayPresenter
{
    private StepperGatewayFormFactory $gatewayFormFactory;

    protected function createComponentGatewayForm(): Form
    {
        $form = $this->gatewayFormFactory->create();
        return $form;
    }
}

class StepperGatewayFormFactory
{
    public function create(): Form
    {
        $form = new Form();
        $form->addHidden('subscription_type_link_id');

        return $form;
    }
}
`;

    expect(
      netteFormFieldDefinitionsInCreateComponent(source, "gatewayForm"),
    ).toEqual([
      {
        controlClass: "Nette\\Forms\\Controls\\HiddenField",
        methodName: "addHidden",
        name: "subscription_type_link_id",
        nameStart: source.indexOf("subscription_type_link_id"),
        nameEnd:
          source.indexOf("subscription_type_link_id") +
          "subscription_type_link_id".length,
      },
    ]);
  });
});

describe("netteDelegatedFormFactoryInCreateComponent", () => {
  it("returns the typed factory property behind a delegated createComponent form", () => {
    const source = `<?php
class GatewayPresenter
{
    protected StepperGatewayFormFactory $gatewayFormFactory;

    protected function createComponentGatewayForm(): Form
    {
        return $this->gatewayFormFactory->create();
    }
}
`;

    expect(
      netteDelegatedFormFactoryInCreateComponent(source, "gatewayForm"),
    ).toEqual({
      componentName: "gatewayForm",
      factoryClass: "StepperGatewayFormFactory",
      factoryClassStart: source.indexOf("StepperGatewayFormFactory"),
      factoryClassEnd:
        source.indexOf("StepperGatewayFormFactory") +
        "StepperGatewayFormFactory".length,
      methodName: "createComponentGatewayForm",
      propertyName: "gatewayFormFactory",
      propertyNameStart: source.lastIndexOf("gatewayFormFactory"),
      propertyNameEnd:
        source.lastIndexOf("gatewayFormFactory") + "gatewayFormFactory".length,
    });
  });

  it("requires a typed property and allows explicit create arguments", () => {
    const untyped = `<?php
class GatewayPresenter
{
    private $gatewayFormFactory;

    protected function createComponentGatewayForm(): Form
    {
        return $this->gatewayFormFactory->create();
    }
}
`;
    const createWithArguments = `<?php
class GatewayPresenter
{
    private StepperGatewayFormFactory $gatewayFormFactory;

    protected function createComponentGatewayForm(): Form
    {
        return $this->gatewayFormFactory->create($this);
    }
}
`;

    expect(
      netteDelegatedFormFactoryInCreateComponent(untyped, "gatewayForm"),
    ).toBeNull();
    expect(
      netteDelegatedFormFactoryInCreateComponent(
        createWithArguments,
        "gatewayForm",
      ),
    ).toMatchObject({
      factoryClass: "StepperGatewayFormFactory",
      propertyName: "gatewayFormFactory",
    });
  });

  it("returns a non-promoted constructor-injected factory assigned to the property", () => {
    const source = `<?php
class GatewayPresenter
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
    const factoryTypeStart = source.indexOf(
      "GatewayFormFactory $gatewayFormFactory",
      source.indexOf("__construct"),
    );

    expect(
      netteDelegatedFormFactoryInCreateComponent(source, "gatewayForm"),
    ).toEqual({
      componentName: "gatewayForm",
      factoryClass: "GatewayFormFactory",
      factoryClassStart: factoryTypeStart,
      factoryClassEnd: factoryTypeStart + "GatewayFormFactory".length,
      methodName: "createComponentGatewayForm",
      propertyName: "gatewayFormFactory",
      propertyNameStart: source.lastIndexOf("gatewayFormFactory"),
      propertyNameEnd:
        source.lastIndexOf("gatewayFormFactory") + "gatewayFormFactory".length,
    });
  });

  it("returns an explicitly promoted constructor-injected factory", () => {
    const source = `<?php
class GatewayPresenter
{
    public function __construct(
        private GatewayFormFactory $gatewayFormFactory,
    ) {
    }

    protected function createComponentGatewayForm(): Form
    {
        return $this->gatewayFormFactory->create();
    }
}
`;

    expect(
      netteDelegatedFormFactoryInCreateComponent(source, "gatewayForm"),
    ).toMatchObject({
      componentName: "gatewayForm",
      factoryClass: "GatewayFormFactory",
      factoryClassStart: source.indexOf("GatewayFormFactory"),
      factoryClassEnd:
        source.indexOf("GatewayFormFactory") + "GatewayFormFactory".length,
      methodName: "createComponentGatewayForm",
      propertyName: "gatewayFormFactory",
    });
  });

  it("rejects constructor injection without a typed constructor parameter", () => {
    const source = `<?php
class GatewayPresenter
{
    private $gatewayFormFactory;

    public function __construct($gatewayFormFactory)
    {
        $this->gatewayFormFactory = $gatewayFormFactory;
    }

    protected function createComponentGatewayForm(): Form
    {
        return $this->gatewayFormFactory->create();
    }
}
`;

    expect(
      netteDelegatedFormFactoryInCreateComponent(source, "gatewayForm"),
    ).toBeNull();
  });

  it("returns a constructor-injected factory assigned from a differently named typed parameter", () => {
    const source = `<?php
class GatewayPresenter
{
    private $gatewayFormFactory;

    public function __construct(GatewayFormFactory $factory)
    {
        $this->gatewayFormFactory = $factory;
    }

    protected function createComponentGatewayForm(): Form
    {
        return $this->gatewayFormFactory->create();
    }
}
`;

    expect(
      netteDelegatedFormFactoryInCreateComponent(source, "gatewayForm"),
    ).toMatchObject({
      factoryClass: "GatewayFormFactory",
      propertyName: "gatewayFormFactory",
    });
  });

  it("rejects constructor injection when the assigned parameter is untyped", () => {
    const source = `<?php
class GatewayPresenter
{
    private $gatewayFormFactory;

    public function __construct($factory)
    {
        $this->gatewayFormFactory = $factory;
    }

    protected function createComponentGatewayForm(): Form
    {
        return $this->gatewayFormFactory->create();
    }
}
`;

    expect(
      netteDelegatedFormFactoryInCreateComponent(source, "gatewayForm"),
    ).toBeNull();
  });

  it("rejects constructor injection when the property assignment is deferred in a closure", () => {
    const source = `<?php
class GatewayPresenter
{
    private $gatewayFormFactory;

    public function __construct(GatewayFormFactory $factory)
    {
        $later = function () use ($factory) {
            $this->gatewayFormFactory = $factory;
        };
    }

    protected function createComponentGatewayForm(): Form
    {
        return $this->gatewayFormFactory->create();
    }
}
`;

    expect(
      netteDelegatedFormFactoryInCreateComponent(source, "gatewayForm"),
    ).toBeNull();
  });

  it("rejects constructor injection when the property assignment is missing", () => {
    const source = `<?php
class GatewayPresenter
{
    private $gatewayFormFactory;

    public function __construct(GatewayFormFactory $gatewayFormFactory)
    {
    }

    protected function createComponentGatewayForm(): Form
    {
        return $this->gatewayFormFactory->create();
    }
}
`;

    expect(
      netteDelegatedFormFactoryInCreateComponent(source, "gatewayForm"),
    ).toBeNull();
  });
});

describe("netteMethodParameterFormFactoryInCreateComponent", () => {
  it("returns the typed parameter called with create in its owning component method", () => {
    const source = `<?php
use App\\Forms\\SegmentRecalculationSettingsFormFactory;

class StoredSegmentsPresenter
{
    protected function createComponentSegmentRecalculationSettingsForm(
        SegmentRecalculationSettingsFormFactory $factory,
    ): Form {
        $form = $factory->create($this->getParameter('segmentId'));
        return $form;
    }
}
`;
    const callNameStart = source.indexOf("factory->create");

    expect(
      netteMethodParameterFormFactoryInCreateComponent(
        source,
        "segmentRecalculationSettingsForm",
      ),
    ).toEqual({
      componentName: "segmentRecalculationSettingsForm",
      factoryClass: "SegmentRecalculationSettingsFormFactory",
      factoryClassStart: source.indexOf(
        "SegmentRecalculationSettingsFormFactory $factory",
      ),
      factoryClassEnd:
        source.indexOf("SegmentRecalculationSettingsFormFactory $factory") +
        "SegmentRecalculationSettingsFormFactory".length,
      methodName: "createComponentSegmentRecalculationSettingsForm",
      parameterName: "factory",
      parameterNameStart: callNameStart,
      parameterNameEnd: callNameStart + "factory".length,
    });
  });

  it("rejects untyped parameters and typed parameters used outside the owning method", () => {
    const untyped = `<?php
class StoredSegmentsPresenter
{
    protected function createComponentSegmentRecalculationSettingsForm($factory)
    {
        return $factory->create();
    }
}
`;
    const otherMethod = `<?php
class StoredSegmentsPresenter
{
    protected function createComponentSegmentRecalculationSettingsForm()
    {
        return null;
    }

    private function build(SegmentRecalculationSettingsFormFactory $factory)
    {
        return $factory->create();
    }
}
`;

    expect(
      netteMethodParameterFormFactoryInCreateComponent(
        untyped,
        "segmentRecalculationSettingsForm",
      ),
    ).toBeNull();
    expect(
      netteMethodParameterFormFactoryInCreateComponent(
        otherMethod,
        "segmentRecalculationSettingsForm",
      ),
    ).toBeNull();
  });

  it("rejects distinct typed parameter factories returned conditionally", () => {
    const source = `<?php
class StoredSegmentsPresenter
{
    protected function createComponentSettings(
        PrimarySettingsFormFactory $primaryFactory,
        SecondarySettingsFormFactory $secondaryFactory,
        bool $usePrimary,
    ): Form {
        if ($usePrimary) {
            return $primaryFactory->create();
        }

        return $secondaryFactory->create();
    }
}
`;

    expect(
      netteMethodParameterFormFactoryInCreateComponent(source, "settings"),
    ).toBeNull();
  });

  it("allows repeated owning-scope returns from the same typed parameter", () => {
    const source = `<?php
class StoredSegmentsPresenter
{
    protected function createComponentSettings(
        SettingsFormFactory $factory,
        bool $compact,
    ): Form {
        if ($compact) {
            return $factory->create('compact');
        }

        return $factory->create('full');
    }
}
`;

    expect(
      netteMethodParameterFormFactoryInCreateComponent(source, "settings"),
    ).toMatchObject({
      factoryClass: "SettingsFormFactory",
      parameterName: "factory",
    });
  });

  it("rejects distinct conditional factory origins assigned to one returned local", () => {
    const source = `<?php
class StoredSegmentsPresenter
{
    protected function createComponentSettings(
        PrimarySettingsFormFactory $primaryFactory,
        SecondarySettingsFormFactory $secondaryFactory,
        bool $usePrimary,
    ): Form {
        if ($usePrimary) {
            $form = $primaryFactory->create();
        } else {
            $form = $secondaryFactory->create();
        }

        return $form;
    }
}
`;

    expect(
      netteMethodParameterFormFactoryInCreateComponent(source, "settings"),
    ).toBeNull();
  });

  it("allows repeated conditional assignments from the same typed parameter", () => {
    const source = `<?php
class StoredSegmentsPresenter
{
    protected function createComponentSettings(
        SettingsFormFactory $factory,
        bool $compact,
    ): Form {
        if ($compact) {
            $form = $factory->create('compact');
        } else {
            $form = $factory->create('full');
        }

        return $form;
    }
}
`;

    expect(
      netteMethodParameterFormFactoryInCreateComponent(source, "settings"),
    ).toMatchObject({
      factoryClass: "SettingsFormFactory",
      parameterName: "factory",
    });
  });

  it("rejects a factory origin killed by a later non-factory assignment", () => {
    const source = `<?php
class StoredSegmentsPresenter
{
    protected function createComponentSettings(SettingsFormFactory $factory)
    {
        $form = $factory->create();
        $form = null;
        return $form;
    }
}
`;

    expect(
      netteMethodParameterFormFactoryInCreateComponent(source, "settings"),
    ).toBeNull();
  });

  it("keeps provenance across a later assignment from the same factory", () => {
    const source = `<?php
class StoredSegmentsPresenter
{
    protected function createComponentSettings(SettingsFormFactory $factory)
    {
        $form = $factory->create('initial');
        $form = $factory->create('final');
        return $form;
    }
}
`;

    expect(
      netteMethodParameterFormFactoryInCreateComponent(source, "settings"),
    ).toMatchObject({
      factoryClass: "SettingsFormFactory",
      parameterName: "factory",
    });
  });

  it("allows an earlier non-factory initialization overwritten by the factory", () => {
    const source = `<?php
class StoredSegmentsPresenter
{
    protected function createComponentSettings(SettingsFormFactory $factory)
    {
        $form = null;
        $form = $factory->create();
        return $form;
    }
}
`;

    expect(
      netteMethodParameterFormFactoryInCreateComponent(source, "settings"),
    ).toMatchObject({
      factoryClass: "SettingsFormFactory",
      parameterName: "factory",
    });
  });

  it("ignores factory returns inside nested closures and functions", () => {
    const closureOnly = `<?php
class StoredSegmentsPresenter
{
    protected function createComponentSettings(SettingsFormFactory $factory)
    {
        $callback = function () use ($factory) {
            return $factory->create();
        };

        return null;
    }
}
`;
    const nestedFunctionOnly = `<?php
class StoredSegmentsPresenter
{
    protected function createComponentSettings(SettingsFormFactory $factory)
    {
        function buildSettings()
        {
            return $factory->create();
        }

        return null;
    }
}
`;
    const assignmentReturnedOnlyByClosure = `<?php
class StoredSegmentsPresenter
{
    protected function createComponentSettings(SettingsFormFactory $factory)
    {
        $form = $factory->create();
        $callback = function () use ($form) {
            return $form;
        };

        return null;
    }
}
`;

    expect(
      netteMethodParameterFormFactoryInCreateComponent(closureOnly, "settings"),
    ).toBeNull();
    expect(
      netteMethodParameterFormFactoryInCreateComponent(
        nestedFunctionOnly,
        "settings",
      ),
    ).toBeNull();
    expect(
      netteMethodParameterFormFactoryInCreateComponent(
        assignmentReturnedOnlyByClosure,
        "settings",
      ),
    ).toBeNull();
  });

  it("does not make an owning factory ambiguous with a nested closure factory", () => {
    const source = `<?php
class StoredSegmentsPresenter
{
    protected function createComponentSettings(
        SettingsFormFactory $factory,
        PreviewFormFactory $previewFactory,
    ): Form {
        $preview = function () use ($previewFactory) {
            return $previewFactory->create();
        };

        return $factory->create();
    }
}
`;

    expect(
      netteMethodParameterFormFactoryInCreateComponent(source, "settings"),
    ).toMatchObject({
      factoryClass: "SettingsFormFactory",
      parameterName: "factory",
    });
  });
});

describe("netteFormFieldDefinitionsInFactoryCreateMethod", () => {
  it("extracts direct static fields from a factory create method", () => {
    const source = `<?php
use Nette\\Application\\UI\\Form;

class StepperGatewayFormFactory
{
    public function create(): Form
    {
        $form = new Form();
        $form->addHidden('subscription_type_link_id');
        $form->addSubmit('send', 'Continue');
        $form->addText($dynamic, 'Dynamic');
        $form->addContainer('items');
        $other->addText('not_form', 'Nope');

        return $form;
    }
}
`;

    expect(
      netteFormFieldDefinitionsInFactoryCreateMethod(
        source,
        "StepperGatewayFormFactory",
      ),
    ).toEqual([
      {
        controlClass: "Nette\\Forms\\Controls\\HiddenField",
        methodName: "addHidden",
        name: "subscription_type_link_id",
        nameStart: source.indexOf("subscription_type_link_id"),
        nameEnd:
          source.indexOf("subscription_type_link_id") +
          "subscription_type_link_id".length,
      },
      {
        controlClass: "Nette\\Forms\\Controls\\SubmitButton",
        methodName: "addSubmit",
        name: "send",
        nameStart: source.indexOf("send"),
        nameEnd: source.indexOf("send") + "send".length,
      },
    ]);
  });

  it("does not follow nested factory delegation from create", () => {
    const source = `<?php
class StepperGatewayFormFactory
{
    public function create(): Form
    {
        return $this->innerFactory->create();
    }
}
`;

    expect(
      netteFormFieldDefinitionsInFactoryCreateMethod(
        source,
        "StepperGatewayFormFactory",
      ),
    ).toEqual([]);
  });

  it("uses the fully qualified class when duplicate short factory names exist", () => {
    const source = `<?php
namespace App\\Wrong;

class GatewayFormFactory
{
    public function create(): Form
    {
        $form = new \\Nette\\Application\\UI\\Form();
        $form->addText('wrong_field');
        return $form;
    }
}

namespace App\\Forms;

class GatewayFormFactory
{
    public function create(): Form
    {
        $form = new \\Nette\\Application\\UI\\Form();
        $form->addText('right_field');
        return $form;
    }
}
`;

    expect(
      netteFormFieldDefinitionsInFactoryCreateMethod(
        source,
        "App\\Forms\\GatewayFormFactory",
      ),
    ).toEqual([
      {
        controlClass: "Nette\\Forms\\Controls\\TextInput",
        methodName: "addText",
        name: "right_field",
        nameStart: source.indexOf("right_field"),
        nameEnd: source.indexOf("right_field") + "right_field".length,
      },
    ]);
  });
});

describe("netteCreateComponentMethodName", () => {
  it("upper-cases the first letter of the control name", () => {
    expect(netteCreateComponentMethodName("contactForm")).toBe(
      "createComponentContactForm",
    );
  });

  it("handles multi-word camelCase control names", () => {
    expect(netteCreateComponentMethodName("productList")).toBe(
      "createComponentProductList",
    );
  });

  it("is idempotent on an already-capitalised name", () => {
    expect(netteCreateComponentMethodName("ContactForm")).toBe(
      "createComponentContactForm",
    );
  });
});

describe("detectNetteCreateComponentAt", () => {
  it("resolves the component name from a createComponent method definition", () => {
    const source =
      "class ProductPresenter {\n  protected function createComponentContactForm(): Form\n  {\n  }\n}";
    const offset = offsetOf(source, "createComponentContactForm", 4);

    expect(detectNetteCreateComponentAt(source, offset)).toEqual({
      componentName: "contactForm",
      methodName: "createComponentContactForm",
      nameStart: source.indexOf("createComponentContactForm"),
      nameEnd:
        source.indexOf("createComponentContactForm") +
        "createComponentContactForm".length,
    });
  });

  it("returns null when the cursor is not on the method name", () => {
    const source = "protected function createComponentContactForm(): Form {}";
    const offset = offsetOf(source, "protected", 2);

    expect(detectNetteCreateComponentAt(source, offset)).toBeNull();
  });

  it("returns null for an ordinary method", () => {
    const source = "public function renderDefault(): void {}";
    const offset = offsetOf(source, "renderDefault", 2);

    expect(detectNetteCreateComponentAt(source, offset)).toBeNull();
  });
});

describe("netteAddComponentRegistrations", () => {
  it("finds literal $this->addComponent registrations and their name offsets", () => {
    const source = `<?php
class PaymentLogsAdminPresenter
{
    public function renderDefault(): void
    {
        $vp = new VisualPaginator();
        $this->addComponent($vp, 'vp');
    }
}
`;

    expect(netteAddComponentRegistrations(source)).toEqual([
      {
        className: "VisualPaginator",
        name: "vp",
        nameEnd: source.indexOf("'vp'") + 3,
        nameStart: source.indexOf("'vp'") + 1,
        offset: source.indexOf("addComponent"),
      },
    ]);
  });

  it("ignores dynamic addComponent names", () => {
    const source = `<?php
class HomePresenter
{
    public function renderDefault(): void
    {
        $name = 'vp';
        $vp = new VisualPaginator();
        $this->addComponent($vp, $name);
    }
}
`;

    expect(netteAddComponentRegistrations(source)).toEqual([]);
  });

  it("ignores addComponent text in comments and strings", () => {
    const source = `<?php
class HomePresenter
{
    public function renderDefault(): void
    {
        // $this->addComponent($vp, 'commented');
        $debug = "$this->addComponent($vp, 'string')";
    }
}
`;

    expect(netteAddComponentRegistrations(source)).toEqual([]);
  });

  it("ignores fake method bodies inside comments and strings", () => {
    const source = `<?php
class HomePresenter
{
    /*
    public function fakeComment(): void
    {
        $vp = new VisualPaginator();
        $this->addComponent($vp, 'commented');
    }
    */

    private string $debug = "public function fakeString(): void { $this->addComponent($vp, 'string'); }";
}
`;

    expect(netteAddComponentRegistrations(source)).toEqual([]);
  });

  it("ignores fake method bodies and calls inside heredoc strings", () => {
    const source = `<?php
class HomePresenter
{
    private string $template = <<<LATTE
    public function fakeHeredoc(): void
    {
        $vp = new VisualPaginator();
        $this->addComponent($vp, 'heredocMethod');
    }
    LATTE;

    public function renderDefault(): void
    {
        $debug = <<<PHP
        $this->addComponent($vp, 'heredocCall');
        PHP;
    }
}
`;

    expect(netteAddComponentRegistrations(source)).toEqual([]);
  });
});

describe("netteComponentUsagesInLatte", () => {
  it("finds control, n:name and $this[] usages of a component", () => {
    const source = [
      "{control contactForm}",
      "{form contactForm}{/form}",
      "<form n:name=\"contactForm\"></form>",
      "{if $this['contactForm']}yes{/if}",
    ].join("\n");

    const usages = netteComponentUsagesInLatte(source, "contactForm");
    const kinds = usages.map((usage) => usage.kind).sort();

    expect(kinds).toEqual(["arrayAccess", "control", "form", "n:name"]);
    for (const usage of usages) {
      expect(source.slice(usage.start, usage.end)).toBe("contactForm");
    }
  });

  it("finds quoted static {control 'name'} usages", () => {
    const source = "{control 'contactForm'}";

    expect(netteComponentUsagesInLatte(source, "contactForm")).toEqual([
      {
        end: source.indexOf("contactForm") + "contactForm".length,
        kind: "control",
        start: source.indexOf("contactForm"),
      },
    ]);
  });

  it("ignores usages inside a Latte comment", () => {
    const source = "{* {control contactForm} *}\n{control contactForm}";

    const usages = netteComponentUsagesInLatte(source, "contactForm");

    expect(usages).toHaveLength(1);
    expect(usages[0]?.kind).toBe("control");
    expect(usages[0]?.start).toBeGreaterThan(source.indexOf("*}"));
  });

  it("returns an empty list when the component is not used", () => {
    const source = "{control other}<form n:name=\"another\"></form>";

    expect(netteComponentUsagesInLatte(source, "contactForm")).toEqual([]);
  });

  it("does not report a PascalCase spelling as a usage of a lower-camel component", () => {
    // Container::createComponent guards with `$ucname !== $name`, so
    // {control ContactForm} never invokes createComponentContactForm at
    // runtime - it is a "component does not exist" error, not an alternate
    // spelling of contactForm.
    const source = [
      "{control ContactForm}",
      "<form n:name=\"ContactForm\"></form>",
      "{if $this['ContactForm']}yes{/if}",
    ].join("\n");

    expect(netteComponentUsagesInLatte(source, "contactForm")).toEqual([]);
  });

  it("ignores callable-looking form macro usages", () => {
    const source = "{form contactForm()}{/form}";

    expect(netteComponentUsagesInLatte(source, "contactForm")).toEqual([]);
  });

  it("resolves the {control} argument span, not the keyword, when the component name IS \"control\"", () => {
    // "{control control}": the componentName also occurs as the tag keyword
    // itself, earlier in the match - a naive match[0].indexOf(componentName)
    // would find that keyword occurrence instead of the actual argument.
    const source = "{control control}";

    const usages = netteComponentUsagesInLatte(source, "control");

    expect(source.slice(9, 16)).toBe("control");
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({ kind: "control", start: 9, end: 16 });
  });

  it("resolves the $this[] argument span, not the \"this\" keyword, when the component name IS \"this\"", () => {
    // "$this['this']": the componentName also occurs inside the "$this"
    // keyword, earlier in the match - same indexOf hazard as above.
    const source = "$this['this']";

    const usages = netteComponentUsagesInLatte(source, "this");

    expect(source.slice(7, 11)).toBe("this");
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({ kind: "arrayAccess", start: 7, end: 11 });
  });
});

describe("nettePresenterLifecycleInfo", () => {
  const presenter = [
    "class ProductPresenter extends Presenter",
    "{",
    "  public function startup(): void {}",
    "  public function beforeRender(): void {}",
    "  public function actionShow(int $id): void {}",
    "  public function renderDefault(): void {}",
    "  public function handleDelete(int $id): void {}",
    "  protected function createComponentContactForm(): Form {}",
    "  public function injectTranslator(Translator $translator): void {}",
    "  private function helper(): void {}",
    "}",
  ].join("\n");

  it("classifies every lifecycle method with its specific name", () => {
    const info = nettePresenterLifecycleInfo(presenter);
    const byMethod = new Map(
      info.lifecycle.map((entry) => [entry.methodName, entry]),
    );

    expect(byMethod.get("startup")?.kind).toBe("startup");
    expect(byMethod.get("beforeRender")?.kind).toBe("beforeRender");
    expect(byMethod.get("actionShow")).toMatchObject({ kind: "action", name: "show" });
    expect(byMethod.get("renderDefault")).toMatchObject({
      kind: "render",
      name: "default",
    });
    expect(byMethod.get("handleDelete")).toMatchObject({
      kind: "handle",
      name: "delete",
    });
    expect(byMethod.get("createComponentContactForm")).toMatchObject({
      kind: "createComponent",
      name: "contactForm",
    });
    expect(byMethod.get("injectTranslator")).toMatchObject({
      kind: "inject",
      name: "translator",
    });
  });

  it("excludes private helper methods", () => {
    const info = nettePresenterLifecycleInfo(presenter);

    expect(info.lifecycle.some((entry) => entry.methodName === "helper")).toBe(false);
  });

  it("records the offset of the method name", () => {
    const info = nettePresenterLifecycleInfo(presenter);
    const startup = info.lifecycle.find((entry) => entry.methodName === "startup");

    expect(startup?.offset).toBe(presenter.indexOf("startup"));
  });
});

describe("netteComponentClassFromCreateMethod", () => {
  it("reads the component class from a return type hint", () => {
    const source =
      "protected function createComponentContactForm(): Form\n{\n  return new Form();\n}";

    expect(
      netteComponentClassFromCreateMethod(source, "createComponentContactForm"),
    ).toBe("Form");
  });

  it("reads a fully-qualified return type hint verbatim", () => {
    const source =
      "protected function createComponentContactForm(): \\App\\Forms\\SignInForm {}";

    expect(
      netteComponentClassFromCreateMethod(source, "createComponentContactForm"),
    ).toBe("\\App\\Forms\\SignInForm");
  });

  it("infers the class from a return new statement when there is no type hint", () => {
    const source = [
      "protected function createComponentContactForm()",
      "{",
      "  $form = new Form();",
      "  return new ContactFormControl($this->service);",
      "}",
    ].join("\n");

    expect(
      netteComponentClassFromCreateMethod(source, "createComponentContactForm"),
    ).toBe("ContactFormControl");
  });

  it("keeps a fully-qualified class inferred from return new", () => {
    const source = [
      "protected function createComponentProductList()",
      "{",
      "  return new \\App\\Components\\ProductList\\ProductListControl();",
      "}",
    ].join("\n");

    expect(
      netteComponentClassFromCreateMethod(source, "createComponentProductList"),
    ).toBe("\\App\\Components\\ProductList\\ProductListControl");
  });

  it("reads the class from a docblock @return when nothing else is present", () => {
    const source = [
      "/**",
      " * @return SignInForm",
      " */",
      "protected function createComponentSignIn()",
      "{",
      "  return $this->factory->create();",
      "}",
    ].join("\n");

    expect(
      netteComponentClassFromCreateMethod(source, "createComponentSignIn"),
    ).toBe("SignInForm");
  });

  it("returns null for a non-class return type", () => {
    const source = "protected function createComponentContactForm(): void {}";

    expect(
      netteComponentClassFromCreateMethod(source, "createComponentContactForm"),
    ).toBeNull();
  });

  it("returns null when the method is not found", () => {
    const source = "protected function createComponentContactForm(): Form {}";

    expect(
      netteComponentClassFromCreateMethod(source, "createComponentMissing"),
    ).toBeNull();
  });

  it("collapses a nullable docblock union (Foo|null) to the class, matching the ?Foo idiom", () => {
    const source = [
      "/**",
      " * @return SignInForm|null",
      " */",
      "protected function createComponentSignIn()",
      "{",
      "  return $this->factory->create();",
      "}",
    ].join("\n");

    expect(
      netteComponentClassFromCreateMethod(source, "createComponentSignIn"),
    ).toBe("SignInForm");
  });

  it("collapses a nullable docblock union written null-first (null|Foo)", () => {
    const source = [
      "/**",
      " * @return null|SignInForm",
      " */",
      "protected function createComponentSignIn()",
      "{",
      "  return $this->factory->create();",
      "}",
    ].join("\n");

    expect(
      netteComponentClassFromCreateMethod(source, "createComponentSignIn"),
    ).toBe("SignInForm");
  });

  it("returns null for a genuine multi-class docblock union (Foo|Bar), same as the hint path", () => {
    const source = [
      "/**",
      " * @return Foo|Bar",
      " */",
      "protected function createComponentSignIn()",
      "{",
      "  return $this->factory->create();",
      "}",
    ].join("\n");

    expect(
      netteComponentClassFromCreateMethod(source, "createComponentSignIn"),
    ).toBeNull();
  });

  it("returns null for a docblock intersection type (Foo&Bar), same as the hint path", () => {
    const source = [
      "/**",
      " * @return Foo&Bar",
      " */",
      "protected function createComponentSignIn()",
      "{",
      "  return $this->factory->create();",
      "}",
    ].join("\n");

    expect(
      netteComponentClassFromCreateMethod(source, "createComponentSignIn"),
    ).toBeNull();
  });

  it("returns null for a docblock union containing an intersection (Foo&Bar|null)", () => {
    const source = [
      "/**",
      " * @return Foo&Bar|null",
      " */",
      "protected function createComponentSignIn()",
      "{",
      "  return $this->factory->create();",
      "}",
    ].join("\n");

    expect(
      netteComponentClassFromCreateMethod(source, "createComponentSignIn"),
    ).toBeNull();
  });

  it("collapses a nullable return type hint union (Foo|null) to the class, matching the ?Foo idiom", () => {
    const source =
      "protected function createComponentContactForm(): Form|null {}";

    expect(
      netteComponentClassFromCreateMethod(source, "createComponentContactForm"),
    ).toBe("Form");
  });

  it("returns null for a genuine multi-class return type hint union (Foo|Bar)", () => {
    const source =
      "protected function createComponentContactForm(): Form|SignInForm {}";

    expect(
      netteComponentClassFromCreateMethod(source, "createComponentContactForm"),
    ).toBeNull();
  });
});

describe("netteCreateComponentFactoryContexts", () => {
  it("identifies component name, return type and factory-created class", () => {
    const source = [
      "class ProductPresenter",
      "{",
      "  final protected function createComponentContactForm(): ContactFormControl",
      "  {",
      "    return new FallbackControl();",
      "  }",
      "}",
    ].join("\n");

    expect(netteCreateComponentFactoryContexts(source)).toEqual([
      {
        componentName: "contactForm",
        controlClass: "ContactFormControl",
        docblockReturnType: null,
        factoryCreatedControlClass: "FallbackControl",
        methodName: "createComponentContactForm",
        nameEnd:
          source.indexOf("createComponentContactForm") +
          "createComponentContactForm".length,
        nameStart: source.indexOf("createComponentContactForm"),
        returnType: "ContactFormControl",
      },
    ]);
  });

  it("uses return new as the control class when no return type is declared", () => {
    const source = [
      "class ProductPresenter",
      "{",
      "  public static function createComponentGrid()",
      "  {",
      "    return new \\App\\UI\\Grid\\GridControl($this->gridFactory);",
      "  }",
      "}",
    ].join("\n");

    expect(netteCreateComponentFactoryContexts(source)[0]).toMatchObject({
      componentName: "grid",
      controlClass: "\\App\\UI\\Grid\\GridControl",
      factoryCreatedControlClass: "\\App\\UI\\Grid\\GridControl",
      methodName: "createComponentGrid",
      returnType: null,
    });
  });

  it("ignores return new text inside comments and strings", () => {
    const source = [
      "class ProductPresenter",
      "{",
      "  protected function createComponentMenu()",
      "  {",
      "    // return new CommentedControl();",
      "    $debug = 'return new StringControl()';",
      "    return new MenuControl();",
      "  }",
      "}",
    ].join("\n");

    expect(netteCreateComponentFactoryContexts(source)[0]).toMatchObject({
      componentName: "menu",
      controlClass: "MenuControl",
      factoryCreatedControlClass: "MenuControl",
    });
  });

  it("keeps body matching stable when comments contain braces", () => {
    const source = [
      "class ProductPresenter",
      "{",
      "  protected function createComponentMenu() /* { */",
      "  {",
      "    /* } return new WrongControl(); */",
      "    return new MenuControl();",
      "  }",
      "}",
    ].join("\n");

    expect(
      netteComponentClassFromCreateMethod(source, "createComponentMenu"),
    ).toBe("MenuControl");
  });

  it("returns the rich context at a createComponent method-name offset", () => {
    const source =
      "protected function createComponentPaginator(): PaginatorControl {}";
    const offset = offsetOf(source, "createComponentPaginator", 5);

    expect(netteCreateComponentFactoryContextAt(source, offset)).toMatchObject({
      componentName: "paginator",
      controlClass: "PaginatorControl",
      factoryCreatedControlClass: null,
      methodName: "createComponentPaginator",
      returnType: "PaginatorControl",
    });
  });
});

describe("netteComponentAncestorReferences", () => {
  it("extracts the parent class from the extends clause", () => {
    const source = [
      "<?php",
      "namespace App\\UI\\Home;",
      "",
      "use App\\UI\\BasePresenter;",
      "",
      "final class HomePresenter extends BasePresenter implements Renderable",
      "{",
      "}",
    ].join("\n");

    expect(netteComponentAncestorReferences(source)).toEqual({
      parentClassName: "BasePresenter",
      traitNames: [],
    });
  });

  it("extracts a fully qualified parent class", () => {
    const source =
      "<?php\nclass HomePresenter extends \\App\\UI\\BasePresenter\n{\n}\n";

    expect(netteComponentAncestorReferences(source).parentClassName).toBe(
      "\\App\\UI\\BasePresenter",
    );
  });

  it("returns no parent for a class without an extends clause", () => {
    const source = "<?php\nclass HomePresenter implements Renderable\n{\n}\n";

    expect(netteComponentAncestorReferences(source).parentClassName).toBeNull();
  });

  it("ignores class-like text in a docblock before the real declaration", () => {
    const source = [
      "<?php",
      "namespace App\\UI\\Home;",
      "",
      "/**",
      " * Usage example: class Example { render(); }",
      " */",
      "class HomePresenter extends BasePresenter",
      "{",
      "}",
    ].join("\n");

    expect(netteComponentAncestorReferences(source).parentClassName).toBe(
      "BasePresenter",
    );
  });

  it("ignores an extends clause mentioned in a comment before the class", () => {
    const source = [
      "<?php",
      "// legacy: class HomePresenter extends OldBasePresenter",
      "class HomePresenter",
      "{",
      "}",
    ].join("\n");

    expect(netteComponentAncestorReferences(source).parentClassName).toBeNull();
  });

  it("ignores an extends clause inside a string literal before the class", () => {
    const source = [
      "<?php",
      "const SNIPPET = 'class HomePresenter extends OldBasePresenter {';",
      "class HomePresenter",
      "{",
      "}",
    ].join("\n");

    expect(netteComponentAncestorReferences(source).parentClassName).toBeNull();
  });

  it("collects used trait names from the class body", () => {
    const source = [
      "<?php",
      "class HomePresenter",
      "{",
      "    use GridTrait, FilterTrait;",
      "",
      "    public function renderDefault(): void",
      "    {",
      "    }",
      "}",
    ].join("\n");

    expect(netteComponentAncestorReferences(source).traitNames).toEqual([
      "GridTrait",
      "FilterTrait",
    ]);
  });

  it("returns nothing for a trait source without extends or use", () => {
    const source = [
      "<?php",
      "trait GridTrait",
      "{",
      "    protected function createComponentTraitGrid(): GridControl",
      "    {",
      "        return new GridControl();",
      "    }",
      "}",
    ].join("\n");

    expect(netteComponentAncestorReferences(source)).toEqual({
      parentClassName: null,
      traitNames: [],
    });
  });
});
