import { useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { WorkbenchEditorTabsPortalContext } from "./workbenchEditorTabsPortalContext";

export function WorkbenchEditorTabsPortalProvider({ children }: { readonly children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const claimTarget = useCallback((nextTarget: HTMLElement) => {
    setTarget(nextTarget);
    return () => {
      setTarget((currentTarget) => (currentTarget === nextTarget ? null : currentTarget));
    };
  }, []);
  const value = useMemo(() => ({ target, claimTarget }), [claimTarget, target]);

  return (
    <WorkbenchEditorTabsPortalContext.Provider value={value}>
      {children}
    </WorkbenchEditorTabsPortalContext.Provider>
  );
}

export function WorkbenchEditorTabsPortalTarget() {
  const { claimTarget } = useContext(WorkbenchEditorTabsPortalContext);
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (element === null) return;
    return claimTarget(element);
  }, [claimTarget, element]);

  return <div className="agent-surface__editor-tabs" ref={setElement} />;
}
