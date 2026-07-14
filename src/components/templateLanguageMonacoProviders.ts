import type * as Monaco from "monaco-editor";
import type {
  TemplateLanguageMonacoProviderContext,
  TemplateLanguageMonacoProviderHandlers,
  TemplateLanguageProviderRegistry,
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

type TemplateLanguageRegistrar = <
  Context extends TemplateLanguageMonacoProviderContext,
>(
  monaco: MonacoApi,
  context: Context,
  handlers: TemplateLanguageMonacoProviderHandlers<Context>,
) => Disposable;

const TEMPLATE_LANGUAGE_REGISTRATIONS: Readonly<
  Record<keyof TemplateLanguageProviderRegistry, TemplateLanguageRegistrar>
> = {
  blade: registerBladeTemplateMonacoProviders,
  latte: registerLatteTemplateMonacoProviders,
  neon: (monaco, context) =>
    registerNeonTemplateMonacoProviders(monaco, context),
};

export function registerTemplateLanguageMonacoProviders<
  Context extends TemplateLanguageMonacoProviderContext,
>(
  monaco: MonacoApi,
  context: Context,
  handlers: TemplateLanguageMonacoProviderHandlers<Context>,
): Disposable {
  const registrations = Object.values(TEMPLATE_LANGUAGE_REGISTRATIONS).map(
    (register) => register(monaco, context, handlers),
  );

  return {
    dispose: () => {
      for (const registration of registrations) {
        registration.dispose();
      }
    },
  };
}
