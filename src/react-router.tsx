import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { TurboLiteRouterScreen } from "./react.js";
import {
  sameOriginRoutePath,
  useTurboLiteRouterBaseUrl,
} from "./router-binding.js";

/** Route component for a React Router `path="*"` route. */
export function TurboLiteReactRouterRoute() {
  const baseUrl = useTurboLiteRouterBaseUrl();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationLocked = useRef(false);
  const url = `${location.pathname}${location.search}${location.hash}`;
  useEffect(() => {
    navigationLocked.current = false;
  }, [location.key]);
  const toRoute = useCallback(
    (destination: string) => sameOriginRoutePath(destination, baseUrl),
    [baseUrl],
  );
  const performNavigation = useCallback(
    (destination: string, replace: boolean) => {
      if (navigationLocked.current) return;
      navigationLocked.current = true;
      try {
        const route = toRoute(destination);
        if (replace) navigate(route, { replace: true });
        else navigate(route);
      } catch (error) {
        navigationLocked.current = false;
        throw error;
      }
    },
    [navigate, toRoute],
  );
  const navigation = useMemo(
    () => ({
      push: (destination: string) => performNavigation(destination, false),
      replace: (destination: string) => performNavigation(destination, true),
    }),
    [performNavigation],
  );
  return (
    <TurboLiteRouterScreen
      key={location.key}
      navigation={navigation}
      url={url}
    />
  );
}
