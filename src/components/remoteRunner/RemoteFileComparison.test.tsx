// @vitest-environment jsdom
import { act, useEffect, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import RemoteFileComparison from "./RemoteFileComparison";

const lifecycle = vi.hoisted(() => ({ events: [] as string[], attached: false }));
vi.mock("@monaco-editor/react", () => ({
  DiffEditor: (props: {
    onMount: (editor: unknown) => void;
    keepCurrentOriginalModel: boolean;
    keepCurrentModifiedModel: boolean;
  }) => {
    useLayoutEffect(() => {
      lifecycle.attached = true;
      const model = (side: string) => ({
        isDisposed: () => false,
        dispose: () => {
          if (lifecycle.attached) throw new Error("Model disposed before editor reset");
          lifecycle.events.push(side);
        },
      });
      const models = { original: model("original"), modified: model("modified") };
      props.onMount({
        getModel: () => models,
        setModel: (value: unknown) => {
          expect(value).toBeNull();
          lifecycle.attached = false;
          lifecycle.events.push("detach");
        },
      });
      // Mirror adapter cleanup: it must not dispose the owned models itself.
      return () => {
        expect(props.keepCurrentOriginalModel).toBe(true);
        expect(props.keepCurrentModifiedModel).toBe(true);
      };
    }, [props]);
    useEffect(
      () => () => {
        lifecycle.events.push("editor-dispose");
      },
      [],
    );
    return null;
  },
}));

it("detaches both comparison models before disposal when resolving or closing Files", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  lifecycle.events = [];
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<RemoteFileComparison original="server" modified="draft" />));
  await act(async () => root.render(null));
  expect(lifecycle.events).toEqual(["detach", "original", "modified", "editor-dispose"]);
  await act(async () =>
    root.render(<RemoteFileComparison original="new server" modified="draft" />),
  );
  await act(async () => root.unmount());
  expect(lifecycle.events).toEqual([
    "detach",
    "original",
    "modified",
    "editor-dispose",
    "detach",
    "original",
    "modified",
    "editor-dispose",
  ]);
});
