import { describe, expect, it, vi } from "vitest";
import {
  nettePresenterActionMethodCandidates,
  nettePresenterClassCandidatePathsForLink,
  parseNetteLinkTarget,
} from "../domain/latteLinkNavigation";
import { netteComponentFactoryDiagnostics } from "./netteComponentFactoryDiagnostics";
import type { NettePresenterLinkDiagnosticContext } from "./nettePresenterLinkDiagnostics";

const ROOT = "/ws";
const TEMPLATE = "app/UI/Home/default.latte";
const PRESENTER = "app/UI/Home/HomePresenter.php";

describe("netteComponentFactoryDiagnostics", () => {
  it("publishes exact per-usage ranges for an authoritative conventional owner", async () => {
    const source = "{control cart}\n{form checkoutForm}";
    const diagnostics = await netteComponentFactoryDiagnostics(
      context({
        files: {
          [PRESENTER]:
            "<?php final class HomePresenter extends \\Nette\\Application\\UI\\Presenter {}",
        },
      }),
      source,
    );

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      character: 9,
      code: "nette.missingComponentFactory",
      data: {
        componentName: "cart",
        kind: "missing-component-factory",
        methodName: "createComponentCart",
        ownerPath: `${ROOT}/${PRESENTER}`,
        target: "cart",
        usageKind: "control",
      },
      endCharacter: 13,
      endLine: 0,
      line: 0,
      severity: "warning",
      source: "Nette",
    });
    expect(diagnostics[1]).toMatchObject({
      character: 6,
      endCharacter: 18,
      endLine: 1,
      line: 1,
    });
  });

  it("suppresses exact, generic, and statically registered factories", async () => {
    for (const body of [
      "protected function createComponentCart(): void {}",
      "protected function createComponent(string $name): void {}",
      "public function startup(): void { $this->addComponent(new X, 'cart'); }",
      "public function startup(): void { $this->addcomponent(new X, 'cart'); }",
      "public function startup(): void { $this->addComponent($x, $name); }",
      "public function startup(): void { $this->addComponent(name: 'cart', component: new X); }",
    ]) {
      const diagnostics = await netteComponentFactoryDiagnostics(
        context({
          files: {
            [PRESENTER]: `<?php class HomePresenter extends \\Nette\\Application\\UI\\Presenter { ${body} }`,
          },
        }),
        "{control cart}",
      );

      expect(diagnostics).toEqual([]);
    }
  });

  it("requires positive direct Nette ownership for conventional files", async () => {
    for (const presenter of [
      "<?php class HomePresenter {}",
      "<?php namespace App\\UI; class HomePresenter extends Presenter {}",
      "<?php class HomePresenter extends ProjectPresenter {}",
    ]) {
      const diagnostics = await netteComponentFactoryDiagnostics(
        context({ files: { [PRESENTER]: presenter } }),
        "{control cart}",
      );

      expect(diagnostics).toEqual([]);
    }

    const imported = await netteComponentFactoryDiagnostics(
      context({
        files: {
          [PRESENTER]:
            "<?php\nnamespace App\\UI;\nuse Nette\\Application\\UI\\Presenter;\nclass HomePresenter extends Presenter {}",
        },
      }),
      "{control cart}",
    );

    expect(imported).toHaveLength(1);
  });

  it("warns for a complete factory owner and suppresses incomplete inheritance", async () => {
    const ownerPath = `${ROOT}/app/Components/CartControl.php`;
    const owner = {
      className: "App\\Components\\CartControl",
      dependencyPaths: [ownerPath],
      factoryPaths: [`${ROOT}/app/Components/CartFactory.php`],
      path: ownerPath,
      source: "<?php class CartControl {}",
    };
    const complete = await netteComponentFactoryDiagnostics(
      context({
        currentRelativePath: "app/Components/cart.latte",
        files: {
          "app/Components/CartControl.php": owner.source,
        },
        loadFactoryTemplateOwner: vi.fn(async () => owner),
      }),
      "{control toolbar}",
    );

    expect(complete).toHaveLength(1);
    expect(complete[0]?.data).toMatchObject({ ownerPath });

    const incomplete = await netteComponentFactoryDiagnostics(
      context({
        currentRelativePath: "app/Components/cart.latte",
        files: {
          "app/Components/CartControl.php": "<?php class CartControl extends ProjectControl {}",
        },
        loadFactoryTemplateOwner: vi.fn(async () => ({
          ...owner,
          source: "<?php class CartControl extends ProjectControl {}",
        })),
        readPhpClassSource: vi.fn(async () => null),
      }),
      "{control toolbar}",
    );

    expect(incomplete).toEqual([]);
  });

  it("suppresses a cached factory hierarchy when the authoritative source changed", async () => {
    const ownerPath = `${ROOT}/app/Components/CartControl.php`;
    const cachedSource = "<?php class CartControl {}";
    const diagnostics = await netteComponentFactoryDiagnostics(
      context({
        currentRelativePath: "app/Components/cart.latte",
        files: {
          "app/Components/CartControl.php":
            "<?php class CartControl { protected function createComponentToolbar(): void {} }",
        },
        loadFactoryTemplateOwner: vi.fn(async () => ({
          className: "App\\Components\\CartControl",
          dependencyPaths: [ownerPath],
          factoryPaths: [`${ROOT}/app/Components/CartFactory.php`],
          path: ownerPath,
          source: cachedSource,
        })),
      }),
      "{control toolbar}",
    );

    expect(diagnostics).toEqual([]);
  });

  it("fails closed for ambiguous owners, stale roots, and oversized templates", async () => {
    const ambiguousTemplate = "app/Components/Home/default.latte";
    const ambiguous = await netteComponentFactoryDiagnostics(
      context({
        currentRelativePath: ambiguousTemplate,
        files: {
          "app/Components/Home/Home.php":
            "<?php class Home extends \\Nette\\Application\\UI\\Presenter {}",
          "app/Components/Home/HomePresenter.php":
            "<?php class HomePresenter extends \\Nette\\Application\\UI\\Presenter {}",
        },
      }),
      "{control cart}",
    );
    expect(ambiguous).toEqual([]);

    let active = true;
    const stale = await netteComponentFactoryDiagnostics(
      context({
        files: {},
        isRequestedRootActive: () => active,
        readFileContent: vi.fn(async () => {
          active = false;
          return "<?php class HomePresenter {}";
        }),
      }),
      "{control cart}",
    );
    expect(stale).toEqual([]);

    const readFileContent = vi.fn(async () => "<?php class HomePresenter {}");
    const oversized = await netteComponentFactoryDiagnostics(
      context({ files: {}, readFileContent }),
      `{control cart}${" ".repeat(750_001)}`,
    );
    expect(oversized).toEqual([]);
    expect(readFileContent).not.toHaveBeenCalled();
  });
});

function context(options: {
  currentRelativePath?: string;
  files: Record<string, string>;
  isRequestedRootActive?: () => boolean;
  loadFactoryTemplateOwner?: NettePresenterLinkDiagnosticContext["loadFactoryTemplateOwner"];
  readFileContent?: (path: string) => Promise<string>;
  readPhpClassSource?: NettePresenterLinkDiagnosticContext["deps"]["readPhpClassSource"];
}): NettePresenterLinkDiagnosticContext {
  return {
    currentRelativePath: options.currentRelativePath ?? TEMPLATE,
    deps: {
      joinPath: (root, relativePath) => `${root}/${relativePath}`,
      readFileContent:
        options.readFileContent ??
        (async (path) => {
          const relativePath = path.slice(ROOT.length + 1);
          const source = options.files[relativePath];

          if (source === undefined) {
            throw new Error(`missing ${path}`);
          }

          return source;
        }),
      readPhpClassSource: options.readPhpClassSource,
      resolveDeclaredType: (_source, typeHint) => typeHint,
    },
    frameworkCapabilities: {
      parsePresenterLinkTarget: parseNetteLinkTarget,
      presenterActionMethodCandidates: nettePresenterActionMethodCandidates,
      presenterClassCandidatePathsForLink: nettePresenterClassCandidatePathsForLink,
    },
    isRequestedRootActive: options.isRequestedRootActive ?? (() => true),
    loadFactoryTemplateOwner: options.loadFactoryTemplateOwner ?? vi.fn(async () => null),
    requestedRoot: ROOT,
  };
}
