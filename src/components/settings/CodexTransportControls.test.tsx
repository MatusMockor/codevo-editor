// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import { CodexTransportControls } from "./CodexTransportControls";

describe("Codex connection controls", () => {
  let host: HTMLDivElement;
  let root: Root;
  const save = vi.fn().mockResolvedValue(true);
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    save.mockReset().mockResolvedValue(true);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  function render(enabled = true) {
    act(() =>
      root.render(
        <CodexTransportControls
          preference={{ ...defaultAgentProviderPreferences().codex, enabled }}
          onSave={save}
        />,
      ),
    );
  }
  function select(value: string) {
    const element = host.querySelector("select")!;
    act(() => {
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  function args(value: string) {
    const element = host.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        element,
        value,
      );
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function submit() {
    await act(async () => {
      host.querySelector("button")!.click();
    });
  }
  it("defaults to app server and saves a legacy transport change", async () => {
    render();
    expect(host.querySelector("select")!.value).toBe("appServer");
    expect(host.querySelector("button")!.disabled).toBe(true);
    select("exec");
    expect(host.querySelector("textarea")!.disabled).toBe(true);
    await submit();
    expect(save).toHaveBeenCalledWith({ codexTransport: "exec", codexAppServerArgs: [] });
  });
  it("saves arguments as separate values without shell parsing", async () => {
    render();
    args("--enable\nfeature with spaces");
    await submit();
    expect(save).toHaveBeenCalledWith({
      codexTransport: "appServer",
      codexAppServerArgs: ["--enable", "feature with spaces"],
    });
  });
  it.each([
    "--listen=localhost:1234",
    "--code-mode-host",
    "--strict-config",
    "x\n\ny",
    "é",
    "x".repeat(257),
    Array(17).fill("x").join("\n"),
  ])("refuses invalid arguments %s", async (value) => {
    render();
    args(value);
    expect(host.querySelector("textarea")!.getAttribute("aria-invalid")).toBe("true");
    await submit();
    expect(save).not.toHaveBeenCalled();
  });
  it("disables controls for a disabled provider", async () => {
    render(false);
    expect(host.querySelector("select")!.disabled).toBe(true);
    expect(host.querySelector("textarea")!.disabled).toBe(true);
    await submit();
    expect(save).not.toHaveBeenCalled();
  });
  it.each([false, new Error("failed")])(
    "shows failed persistence and permits retry",
    async (failure) => {
      if (failure instanceof Error) save.mockRejectedValueOnce(failure);
      else save.mockResolvedValueOnce(false);
      render();
      select("exec");
      await submit();
      expect(host.querySelector('[role="alert"]')!.textContent).toContain("Could not save");
      expect(host.querySelector("button")!.disabled).toBe(false);
      await submit();
      expect(host.querySelector('[role="alert"]')).toBeNull();
    },
  );
  it("retains saving ownership and failed draft across optimistic preference publication", async () => {
    let resolve!: (value: boolean) => void;
    save.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    render();
    args("--enable\nfeature");
    await submit();
    act(() =>
      root.render(
        <CodexTransportControls
          preference={{
            ...defaultAgentProviderPreferences().codex,
            codexAppServerArgs: ["--enable", "feature"],
          }}
          onSave={save}
        />,
      ),
    );
    expect(host.querySelector("button")!.textContent).toBe("Saving…");
    expect(host.querySelector("textarea")!.disabled).toBe(true);
    await act(async () => {
      render();
      resolve(false);
    });
    expect(host.querySelector("textarea")!.value).toBe("--enable\nfeature");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("reconciles an external reset made during a pending save", async () => {
    let resolve!: (value: boolean) => void;
    save.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    render();
    args("--enable\nfeature");
    await submit();
    act(() =>
      root.render(
        <CodexTransportControls
          preference={{
            ...defaultAgentProviderPreferences().codex,
            codexAppServerArgs: ["--enable", "feature"],
          }}
          onSave={save}
        />,
      ),
    );
    render();
    await act(async () => resolve(true));
    expect(host.querySelector("textarea")!.value).toBe("");
    expect(host.querySelector("button")!.disabled).toBe(true);
  });
  it("resynchronizes external reset when idle", () => {
    act(() =>
      root.render(
        <CodexTransportControls
          preference={{
            ...defaultAgentProviderPreferences().codex,
            codexTransport: "exec",
            codexAppServerArgs: ["flag"],
          }}
          onSave={save}
        />,
      ),
    );
    render();
    expect(host.querySelector("select")!.value).toBe("appServer");
    expect(host.querySelector("textarea")!.value).toBe("");
  });
  it("prevents repeated saves while persistence is pending", async () => {
    let resolve!: (value: boolean) => void;
    save.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    render();
    select("exec");
    await submit();
    await submit();
    expect(save).toHaveBeenCalledTimes(1);
    expect(host.querySelector("select")!.disabled).toBe(true);
    await act(async () => resolve(true));
  });
});
