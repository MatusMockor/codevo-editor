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
  netteComponentClassFromCreateMethod,
  netteCreateComponentFactoryContextAt,
  netteCreateComponentFactoryContexts,
  netteComponentUsagesInLatte,
  netteCreateComponentMethodName,
  netteFormFieldDefinitionsInCreateComponent,
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
        name: "email",
        nameStart: source.indexOf("email"),
        nameEnd: source.indexOf("email") + "email".length,
      },
      {
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
