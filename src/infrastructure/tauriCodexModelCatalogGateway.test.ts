import { beforeEach, describe, expect, it, vi } from "vitest";
import wireContract from "../../contracts/codex-model-catalog-wire.json";
import { BUNDLED_CODEX_MODEL_CATALOG } from "../domain/codexModelCatalog";
import { TauriCodexModelCatalogGateway } from "./tauriCodexModelCatalogGateway";
const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

const live = wireContract.catalogs[0].value;

describe("TauriCodexModelCatalogGateway", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
  });
  it("validates the snapshot returned by its narrow IPC command", async () => {
    invoke.mockResolvedValue(live);
    expect(await new TauriCodexModelCatalogGateway().read()).toEqual(live);
    expect(invoke).toHaveBeenCalledWith("get_codex_model_catalog");
  });
  it("fails closed for malformed IPC data", async () => {
    invoke.mockResolvedValue({ ...live, unexpected: true });
    await expect(new TauriCodexModelCatalogGateway().read()).rejects.toThrow(TypeError);
  });
  it("validates update events and returns native subscription cleanup", async () => {
    let receive!: (event: { readonly payload: unknown }) => void;
    const stop = vi.fn();
    listen.mockImplementation(async (_name, callback: typeof receive) => {
      receive = callback;
      return stop;
    });
    const publish = vi.fn();
    const unsubscribe = await new TauriCodexModelCatalogGateway().subscribe(publish);
    receive({ payload: { ...BUNDLED_CODEX_MODEL_CATALOG, revision: 2 } });
    receive({ payload: wireContract.rejectedCatalogs[0].value });
    expect(publish).not.toHaveBeenCalled();
    receive({ payload: live });
    expect(publish).toHaveBeenCalledWith(live);
    unsubscribe();
    expect(stop).toHaveBeenCalledOnce();
    expect(listen).toHaveBeenCalledWith("codex-model-catalog-updated", expect.any(Function));
  });
});
