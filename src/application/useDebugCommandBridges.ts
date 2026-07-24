import { useMemo } from "react";
import { createDebugCopyValueCommandBridge } from "./debugCopyValueCommandBridge";
import { createDebugSetVariableCommandBridge } from "./debugSetVariableCommandBridge";
import { createDebugAddToWatchCommandBridge } from "./debugAddToWatchCommandBridge";
import { createJsTestExplorerScopeRunnerBridge } from "./jsTestExplorerScopeRunnerBridge";

export function useDebugCommandBridges() {
  return useMemo(() => {
    const copyValue = createDebugCopyValueCommandBridge();
    const addToWatch = createDebugAddToWatchCommandBridge();
    const setVariable = createDebugSetVariableCommandBridge();
    const jsTestExplorerRunner = createJsTestExplorerScopeRunnerBridge();
    return {
      controllerOptions: {
        debugAddToWatchCommands: addToWatch.commands,
        debugCopyValueCommands: copyValue.commands,
        debugCopyEvaluatePathOnce: copyValue.copyEvaluatePathOnce,
        debugSetVariableCommands: setVariable.commands,
        jsTestExplorerScopeRunner: jsTestExplorerRunner.runner,
      },
      panelOptions: {
        debugAddToWatchBridge: addToWatch,
        debugCopyValueBind: copyValue.bind,
        debugSetVariableFocus: setVariable,
        jsTestExplorerScopeRunnerBind: jsTestExplorerRunner.bind,
      },
    };
  }, []);
}
