import { act } from "react";
import { vi } from "vitest";

export async function resolveInReactAct<T>(operation: () => Promise<T>): Promise<T> {
  let result!: T;
  await act(async () => {
    result = await operation();
  });
  return result;
}

export async function waitForReact(assertion: () => void | Promise<void>): Promise<void> {
  await vi.waitFor(async () => {
    await act(async () => Promise.resolve());
    await assertion();
  });
}

export async function flushTextSearchDebounce(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  });
}
