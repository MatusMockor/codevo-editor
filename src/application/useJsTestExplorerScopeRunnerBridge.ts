import { useMemo } from "react";
import { createJsTestExplorerScopeRunnerBridge } from "./jsTestExplorerScopeRunnerBridge";

export function useJsTestExplorerScopeRunnerBridge() {
  return useMemo(() => {
    const jsTestExplorerRunner = createJsTestExplorerScopeRunnerBridge();
    return {
      controllerOptions: {
        jsTestExplorerScopeRunner: jsTestExplorerRunner.runner,
      },
      panelOptions: {
        jsTestExplorerScopeRunnerBind: jsTestExplorerRunner.bind,
      },
    };
  }, []);
}
