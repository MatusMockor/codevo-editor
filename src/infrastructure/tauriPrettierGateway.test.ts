import { describe, expect, it, vi } from "vitest";
import { TauriPrettierGateway } from "./tauriPrettierGateway";

describe("TauriPrettierGateway", () => {
  it("invokes the exact Prettier command contract", async () => {
    const result = { status: "ok" as const, formatted: "const value = 1;\n" };
    const invokeCommand = vi.fn(async () => result);
    const gateway = new TauriPrettierGateway(invokeCommand);

    await expect(
      gateway.format("/workspace", "src/app.ts", "const value=1"),
    ).resolves.toBe(result);
    expect(invokeCommand).toHaveBeenCalledWith("run_prettier_format", {
      rootPath: "/workspace",
      relativePath: "src/app.ts",
      content: "const value=1",
    });
  });

  it("carries unavailable and error responses from the Rust command", async () => {
    const unavailable = { status: "unavailable" as const, message: "Trust this workspace to run Prettier." };
    const failure = {
      status: "error" as const,
      kind: "syntax" as const,
      message: "SyntaxError: Unexpected token (1:5)",
    };
    const unavailableGateway = new TauriPrettierGateway(vi.fn(async () => unavailable));
    const failingGateway = new TauriPrettierGateway(vi.fn(async () => failure));

    await expect(unavailableGateway.format("/workspace", "a.ts", "x")).resolves.toEqual(unavailable);
    await expect(failingGateway.format("/workspace", "a.ts", "x")).resolves.toEqual(failure);
  });
});
