import { URI } from "monaco-editor/esm/vs/base/common/uri.js";
import { describe, expect, it, vi } from "vitest";
import {
  disposeWorkspaceModels,
  modelPath,
  registerWorkspaceIdentityDescriptor,
  workspaceModelUri,
  workspacePathKeyForModel,
  workspacePathForModel,
} from "./phpMonacoDocumentContext";

function model(uri: string) {
  return { uri: URI.parse(uri) } as never;
}

describe("Monaco workspace model identity", () => {
  it("scopes the same physical path to its project root", () => {
    const path = "/work/project/packages/app/src/index.ts";
    const projectUri = workspaceModelUri("/work/project", path);
    const packageUri = workspaceModelUri("/work/project/packages/app", path);

    expect(projectUri).not.toBeNull();
    expect(packageUri).not.toBeNull();
    expect(projectUri).not.toBe(packageUri);
    expect(modelPath(model(projectUri!))).toBe(path);
    expect(modelPath(model(packageUri!))).toBe(path);
    expect(workspacePathKeyForModel(model(projectUri!))).not.toBe(
      workspacePathKeyForModel(model(packageUri!)),
    );
  });

  it("maps physical path aliases to one model identity", () => {
    const first = workspaceModelUri(
      "/work/project/",
      "/work/project/src/../src/App.ts",
    );
    const second = workspaceModelUri(
      "file:///work/project",
      "file:///work/project/src/App.ts",
    );

    expect(first).toBe(second);
  });

  it("does not decode virtual git and diff models as workspace files", () => {
    expect(modelPath(model("git:/work/project/src/App.ts"))).toBeNull();
    expect(modelPath(model("diff:/work/project/src/App.ts"))).toBeNull();
  });

  it("honors an explicit case and Unicode workspace policy", () => {
    const unregister = registerWorkspaceIdentityDescriptor({
      canonicalRoot: "/Work/Caf\u00e9",
      selectedPath: "/Work/Caf\u00e9",
      caseSensitive: false,
      unicodeNormalizationPolicy: "preserved",
      policy: {
        caseSensitive: false,
        foldCase: (value) => value.toLocaleLowerCase("en-US"),
        unicodeNormalization: "NFC",
      },
      workspaceId: "backend-project-42",
    });

    expect(
      workspaceModelUri("/Work/Caf\u00e9", "/work/cafe\u0301/SRC/App.ts"),
    ).toBe(
      workspaceModelUri("/Work/Caf\u00e9", "/WORK/CAF\u00c9/src/App.ts"),
    );
    unregister();
  });

  it("maps selected raw and canonical root aliases to the descriptor identity", () => {
    const descriptor = {
      canonicalRoot: "/real/Project",
      selectedPath: "/selected/project-link",
      caseSensitive: false,
      unicodeNormalizationPolicy: "preserved" as const,
      policy: {
        caseSensitive: false as const,
        foldCase: (value: string) => value.toLowerCase(),
        unicodeNormalization: "NFC" as const,
      },
      workspaceId: "trusted-project-id",
    };
    const unregister = registerWorkspaceIdentityDescriptor(
      descriptor,
      "/selected/project-link",
    );
    const path = "/REAL/PROJECT/src/App.ts";
    const selected = workspaceModelUri("/SELECTED/PROJECT-LINK/", path);
    const canonical = workspaceModelUri("/real/project", path);

    expect(selected).toBe(canonical);
    expect(selected).toContain("dHJ1c3RlZC1wcm9qZWN0LWlk");
    unregister();

    expect(workspaceModelUri("/selected/project-link", path)).toBeNull();
  });

  it("maps selected-alias descendants onto canonical descendant identities", () => {
    const descriptor = {
      canonicalRoot: "/real/project",
      selectedPath: "/links/project",
      caseSensitive: true,
      unicodeNormalizationPolicy: "preserved" as const,
      policy: { caseSensitive: true as const, unicodeNormalization: "none" as const },
      workspaceId: "trusted-alias-descendants",
    };
    const unregister = registerWorkspaceIdentityDescriptor(descriptor);

    expect(
      workspaceModelUri(
        descriptor.selectedPath,
        `${descriptor.selectedPath}/src/App.ts`,
      ),
    ).toBe(
      workspaceModelUri(
        descriptor.canonicalRoot,
        `${descriptor.canonicalRoot}/src/App.ts`,
      ),
    );
    unregister();
  });

  it("disposes and forgets only models owned by the closing workspace", () => {
    const sharedPath = "/work/packages/app/src/shared.ts";
    const parent = model(workspaceModelUri("/work", sharedPath)!);
    const nested = model(workspaceModelUri("/work/packages/app", sharedPath)!);
    const virtual = model("git:/work/packages/app/src/shared.ts");
    const parentDispose = vi.fn();
    const nestedDispose = vi.fn();
    const virtualDispose = vi.fn();
    Object.assign(parent, { dispose: parentDispose });
    Object.assign(nested, { dispose: nestedDispose });
    Object.assign(virtual, { dispose: virtualDispose });

    disposeWorkspaceModels(
      { editor: { getModels: () => [parent, nested, virtual] } } as never,
      "/work/packages/app",
    );

    expect(nestedDispose).toHaveBeenCalledOnce();
    expect(parentDispose).not.toHaveBeenCalled();
    expect(virtualDispose).not.toHaveBeenCalled();
    expect(workspacePathForModel(nested)).toBeNull();
    expect(workspacePathForModel(parent)).not.toBeNull();
  });
});
