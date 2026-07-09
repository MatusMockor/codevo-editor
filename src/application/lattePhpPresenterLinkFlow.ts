import type { LatteCompletionItem } from "./latteCompletionItems";
import type { LatteProviderFlowFactoryOptions } from "./latteProviderFlowContext";
import type { NavigationRequest } from "./navigationRequest";
import {
  isPhpPresenterLinkCompletionContext as isPhpPresenterLinkCompletionContextFromProvider,
  providePhpPresenterLinkCompletions as providePhpPresenterLinkCompletionsFromProvider,
  providePhpPresenterLinkDefinition as providePhpPresenterLinkDefinitionFromProvider,
} from "./nettePhpLinkProvider";

export interface LattePhpPresenterLinkFlow {
  providePhpPresenterLinkCompletions(
    source: string,
    offset: number,
  ): Promise<LatteCompletionItem[] | null>;
  isPhpPresenterLinkCompletionContext(source: string, offset: number): boolean;
  providePhpPresenterLinkDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  /**
   * @deprecated Use {@link providePhpPresenterLinkCompletions}.
   */
  provideNettePhpLinkCompletions(
    source: string,
    offset: number,
  ): Promise<LatteCompletionItem[] | null>;
  /**
   * @deprecated Use {@link providePhpPresenterLinkDefinition}.
   */
  provideNettePhpLinkDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
}

export interface LattePhpPresenterLinkFlowDriver {
  providePhpPresenterLinkCompletions(
    options: LatteProviderFlowFactoryOptions,
    source: string,
    offset: number,
  ): Promise<LatteCompletionItem[] | null>;
  isPhpPresenterLinkCompletionContext(
    options: LatteProviderFlowFactoryOptions,
    source: string,
    offset: number,
  ): boolean;
  providePhpPresenterLinkDefinition(
    options: LatteProviderFlowFactoryOptions,
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
}

const defaultLattePhpPresenterLinkFlowDriver: LattePhpPresenterLinkFlowDriver = {
  isPhpPresenterLinkCompletionContext:
    isPhpPresenterLinkCompletionContextFromProvider,
  providePhpPresenterLinkCompletions:
    providePhpPresenterLinkCompletionsFromProvider,
  providePhpPresenterLinkDefinition:
    providePhpPresenterLinkDefinitionFromProvider,
};

export function createLattePhpPresenterLinkFlow(
  options: LatteProviderFlowFactoryOptions,
  driver: LattePhpPresenterLinkFlowDriver =
    defaultLattePhpPresenterLinkFlowDriver,
): LattePhpPresenterLinkFlow {
  const providePhpPresenterLinkCompletions = (source: string, offset: number) =>
    driver.providePhpPresenterLinkCompletions(options, source, offset);
  const providePhpPresenterLinkDefinition = (
    source: string,
    offset: number,
    request?: NavigationRequest,
  ) => {
    if (!request) {
      return driver.providePhpPresenterLinkDefinition(options, source, offset);
    }

    return driver.providePhpPresenterLinkDefinition(
      options,
      source,
      offset,
      request,
    );
  };

  return {
    isPhpPresenterLinkCompletionContext: (source, offset) =>
      driver.isPhpPresenterLinkCompletionContext(options, source, offset),
    providePhpPresenterLinkCompletions,
    providePhpPresenterLinkDefinition,
    provideNettePhpLinkCompletions: providePhpPresenterLinkCompletions,
    provideNettePhpLinkDefinition: providePhpPresenterLinkDefinition,
  };
}
