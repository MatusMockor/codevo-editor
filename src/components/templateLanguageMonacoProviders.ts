import type * as Monaco from "monaco-editor";
import type {
  TemplateLanguageMonacoProviderContext,
  TemplateLanguageMonacoProviderHandlers,
} from "./templateLanguageMonacoTypes";
import { registerBladeTemplateMonacoProviders } from "./bladeTemplateMonacoProviders";
import { registerLatteTemplateMonacoProviders } from "./latteTemplateMonacoProviders";
import { registerNeonTemplateMonacoProviders } from "./neonTemplateMonacoProviders";

type MonacoApi = typeof Monaco;
type Disposable = Monaco.IDisposable;

export type {
  BladeCompletion,
  BladeCompletionKind,
  LatteCompletion,
  LatteCompletionKind,
  NeonCompletion,
  NeonCompletionKind,
  TemplateLanguageProviderRegistry,
  TemplateLanguageMonacoProviderContext,
  TemplateLanguageMonacoProviderHandlers,
} from "./templateLanguageMonacoTypes";
export { toMonacoBladeCompletion } from "./bladeTemplateMonacoProviders";
export { toMonacoLatteCompletion } from "./latteTemplateMonacoProviders";
export { toMonacoNeonCompletion } from "./neonTemplateMonacoProviders";

export function registerTemplateLanguageMonacoProviders<
  Context extends TemplateLanguageMonacoProviderContext,
>(
  monaco: MonacoApi,
  context: Context,
  handlers: TemplateLanguageMonacoProviderHandlers<Context>,
): Disposable {
  const blade = registerBladeTemplateMonacoProviders(monaco, context, handlers);
  const latte = registerLatteTemplateMonacoProviders(monaco, context);
  const neon = registerNeonTemplateMonacoProviders(monaco, context);

  return {
    dispose: () => {
      blade.dispose();
      latte.dispose();
      neon.dispose();
    },
  };
}
