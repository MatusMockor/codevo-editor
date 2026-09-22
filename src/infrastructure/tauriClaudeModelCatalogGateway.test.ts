import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUNDLED_CLAUDE_MODEL_MANIFEST } from "../domain/claudeModelCatalog";
import { TauriClaudeModelCatalogGateway } from "./tauriClaudeModelCatalogGateway";
const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
describe("TauriClaudeModelCatalogGateway", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
  });
  it("validates the manifest returned by its narrow IPC command", async () => {
    invoke.mockResolvedValue(BUNDLED_CLAUDE_MODEL_MANIFEST);
    expect(await new TauriClaudeModelCatalogGateway().read()).toEqual(
      BUNDLED_CLAUDE_MODEL_MANIFEST,
    );
    expect(invoke).toHaveBeenCalledWith("get_claude_model_manifest");
  });
  it("fails closed for malformed IPC data", async () => {
    invoke.mockResolvedValue({ ...BUNDLED_CLAUDE_MODEL_MANIFEST, unexpected: true });
    await expect(new TauriClaudeModelCatalogGateway().read()).rejects.toThrow();
  });
  it("validates update events and returns native subscription cleanup", async () => {
    let receive!: (event: { readonly payload: unknown }) => void;
    const stop = vi.fn();
    listen.mockImplementation(async (_name, callback: typeof receive) => {
      receive = callback;
      return stop;
    });
    const publish = vi.fn();
    const unsubscribe = await new TauriClaudeModelCatalogGateway().subscribe(publish);
    receive({ payload: { ...BUNDLED_CLAUDE_MODEL_MANIFEST, unknown: true } });
    expect(publish).not.toHaveBeenCalled();
    receive({ payload: BUNDLED_CLAUDE_MODEL_MANIFEST });
    expect(publish).toHaveBeenCalledWith(BUNDLED_CLAUDE_MODEL_MANIFEST);
    unsubscribe();
    expect(stop).toHaveBeenCalledOnce();
    expect(listen).toHaveBeenCalledWith("claude-model-manifest-updated", expect.any(Function));
  });
});
