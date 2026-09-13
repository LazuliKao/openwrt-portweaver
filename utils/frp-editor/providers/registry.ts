import { esmProvider } from "./esm";
import { esmrunProvider } from "./esmrun";
import { fastlyProvider, gcoreProvider, jsdelivrProvider } from "./jsdelivr";
import type { MonacoCdnProvider } from "./types";
import { esmUnpkgProvider, unpkgProvider } from "./unpkg";

/**
 * List of registered Monaco CDN providers.
 * You can enable, disable, or comment out any provider here at will.
 * Unused providers will be tree-shaken if omitted from this list.
 */
const ACTIVE_PROVIDERS: readonly MonacoCdnProvider[] = [
  esmProvider,
  jsdelivrProvider,
  fastlyProvider,
  gcoreProvider,
  esmrunProvider,
  esmUnpkgProvider,
  unpkgProvider,
];

export type MonacoSource = string;

export const MONACO_SOURCE_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = ACTIVE_PROVIDERS.filter((provider) => provider.enabled !== false).map(
  (provider) => ({
    value: provider.id,
    label: provider.label,
  }),
);

const providerMap = new Map<string, MonacoCdnProvider>(
  ACTIVE_PROVIDERS.map((provider) => [provider.id, provider]),
);

export function getProvider(id: string): MonacoCdnProvider | undefined {
  return providerMap.get(id);
}

export function registerProvider(provider: MonacoCdnProvider): void {
  providerMap.set(provider.id, provider);
}
