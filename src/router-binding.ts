import { useMemo } from "react";
import { useTurboLiteProviderBaseUrl } from "./react.js";

export function useTurboLiteRouterBaseUrl(): string {
  const baseUrl = useTurboLiteProviderBaseUrl();
  return useMemo(() => {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch (cause) {
      throw new Error(
        "Turbo Lite router bindings require an absolute TurboLiteProvider baseUrl",
        { cause },
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        "Turbo Lite router bindings require an http(s) TurboLiteProvider baseUrl",
      );
    }
    return parsed.href;
  }, [baseUrl]);
}

export function sameOriginRoutePath(url: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  const destination = new URL(url, base);
  if (destination.origin !== base.origin) {
    throw new Error(
      `Cross-origin Turbo Lite navigation is not allowed: ${destination.href}`,
    );
  }
  return `${destination.pathname}${destination.search}${destination.hash}`;
}
