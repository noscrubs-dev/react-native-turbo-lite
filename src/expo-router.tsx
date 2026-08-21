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

function expoDocumentUrl(
  params: Record<string, ExpoRouteValue>,
  pathParameter?: string,
  basePath?: string,
): string {
  const pathValue =
    pathParameter === undefined ? undefined : params[pathParameter];
  const segments = Array.isArray(pathValue)
    ? pathValue
    : pathValue === undefined
      ? []
      : [pathValue];
  const prefix = expoBasePath(basePath);
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

function expoBasePath(value: string | undefined): string {
  if (value === undefined || value === "" || value === "/") return "";
  let parsed: URL;
  try {
    parsed = new URL(value, "https://turbo-lite.invalid");
  } catch (cause) {
    throw new Error(
      "Turbo Lite Expo Router basePath must be an absolute path",
      {
        cause,
      },
    );
  }
  if (
    !value.startsWith("/") ||
    parsed.origin !== "https://turbo-lite.invalid" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("Turbo Lite Expo Router basePath must be an absolute path");
  }
  return parsed.pathname.replace(/\/+$/, "");
}

export interface TurboLiteExpoRouteProps {
  /** Static URL prefix containing the route, for example `/server`. */
  basePath?: string;
}

function ExpoRoute({
  basePath,
  pathParameter,
}: TurboLiteExpoRouteProps & { pathParameter?: string }) {
  const baseUrl = useTurboLiteRouterBaseUrl();
  const params = useLocalSearchParams() as Record<string, ExpoRouteValue>;
  const routeNavigation = useNavigation();
  const router = useRouter();
  const navigationLocked = useRef(false);
  const url = expoDocumentUrl(params, pathParameter, basePath);
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
  return <TurboLiteRouterScreen navigation={navigation} url={url} />;
}

/** Route component for the Expo Router `app/index.tsx` route. */
export function TurboLiteExpoIndexRoute({ basePath }: TurboLiteExpoRouteProps) {
  return <ExpoRoute {...(basePath === undefined ? {} : { basePath })} />;
}

/** Route component for an Expo Router `app/[...__turboLitePath].tsx` route. */
export function TurboLiteExpoRoute({ basePath }: TurboLiteExpoRouteProps) {
  return (
    <ExpoRoute
      pathParameter="__turboLitePath"
      {...(basePath === undefined ? {} : { basePath })}
    />
  );
}
