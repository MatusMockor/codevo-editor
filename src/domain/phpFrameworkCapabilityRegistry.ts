import {
  phpFrameworkProviderCoreSignature,
  type PhpFrameworkProviderCore,
} from "./phpFrameworkProviderCore";

/** Open capability identifier. Framework adapters may declare new tokens. */
export type PhpFrameworkCapabilityToken = string;

export interface PhpFrameworkCapabilityDefinition<
  Provider extends object,
  Token extends PhpFrameworkCapabilityToken = PhpFrameworkCapabilityToken,
> {
  readonly token: Token;
  readonly isSupportedBy: (provider: Provider) => boolean;
}

export interface PhpFrameworkCapabilityRegistry<
  Token extends PhpFrameworkCapabilityToken = PhpFrameworkCapabilityToken,
> {
  readonly providerSignature: string;
  hasProvider(providerId: string): boolean;
  supports(capability: Token): boolean;
}

export interface CreatePhpFrameworkCapabilityRegistryOptions<
  Provider extends PhpFrameworkProviderCore,
  Token extends PhpFrameworkCapabilityToken = PhpFrameworkCapabilityToken,
> {
  readonly providers: readonly Provider[];
  readonly definitions: readonly PhpFrameworkCapabilityDefinition<
    Provider,
    Token
  >[];
}

export function definePhpFrameworkCapability<
  Provider extends object,
  const Token extends PhpFrameworkCapabilityToken,
>(
  token: Token,
  isSupportedBy: (provider: Provider) => boolean,
): PhpFrameworkCapabilityDefinition<Provider, Token> {
  return { isSupportedBy, token };
}

export function createPhpFrameworkCapabilityRegistry<
  Provider extends PhpFrameworkProviderCore,
  Token extends PhpFrameworkCapabilityToken = PhpFrameworkCapabilityToken,
>(
  options: CreatePhpFrameworkCapabilityRegistryOptions<Provider, Token>,
): PhpFrameworkCapabilityRegistry<Token> {
  const providerSignature = phpFrameworkProviderCoreSignature(
    options.providers,
  );
  const providerIds = new Set(
    options.providers.map((provider) => provider.id),
  );
  const definitions = capabilityDefinitionsByToken(options.definitions);
  const supportedCapabilities = new Set<Token>();

  for (const definition of definitions.values()) {
    if (options.providers.some(definition.isSupportedBy)) {
      supportedCapabilities.add(definition.token);
    }
  }

  return {
    providerSignature,
    hasProvider: (providerId) => providerIds.has(providerId),
    supports: (capability) => supportedCapabilities.has(capability),
  };
}

function capabilityDefinitionsByToken<
  Provider extends object,
  Token extends PhpFrameworkCapabilityToken,
>(
  definitions: readonly PhpFrameworkCapabilityDefinition<Provider, Token>[],
): ReadonlyMap<Token, PhpFrameworkCapabilityDefinition<Provider, Token>> {
  const result = new Map<
    Token,
    PhpFrameworkCapabilityDefinition<Provider, Token>
  >();

  for (const definition of definitions) {
    if (result.has(definition.token)) {
      throw new Error(
        `Duplicate PHP framework capability token: ${definition.token}`,
      );
    }

    result.set(definition.token, definition);
  }

  return result;
}
