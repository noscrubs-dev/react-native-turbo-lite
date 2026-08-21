import {
  type Href,
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from "expo-router";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { TurboLiteRouterScreen } from "./react.js";
import {
  sameOriginRoutePath,
  useTurboLiteRouterBaseUrl,
} from "./router-binding.js";

type ExpoRouteValue = string | string[] | undefined;

function appendValues(
  search: URLSearchParams,
  name: string,
  value: ExpoRouteValue,
): void {
  if (Array.isArray(value)) {
    for (const item of value) search.append(name, item);
  } else if (value !== undefined) {
    search.append(name, value);
  }
}

function expoRouteUrl(
  params: Record<string, ExpoRouteValue>,
  pathParameter?: string,
  pathPrefix?: string,
  property = "basePath",
): string {
  const pathValue =
    pathParameter === undefined ? undefined : params[pathParameter];
  const segments = Array.isArray(pathValue)
    ? pathValue
    : pathValue === undefined
      ? []
      : [pathValue];
  const prefix = expoPathPrefix(pathPrefix, property);
  const suffix = segments
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const pathname = suffix.length === 0 ? prefix || "/" : `${prefix}/${suffix}`;
  const search = new URLSearchParams();
  let hash = "";
  for (const [name, value] of Object.entries(params)) {
    if (name === pathParameter) continue;
    if (name === "#") {
      const fragment = Array.isArray(value) ? value.at(-1) : value;
      if (fragment !== undefined) hash = `#${encodeURIComponent(fragment)}`;
      continue;
    }
    appendValues(search, name, value);
  }
  const query = search.toString();
  return `${pathname}${query.length === 0 ? "" : `?${query}`}${hash}`;
}

function expoPathPrefix(value: string | undefined, property: string): string {
  if (value === undefined || value === "" || value === "/") return "";
  const message = `Turbo Lite Expo Router ${property} must be a static absolute path without query, hash, dot segments, or duplicate slashes`;
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("\\")
  ) {
    throw new Error(message);
  }
  const normalized = value.replace(/\/+$/, "");
  if (normalized.includes("//")) throw new Error(message);
  for (const segment of normalized.split("/").slice(1)) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error(message);
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.startsWith(":") ||
      decoded.includes("[") ||
      decoded.includes("]") ||
      decoded.includes("{") ||
      decoded.includes("}") ||
      decoded.includes("*") ||
      decoded.includes("/") ||
      decoded.includes("\\")
    ) {
      throw new Error(message);
    }
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized, "https://turbo-lite.invalid");
  } catch (cause) {
    throw new Error(message, { cause });
  }
  if (
    parsed.origin !== "https://turbo-lite.invalid" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname !== normalized
  ) {
    throw new Error(message);
  }
  return normalized;
}

function expoDocumentRequestUrl(
  routeUrl: string,
  documentBasePath: string,
): string {
  const prefix = expoPathPrefix(documentBasePath, "documentBasePath");
  if (prefix === "") return routeUrl;
  const suffixIndex = routeUrl.search(/[?#]/);
  const pathname = suffixIndex < 0 ? routeUrl : routeUrl.slice(0, suffixIndex);
  const queryAndHash = suffixIndex < 0 ? "" : routeUrl.slice(suffixIndex);
  return `${prefix}${pathname === "/" ? "" : pathname}${queryAndHash}`;
}

export interface TurboLiteExpoRouteProps {
  /** Static URL prefix containing the route, for example `/server`. */
  basePath?: string;
  /** Static backend path prefix used only for route-owned document GETs. */
  documentBasePath?: string;
}

function ExpoRoute({
  basePath,
  documentBasePath,
  pathParameter,
}: TurboLiteExpoRouteProps & { pathParameter?: string }) {
  const baseUrl = useTurboLiteRouterBaseUrl();
  const params = useLocalSearchParams() as Record<string, ExpoRouteValue>;
  const routeNavigation = useNavigation();
  const router = useRouter();
  const navigationLocked = useRef(false);
  const url = expoRouteUrl(params, pathParameter, basePath);
  const documentUrl =
    documentBasePath === undefined
      ? url
      : expoDocumentRequestUrl(url, documentBasePath);
  useFocusEffect(
    useCallback(() => {
      navigationLocked.current = false;
    }, []),
  );
  useEffect(() => {
    navigationLocked.current = false;
  }, [url]);
  const toRoute = useCallback(
    (destination: string) => sameOriginRoutePath(destination, baseUrl) as Href,
    [baseUrl],
  );
  const navigate = useCallback(
    (action: "push" | "replace", destination: string) => {
      if (!routeNavigation.isFocused()) {
        throw new Error(
          "Turbo Lite ignored navigation from an inactive Expo Router route",
        );
      }
      if (navigationLocked.current) return;
      navigationLocked.current = true;
      try {
        router[action](toRoute(destination));
      } catch (error) {
        navigationLocked.current = false;
        throw error;
      }
    },
    [routeNavigation, router, toRoute],
  );
  const navigation = useMemo(
    () => ({
      push: (destination: string) => navigate("push", destination),
      replace: (destination: string) => navigate("replace", destination),
    }),
    [navigate],
  );
  return (
    <TurboLiteRouterScreen
      documentUrl={documentUrl}
      navigation={navigation}
      url={url}
    />
  );
}

/** Route component for the Expo Router `app/index.tsx` route. */
export function TurboLiteExpoIndexRoute(props: TurboLiteExpoRouteProps) {
  return <ExpoRoute {...props} />;
}

/** Route component for an Expo Router `app/[...__turboLitePath].tsx` route. */
export function TurboLiteExpoRoute(props: TurboLiteExpoRouteProps) {
  return <ExpoRoute pathParameter="__turboLitePath" {...props} />;
}
