import {
  type NavigationProp,
  type ParamListBase,
  type RouteProp,
  StackActions,
  useIsFocused,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { TurboLiteRouterScreen } from "./react.js";
import {
  sameOriginRoutePath,
  useTurboLiteRouterBaseUrl,
} from "./router-binding.js";

/** Serializable params for a Stack or native-stack Turbo Lite screen. */
export interface TurboLiteReactNavigationParams {
  url: string;
}

/** Route component for React Navigation Stack and native-stack screens. */
export function TurboLiteReactNavigationRoute() {
  const baseUrl = useTurboLiteRouterBaseUrl();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const isFocused = useIsFocused();
  const navigationLocked = useRef(false);
  const route =
    useRoute<
      RouteProp<Record<string, TurboLiteReactNavigationParams>, string>
    >();
  const url = route.params?.url;
  const toRoute = useCallback(
    (destination: string) => sameOriginRoutePath(destination, baseUrl),
    [baseUrl],
  );
  useEffect(() => {
    if (isFocused) navigationLocked.current = false;
  }, [isFocused, url]);
  const navigate = useCallback(
    (action: "push" | "replace", destination: string) => {
      if (!navigation.isFocused()) {
        throw new Error(
          "Turbo Lite ignored navigation from an inactive React Navigation route",
        );
      }
      if (navigationLocked.current) return;
      navigationLocked.current = true;
      try {
        navigation.dispatch(
          StackActions[action](route.name, { url: toRoute(destination) }),
        );
      } catch (error) {
        navigationLocked.current = false;
        throw error;
      }
    },
    [navigation, route.name, toRoute],
  );
  const adapter = useMemo(
    () => ({
      push: (destination: string) => navigate("push", destination),
      replace: (destination: string) => navigate("replace", destination),
    }),
    [navigate],
  );
  if (typeof url !== "string" || url.length === 0) {
    throw new Error(
      "TurboLiteReactNavigationRoute requires serializable route params { url: string }",
    );
  }
  return <TurboLiteRouterScreen navigation={adapter} url={url} />;
}
