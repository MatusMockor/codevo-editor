// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LanguageServerPlan } from "../../domain/languageServer";
import type { LanguageServerRuntimeStatus } from "../../domain/languageServerRuntime";
import {
  useWorkbenchLanguageRuntimeProjectionRefBridge,
  useWorkbenchLanguageRuntimeProjectionState,
  type WorkbenchLanguageRuntimeProjectionState,
} from "./useWorkbenchLanguageRuntimeProjection";

describe("useWorkbenchLanguageRuntimeProjection", () => {
  let host: HTMLDivElement;
  let root: Root;
  let projection: WorkbenchLanguageRuntimeProjectionState | null;
  const phpStatusRef = { current: null as LanguageServerRuntimeStatus | null };
  const phpStatusRootRef = { current: null as string | null };
  const javaScriptTypeScriptStatusRef = {
    current: null as LanguageServerRuntimeStatus | null,
  };
  const javaScriptTypeScriptStatusRootRef = { current: null as string | null };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    projection = null;
    phpStatusRef.current = null;
    phpStatusRootRef.current = null;
    javaScriptTypeScriptStatusRef.current = null;
    javaScriptTypeScriptStatusRootRef.current = null;
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("starts with independent empty PHP and JavaScript/TypeScript projections", () => {
    expect(currentProjection()).toMatchObject({
      installingManagedPhpactor: false,
      installingManagedTypeScriptLanguageServer: false,
      javaScriptTypeScriptLanguageServerPlan: null,
      javaScriptTypeScriptLanguageServerRuntimeStatus: null,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot: null,
      languageServerPlan: null,
      languageServerRuntimeStatus: null,
      languageServerRuntimeStatusRoot: null,
      languageServerSetupOpen: false,
      phpIdeReadinessVersion: 0,
      phpTools: null,
    });
  });

  it("keeps the two runtime projections isolated and mirrors their committed status owners", () => {
    const phpPlan = readyPlan("phpactor");
    const javaScriptTypeScriptPlan = readyPlan("typeScriptLanguageServer");
    const phpStatus: LanguageServerRuntimeStatus = {
      kind: "starting",
      rootPath: "/workspace/php",
      sessionId: 1,
    };
    const javaScriptTypeScriptStatus: LanguageServerRuntimeStatus = {
      kind: "starting",
      rootPath: "/workspace/typescript",
      sessionId: 2,
    };

    act(() => {
      const current = currentProjection();
      current.setLanguageServerPlan(phpPlan);
      current.setLanguageServerRuntimeStatus(phpStatus);
      current.setLanguageServerRuntimeStatusRoot("/workspace/php");
      current.setJavaScriptTypeScriptLanguageServerPlan(javaScriptTypeScriptPlan);
      current.setJavaScriptTypeScriptLanguageServerRuntimeStatus(javaScriptTypeScriptStatus);
      current.setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot("/workspace/typescript");
    });

    expect(currentProjection().languageServerPlan).toBe(phpPlan);
    expect(currentProjection().javaScriptTypeScriptLanguageServerPlan).toBe(
      javaScriptTypeScriptPlan,
    );
    expect(phpStatusRef.current).toBe(phpStatus);
    expect(phpStatusRootRef.current).toBe("/workspace/php");
    expect(javaScriptTypeScriptStatusRef.current).toBe(javaScriptTypeScriptStatus);
    expect(javaScriptTypeScriptStatusRootRef.current).toBe("/workspace/typescript");
  });

  function Harness() {
    const current = useWorkbenchLanguageRuntimeProjectionState();
    projection = current;
    useWorkbenchLanguageRuntimeProjectionRefBridge({
      javaScriptTypeScriptLanguageServerRuntimeStatus:
        current.javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef: javaScriptTypeScriptStatusRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot:
        current.javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef: javaScriptTypeScriptStatusRootRef,
      languageServerRuntimeStatus: current.languageServerRuntimeStatus,
      languageServerRuntimeStatusRef: phpStatusRef,
      languageServerRuntimeStatusRoot: current.languageServerRuntimeStatusRoot,
      languageServerRuntimeStatusRootRef: phpStatusRootRef,
    });
    return null;
  }

  function currentProjection(): WorkbenchLanguageRuntimeProjectionState {
    if (!projection) throw new Error("Runtime projection did not render");
    return projection;
  }
});

function readyPlan(provider: LanguageServerPlan["provider"]): LanguageServerPlan {
  return {
    command: null,
    initializeRequest: null,
    message: "ready",
    provider,
    status: "ready",
  };
}
