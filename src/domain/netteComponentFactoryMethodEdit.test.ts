import { describe, expect, it } from "vitest";
import type { LanguageServerTextEdit } from "./languageServerFeatures";
import type { WorkspacePathKey } from "./workspacePath";
import {
  planNetteComponentFactoryMethodEdit,
  type NetteComponentFactoryHierarchyClass,
  type NetteComponentFactoryMethodEditRequest,
} from "./netteComponentFactoryMethodEdit";

describe("planNetteComponentFactoryMethodEdit", () => {
  it("plans a native Nette Form factory before the exact class closing brace", () => {
    const source = owner("    public function renderDefault(): void\n    {\n    }");
    const plan = planNetteComponentFactoryMethodEdit(
      request(source, { componentName: "contactForm", usageKind: "form" }),
    );

    expect(plan).not.toBeNull();
    expect(plan?.methodName).toBe("createComponentContactForm");
    expect(applyEdit(source, plan!.edit)).toContain(
      [
        "    protected function createComponentContactForm(): \\Nette\\Application\\UI\\Form",
        "    {",
        "        $form = new \\Nette\\Application\\UI\\Form();",
        "        // TODO: Configure form fields and handlers.",
        "        return $form;",
        "    }",
      ].join("\n"),
    );
  });

  it("uses an explicit compatible PHPDoc strategy without native return syntax", () => {
    const plan = planNetteComponentFactoryMethodEdit(
      request(owner(""), {
        syntax: {
          capability: "nette-ui-phpdoc-types-v1",
          kind: "phpdoc",
          phpVersion: "7.0",
        },
      }),
    );
    const output = applyEdit(owner(""), plan!.edit);

    expect(output).toContain("/** @return \\Nette\\ComponentModel\\IComponent */");
    expect(output).toContain("protected function createComponentCart()");
    expect(output).not.toContain("createComponentCart():");
  });

  it("fails closed without an explicit syntax profile and rejects native PHP 7.0", () => {
    const valid = request(owner(""));

    expect(
      planNetteComponentFactoryMethodEdit({
        ...valid,
        syntax: undefined as unknown as NetteComponentFactoryMethodEditRequest["syntax"],
      }),
    ).toBeNull();
    expect(
      planNetteComponentFactoryMethodEdit({
        ...valid,
        syntax: {
          capability: "nette-ui-native-types-v1",
          kind: "native",
          phpVersion: "7.0",
        } as unknown as NetteComponentFactoryMethodEditRequest["syntax"],
      }),
    ).toBeNull();
    expect(
      planNetteComponentFactoryMethodEdit({
        ...valid,
        syntax: {
          capability: "nette-ui-native-types-v1",
          kind: "native",
          phpVersion: "8.01",
        } as unknown as NetteComponentFactoryMethodEditRequest["syntax"],
      }),
    ).toBeNull();
  });

  it("preserves CRLF and tab indentation", () => {
    const source = [
      "<?php",
      "namespace App;",
      "use Nette\\Application\\UI\\Control;",
      "",
      "\tclass ToolbarControl extends Control",
      "\t{",
      "\t\tprotected function helper(): void",
      "\t\t{",
      "\t\t}",
      "\t}",
    ].join("\r\n");
    const plan = planNetteComponentFactoryMethodEdit(
      request(source, {
        owner: capture(source, "App\\ToolbarControl"),
        componentName: "searchForm",
        usageKind: "form",
      }),
    );

    expect(plan?.edit.newText).toContain(
      "\t\tprotected function createComponentSearchForm(): \\Nette\\Application\\UI\\Form\r\n",
    );
    expect(plan?.edit.newText).toContain("\r\n\t\t\treturn $form;\r\n");
  });

  it.each([
    ["semicolon", namespacedOwner("App\\One", "BasePresenter", ";")],
    ["bracketed", namespacedOwner("App\\One", "BasePresenter", "{")],
  ])("proves an exact BasePresenter hierarchy in a %s namespace", (_style, source) => {
    const base = [
      "<?php",
      "namespace App\\Core;",
      "use Nette\\Application\\UI\\Presenter;",
      "abstract class BasePresenter extends Presenter",
      "{",
      "    protected const SECTION = 'main';",
      "}",
    ].join("\n");
    const plan = planNetteComponentFactoryMethodEdit(
      request(source, {
        ancestors: [capture(base, "App\\Core\\BasePresenter", "/workspace/BasePresenter.php", 2)],
        owner: capture(source, "App\\One\\HomePresenter"),
      }),
    );

    expect(plan).not.toBeNull();
  });

  it("does not leak imports across semicolon namespaces with the same short owner", () => {
    const source = [
      "<?php",
      "namespace Foreign;",
      "use Nette\\Application\\UI\\Presenter;",
      "class HomePresenter extends Presenter {}",
      "namespace App;",
      "class HomePresenter extends Presenter {}",
    ].join("\n");

    expect(
      planNetteComponentFactoryMethodEdit(
        request(source, { owner: capture(source, "App\\HomePresenter") }),
      ),
    ).toBeNull();
  });

  it("does not leak imports across bracketed namespaces", () => {
    const source = [
      "<?php",
      "namespace Foreign {",
      "use Nette\\Application\\UI\\Presenter;",
      "class OtherPresenter extends Presenter {}",
      "}",
      "namespace App {",
      "class HomePresenter extends Presenter {}",
      "}",
    ].join("\n");

    expect(
      planNetteComponentFactoryMethodEdit(
        request(source, { owner: capture(source, "App\\HomePresenter") }),
      ),
    ).toBeNull();
  });

  it.each([
    "use Nette\\Application\\UI\\Presenter, Nette\\Application\\UI\\Control;",
    "use Nette\\Application\\UI\\{Presenter, Control};",
    "use function App\\helper;",
    "use const App\\VALUE;",
  ])("fails closed on unsupported namespace import syntax: %s", (importStatement) => {
    const source = [
      "<?php",
      "namespace App;",
      importStatement,
      "class HomePresenter extends Presenter {}",
    ].join("\n");

    expect(
      planNetteComponentFactoryMethodEdit(
        request(source, { owner: capture(source, "App\\HomePresenter") }),
      ),
    ).toBeNull();
  });

  it("resolves the PHP namespace\\Foo relative-name form exactly", () => {
    const source = [
      "<?php",
      "namespace App;",
      "class HomePresenter extends namespace\\Framework\\BasePresenter {}",
    ].join("\n");
    const base = [
      "<?php",
      "namespace App\\Framework;",
      "abstract class BasePresenter extends \\Nette\\Application\\UI\\Presenter {}",
    ].join("\n");

    expect(
      planNetteComponentFactoryMethodEdit(
        request(source, {
          ancestors: [capture(base, "App\\Framework\\BasePresenter", "/workspace/Base.php", 2)],
          owner: capture(source, "App\\HomePresenter"),
        }),
      ),
    ).not.toBeNull();
  });

  it("rejects an ancestor parser proof bound to a different source identity", () => {
    const source = namespacedOwner("App", "BasePresenter", ";");
    const base = owner("").replace("class HomePresenter", "abstract class BasePresenter");
    const stale = {
      ...capture(base, "BasePresenter", "/workspace/Base.php", 2),
      parserProof: {
        contentHash: "sha256:stale",
        kind: "parser-clean",
        pathKey: "/workspace/Base.php",
      } as const,
    };

    expect(
      planNetteComponentFactoryMethodEdit(
        request(source, {
          ancestors: [stale],
          owner: capture(source, "App\\HomePresenter"),
        }),
      ),
    ).toBeNull();
  });

  it.each([
    "protected function createComponentCart(",
    "public function unrelated(",
    "public $broken =",
    "#[Broken(",
    "#[Route] public function incomplete(",
    "const BROKEN = ;",
    "const BROKEN = [1, 2;",
    "public array $broken = ['x' => (1 + 2];",
  ])("fails closed on any malformed top-level member: %s", (member) => {
    expect(planNetteComponentFactoryMethodEdit(request(owner(`    ${member}`)))).toBeNull();
  });

  it("includes constants and attributes in the indentation proof", () => {
    const source = owner(
      [
        "    #[\\Attribute]",
        "    protected const SECTION = 'main';",
        "    #[\\Deprecated]",
        "    public function helper(): void {}",
      ].join("\n"),
    );

    expect(planNetteComponentFactoryMethodEdit(request(source))).not.toBeNull();

    const inconsistent = source.replace("    #[\\Deprecated]", "  #[\\Deprecated]");
    expect(planNetteComponentFactoryMethodEdit(request(inconsistent))).toBeNull();
  });

  it.each([
    "protected function createComponentCart(): void {}",
    "protected function CREATECOMPONENTCART(): void {}",
    "protected function createComponent(string $name): void {}",
    "public function startup(): void { $this->addComponent(new X(), 'CART'); }",
    "public function startup(): void { $this->addComponent($component, $name); }",
    "use FactoryTrait;",
  ])("checks factory, registration and traits case-insensitively across captures: %s", (member) => {
    const base = owner(`    ${member}`).replace(
      "class HomePresenter",
      "abstract class BasePresenter",
    );
    const child = namespacedOwner("App", "\\BasePresenter", ";");

    expect(
      planNetteComponentFactoryMethodEdit(
        request(child, {
          ancestors: [capture(base, "BasePresenter", "/workspace/Base.php", 2)],
          owner: capture(child, "App\\HomePresenter"),
        }),
      ),
    ).toBeNull();
  });

  it("uses UTF-16 LSP characters when astral Unicode precedes an inline owner", () => {
    const source =
      "<?php\n// 😀\nclass HomePresenter extends \\Nette\\Application\\UI\\Presenter {}";
    const plan = planNetteComponentFactoryMethodEdit(request(source));

    expect(plan).not.toBeNull();
    expect(applyEdit(source, plan!.edit)).toContain("createComponentCart");
    expect(plan?.edit.range.start.line).toBe(2);
    expect(plan?.edit.range.start.character).toBe(source.split("\n")[2]!.indexOf("}"));
  });

  it("rejects mixed namespace styles, traits, ambiguous hierarchy and parser-proof mismatch", () => {
    const mixed =
      "<?php\nnamespace A; class HomePresenter extends \\Nette\\Application\\UI\\Presenter {}\nnamespace B { class X {} }";
    const traitOwner = owner("    use FactoryTrait;");
    const unresolved = namespacedOwner("App", "BasePresenter", ";");
    const changed = {
      ...capture(owner(""), "HomePresenter"),
      parserProof: {
        contentHash: "sha256:changed",
        kind: "parser-clean",
        pathKey: "/workspace/Owner.php",
      } as const,
    };

    expect(planNetteComponentFactoryMethodEdit(request(mixed))).toBeNull();
    expect(planNetteComponentFactoryMethodEdit(request(traitOwner))).toBeNull();
    expect(
      planNetteComponentFactoryMethodEdit(
        request(unresolved, { owner: capture(unresolved, "App\\HomePresenter") }),
      ),
    ).toBeNull();
    expect(planNetteComponentFactoryMethodEdit(request(owner(""), { owner: changed }))).toBeNull();
    expect(
      planNetteComponentFactoryMethodEdit(
        request(owner(""), {
          owner: {
            ...capture(owner(""), "HomePresenter"),
            parserProof: undefined as unknown as NetteComponentFactoryHierarchyClass["parserProof"],
          },
        }),
      ),
    ).toBeNull();
  });

  it("bounds source, names, paths and hierarchy depth", () => {
    const valid = request(owner(""));
    const tooMany = Array.from({ length: 33 }, (_, index) =>
      capture(owner(""), `Base${index}`, `/workspace/${index}.php`, index + 2),
    );

    for (const candidate of [
      { ...valid, componentName: "Cart" },
      { ...valid, componentName: "cart-item" },
      {
        ...valid,
        owner: {
          ...valid.owner,
          identity: {
            ...valid.owner.identity,
            pathKey: `/${"x".repeat(4_096)}` as WorkspacePathKey,
          },
        },
      },
      { ...valid, ancestors: tooMany },
      {
        ...valid,
        owner: { ...valid.owner, source: `${valid.owner.source}${" ".repeat(750_001)}` },
      },
    ]) {
      expect(planNetteComponentFactoryMethodEdit(candidate)).toBeNull();
    }
  });

  it("returns a deeply immutable exact insertion edit", () => {
    const plan = planNetteComponentFactoryMethodEdit(request(owner("")))!;

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.edit)).toBe(true);
    expect(Object.isFrozen(plan.edit.range)).toBe(true);
    expect(Object.isFrozen(plan.edit.range.start)).toBe(true);
    expect(Object.isFrozen(plan.edit.range.end)).toBe(true);
  });
});

function request(
  source: string,
  overrides: Partial<NetteComponentFactoryMethodEditRequest> = {},
): NetteComponentFactoryMethodEditRequest {
  const componentName = overrides.componentName ?? "cart";

  return {
    ancestors: [],
    componentName,
    methodName:
      overrides.methodName ??
      `createComponent${componentName[0]?.toUpperCase()}${componentName.slice(1)}`,
    owner: capture(source, "HomePresenter"),
    syntax: {
      capability: "nette-ui-native-types-v1",
      kind: "native",
      phpVersion: "8.2",
    },
    usageKind: "control",
    workspace: {
      generation: 1,
      ownerKey: "workspace-owner",
      rootKey: "/workspace",
      sessionId: 1,
    },
    ...overrides,
  };
}

function capture(
  source: string,
  className: string,
  path = "/workspace/Owner.php",
  revision = 1,
): NetteComponentFactoryHierarchyClass {
  const contentHash = `sha256:document-${revision}`;
  const identity = {
    contentHash,
    hostEpoch: revision,
    kind: "closed",
    pathKey: path as WorkspacePathKey,
    revision,
  } as const;
  return {
    className,
    identity,
    parserProof: { contentHash, kind: "parser-clean", pathKey: path },
    source,
  };
}

function owner(member: string): string {
  return [
    "<?php",
    "use Nette\\Application\\UI\\Presenter;",
    "",
    "class HomePresenter extends Presenter",
    "{",
    ...(member ? member.split("\n") : []),
    "}",
    "",
  ].join("\n");
}

function namespacedOwner(namespace: string, parent: string, style: ";" | "{"): string {
  if (style === ";") {
    return [
      "<?php",
      `namespace ${namespace};`,
      "use App\\Core\\BasePresenter;",
      `class HomePresenter extends ${parent}`,
      "{",
      "}",
    ].join("\n");
  }

  return [
    "<?php",
    `namespace ${namespace} {`,
    "use App\\Core\\BasePresenter;",
    `class HomePresenter extends ${parent}`,
    "{",
    "}",
    "}",
  ].join("\n");
}

function applyEdit(source: string, edit: LanguageServerTextEdit): string {
  const start = offsetAt(source, edit.range.start.line, edit.range.start.character);
  const end = offsetAt(source, edit.range.end.line, edit.range.end.character);
  return `${source.slice(0, start)}${edit.newText}${source.slice(end)}`;
}

function offsetAt(source: string, targetLine: number, character: number): number {
  let offset = 0;
  for (let line = 0; line < targetLine; line += 1) {
    const newline = source.indexOf("\n", offset);
    if (newline < 0) throw new Error("line out of range");
    offset = newline + 1;
  }
  return offset + character;
}
