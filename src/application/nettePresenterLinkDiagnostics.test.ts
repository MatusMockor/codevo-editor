import { describe, expect, it, vi } from "vitest";
import {
  nettePresenterActionMethodCandidates,
  nettePresenterClassCandidatePathsForLink,
  parseNetteLinkTarget,
} from "../domain/latteLinkNavigation";
import {
  nettePresenterLinkDiagnostics,
  type NettePresenterLinkDiagnosticContext,
} from "./nettePresenterLinkDiagnostics";

const ROOT = "/ws";
const CURRENT_TEMPLATE = "app/UI/Product/default.latte";

describe("nettePresenterLinkDiagnostics", () => {
  it("warns when a static action link resolves to an existing presenter without an action or render method", async () => {
    const diagnostics = await runDiagnostics(
      `{link Product:show}`,
      {
        "app/UI/Product/ProductPresenter.php": `<?php
class ProductPresenter
{
    public function startup(): void {}
}
`,
      },
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "nette.missingPresenterMethod",
      data: {
        candidateMethodNames: ["actionShow", "renderShow"],
        kind: "missing-presenter-method",
        presenterPath: `${ROOT}/app/UI/Product/ProductPresenter.php`,
        target: "Product:show",
      },
      message:
        "Nette presenter link Product:show resolves to /ws/app/UI/Product/ProductPresenter.php, but actionShow or renderShow was not found.",
      severity: "warning",
      source: "Nette",
    });
  });

  it("accepts existing action and render methods for normal action links", async () => {
    const actionDiagnostics = await runDiagnostics(
      `{link Product:show}`,
      {
        "app/UI/Product/ProductPresenter.php": `<?php
class ProductPresenter
{
    public function actionShow(): void {}
}
`,
      },
    );
    const renderDiagnostics = await runDiagnostics(
      `{link Product:show}`,
      {
        "app/UI/Product/ProductPresenter.php": `<?php
class ProductPresenter
{
    public function renderShow(): void {}
}
`,
      },
    );

    expect(actionDiagnostics).toEqual([]);
    expect(renderDiagnostics).toEqual([]);
  });

  it("skips presenters whose action could be inherited from an app base presenter", async () => {
    const diagnostics = await runDiagnostics(
      `{link Product:show}`,
      {
        "app/UI/Product/ProductPresenter.php": `<?php
class ProductPresenter extends BasePresenter
{
}
`,
      },
    );

    expect(diagnostics).toEqual([]);
  });

  it("skips presenters whose action could be provided by a trait", async () => {
    const diagnostics = await runDiagnostics(
      `{link Product:show}`,
      {
        "app/UI/Product/ProductPresenter.php": `<?php
class ProductPresenter extends Presenter
{
    use ProductActions;
}
`,
      },
    );

    expect(diagnostics).toEqual([]);
  });

  it("skips presenters whose trait use appears after an existing method", async () => {
    const diagnostics = await runDiagnostics(
      `{link Product:show}`,
      {
        "app/UI/Product/ProductPresenter.php": `<?php
class ProductPresenter extends Presenter
{
    public function startup(): void {}

    use ProductActions;
}
`,
      },
    );

    expect(diagnostics).toEqual([]);
  });

  it("keeps direct Nette presenter subclasses eligible for local diagnostics", async () => {
    const diagnostics = await runDiagnostics(
      `{link Product:show}`,
      {
        "app/UI/Product/ProductPresenter.php": `<?php
class ProductPresenter extends \\Nette\\Application\\UI\\Presenter
{
}
`,
      },
    );

    expect(diagnostics).toHaveLength(1);
  });

  it("requires handle methods for signal links", async () => {
    const diagnostics = await runDiagnostics(
      `{link Product:delete!}`,
      {
        "app/UI/Product/ProductPresenter.php": `<?php
class ProductPresenter
{
    public function actionDelete(): void {}
    public function renderDelete(): void {}
}
`,
      },
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.data).toMatchObject({
      candidateMethodNames: ["handleDelete"],
      presenterPath: `${ROOT}/app/UI/Product/ProductPresenter.php`,
      target: "Product:delete!",
    });
  });

  it("accepts component-relative signal links handled by the component class", async () => {
    const diagnostics = await nettePresenterLinkDiagnostics(
      context({
        currentRelativePath:
          "app/modules/apiModule/Components/api_listing.latte",
        files: {
          "app/modules/apiModule/Components/ApiListingControl.php": `<?php
class ApiListingControl
{
    public function handleSelect($id): void {}
}
`,
        },
      }),
      `{link Select! 1}`,
    );

    expect(diagnostics).toEqual([]);
  });

  it("skips dynamic links, this links, and unsafe current-presenter relative targets", async () => {
    const readFileContent = vi.fn(async () => {
      throw new Error("should not read");
    });
    const diagnostics = await nettePresenterLinkDiagnostics(
      context({
        currentRelativePath: "templates/default.latte",
        files: {},
        readFileContent,
      }),
      `{link $target}
{link this}
{link show}`,
    );

    expect(diagnostics).toEqual([]);
    expect(readFileContent).not.toHaveBeenCalled();
  });

  it("skips missing presenter files", async () => {
    const readFileContent = vi.fn(async () => {
      throw new Error("missing");
    });
    const diagnostics = await nettePresenterLinkDiagnostics(
      context({ files: {}, readFileContent }),
      `{link Product:show}`,
    );

    expect(diagnostics).toEqual([]);
    expect(readFileContent).toHaveBeenCalled();
  });

  it("reads the same presenter only once for duplicate links", async () => {
    const readFileContent = vi.fn(async () => `<?php
class ProductPresenter
{
}
`);

    const diagnostics = await nettePresenterLinkDiagnostics(
      context({ files: {}, readFileContent }),
      `{link Product:show}
{plink Product:show}
<a n:href="Product:show">`,
    );

    expect(diagnostics).toHaveLength(3);
    expect(readFileContent).toHaveBeenCalledTimes(1);
  });

  it("drops diagnostics when the requested root becomes stale", async () => {
    let active = true;
    const readFileContent = vi.fn(async () => {
      active = false;

      return `<?php
class ProductPresenter
{
}
`;
    });

    const diagnostics = await nettePresenterLinkDiagnostics(
      context({
        files: {},
        isRequestedRootActive: () => active,
        readFileContent,
      }),
      `{link Product:show}`,
    );

    expect(diagnostics).toEqual([]);
  });
});

async function runDiagnostics(
  source: string,
  files: Record<string, string>,
) {
  return nettePresenterLinkDiagnostics(context({ files }), source);
}

function context(
  options: {
    currentRelativePath?: string;
    files: Record<string, string>;
    isRequestedRootActive?: () => boolean;
    readFileContent?: (path: string) => Promise<string>;
  },
): NettePresenterLinkDiagnosticContext {
  return {
    currentRelativePath: options.currentRelativePath ?? CURRENT_TEMPLATE,
    deps: {
      joinPath: (root, relativePath) => `${root}/${relativePath}`,
      readFileContent:
        options.readFileContent ??
        (async (path) => {
          const relativePath = path.startsWith(`${ROOT}/`)
            ? path.slice(ROOT.length + 1)
            : path;
          const source = options.files[relativePath];

          if (source === undefined) {
            throw new Error(`missing ${path}`);
          }

          return source;
        }),
    },
    frameworkCapabilities: {
      parsePresenterLinkTarget: parseNetteLinkTarget,
      presenterActionMethodCandidates: nettePresenterActionMethodCandidates,
      presenterClassCandidatePathsForLink: nettePresenterClassCandidatePathsForLink,
    },
    isRequestedRootActive: options.isRequestedRootActive ?? (() => true),
    requestedRoot: ROOT,
  };
}
