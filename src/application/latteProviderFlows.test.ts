import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PhpCodeActionContext } from "./phpCodeActionTypes";
import type { LatteProviderFlowFactoryOptions } from "./latteProviderFlowContext";
import { createLatteProviderFlows } from "./latteProviderFlows";
import {
  provideLatteCodeActions as provideLatteCodeActionsFlow,
} from "./latteTemplateCodeActions";

vi.mock("./latteTemplateCodeActions", () => ({
  provideLatteCodeActions: vi.fn(async () => []),
}));

describe("createLatteProviderFlows", () => {
  beforeEach(() => {
    vi.mocked(provideLatteCodeActionsFlow).mockClear();
  });

  it("forwards diagnostic context to the Latte code-action flow", async () => {
    const options = flowOptions();
    const range = { end: 17, start: 6 };
    const context: PhpCodeActionContext = {
      diagnostics: [
        {
          code: "nette.missingPresenterMethod",
          data: {
            candidateMethodNames: ["renderDetail"],
            kind: "missing-presenter-method",
            presenterPath: "/ws/app/UI/Home/HomePresenter.php",
            target: "Home:detail",
          },
          message: "Missing presenter method.",
          range: {
            endColumn: 18,
            endLineNumber: 1,
            startColumn: 7,
            startLineNumber: 1,
          },
          source: "Nette",
        },
      ],
    };

    await createLatteProviderFlows(options).provideLatteCodeActions(
      "{link Home:detail}",
      range,
      context,
    );

    expect(provideLatteCodeActionsFlow).toHaveBeenCalledWith(
      options,
      "{link Home:detail}",
      range,
      context,
    );
  });
});

function flowOptions(): LatteProviderFlowFactoryOptions {
  return {
    caches: {
      componentCache: {},
      filterCache: {},
      presenterCache: {},
      templateCache: {},
      templateTypeCache: {},
      viewDataCache: {},
    },
    frameworkCapabilities: {} as never,
    getDependencies: vi.fn(),
    inFlight: {
      filterInFlight: new Map(),
      presenterInFlight: new Map(),
      templateTypeInFlight: new Map(),
      viewDataInFlight: new Map(),
    },
  };
}
