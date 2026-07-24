import { describe, expect, it, vi } from "vitest";
import { attachNodeDebugger } from "./useNodeDebugAttach";

function harness() {
  let root: string | null = "/workspace";
  let trusted = true;
  let hasJs = true;
  let busy = false;
  const openDebugPanel = vi.fn();
  const reportWarning = vi.fn();
  const startDebug = vi.fn(async () => undefined);
  const prompt = vi.fn((): string | null => "9229");
  return {
    options: {
      getWorkspaceRoot: () => root,
      hasJavaScriptTypeScriptWorkspace: () => hasJs,
      isDebugSessionBusy: () => busy,
      isWorkspaceTrusted: () => trusted,
      openDebugPanel,
      prompter: { prompt },
      reportWarning,
      startDebug,
    },
    openDebugPanel,
    prompt,
    reportWarning,
    setBusy: (value: boolean) => void (busy = value),
    setHasJs: (value: boolean) => void (hasJs = value),
    setRoot: (value: string | null) => void (root = value),
    setTrusted: (value: boolean) => void (trusted = value),
    startDebug,
  };
}

describe("attachNodeDebugger", () => {
  it("prompts with the Node default and starts a strict attach target", async () => {
    const ui = harness();
    await attachNodeDebugger(ui.options);
    expect(ui.prompt).toHaveBeenCalledWith("Node inspector port", "9229");
    expect(ui.openDebugPanel).toHaveBeenCalledOnce();
    expect(ui.startDebug).toHaveBeenCalledWith({ kind: "node-attach", port: 9229 });
  });

  it.each(["", "0", "65536", "9.5", "port", "1e3"])(
    "rejects invalid port %j without opening Debug",
    async (input) => {
      const ui = harness();
      ui.prompt.mockReturnValue(input);
      await attachNodeDebugger(ui.options);
      expect(ui.reportWarning).toHaveBeenCalledWith(expect.stringContaining("1 and 65535"));
      expect(ui.openDebugPanel).not.toHaveBeenCalled();
      expect(ui.startDebug).not.toHaveBeenCalled();
    },
  );

  it("treats prompt cancellation as a no-op", async () => {
    const ui = harness();
    ui.prompt.mockReturnValue(null);
    await attachNodeDebugger(ui.options);
    expect(ui.reportWarning).not.toHaveBeenCalled();
    expect(ui.startDebug).not.toHaveBeenCalled();
  });

  it("rechecks root, trust, JS capability, and session state after prompting", async () => {
    for (const invalidate of [
      (ui: ReturnType<typeof harness>) => ui.setRoot("/other"),
      (ui: ReturnType<typeof harness>) => ui.setTrusted(false),
      (ui: ReturnType<typeof harness>) => ui.setHasJs(false),
      (ui: ReturnType<typeof harness>) => ui.setBusy(true),
    ]) {
      const ui = harness();
      ui.prompt.mockImplementation(() => {
        invalidate(ui);
        return "9229";
      });
      await attachNodeDebugger(ui.options);
      expect(ui.openDebugPanel).not.toHaveBeenCalled();
      expect(ui.startDebug).not.toHaveBeenCalled();
    }
  });

  it("does not prompt when attach is already blocked", async () => {
    for (const block of [
      (ui: ReturnType<typeof harness>) => ui.setRoot(null),
      (ui: ReturnType<typeof harness>) => ui.setTrusted(false),
      (ui: ReturnType<typeof harness>) => ui.setHasJs(false),
      (ui: ReturnType<typeof harness>) => ui.setBusy(true),
    ]) {
      const ui = harness();
      block(ui);
      await attachNodeDebugger(ui.options);
      expect(ui.prompt).not.toHaveBeenCalled();
    }
  });
});
