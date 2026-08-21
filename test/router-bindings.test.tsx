import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TurboLiteExpoIndexRoute,
  TurboLiteExpoRoute,
} from "../src/expo-router.js";
import {
  createComponentRenderer,
  TurboLiteProvider,
  useTurboLiteLink,
} from "../src/index.js";
import { TurboLiteReactNavigationRoute } from "../src/react-navigation.js";
import { TurboLiteReactRouterRoute } from "../src/react-router.js";
import { sameOriginRoutePath } from "../src/router-binding.js";
import { deferred, response } from "./helpers.js";

const routerMocks = vi.hoisted(() => ({
  expoParams: {} as Record<string, string | string[] | undefined>,
  expoFocused: true,
  expoPush: vi.fn(),
  expoReplace: vi.fn(),
  reactNavigationFocused: true,
  reactNavigationDispatch: vi.fn(),
  reactNavigationRoute: {
    key: "turbo-1",
    name: "Turbo",
    params: { url: "/" },
  },
  reactRouterLocation: {
    hash: "",
    key: "default",
    pathname: "/",
    search: "",
  },
  reactRouterNavigate: vi.fn(),
}));

vi.mock("expo-router", async () => {
  const { useEffect } = await vi.importActual<typeof import("react")>("react");
  return {
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
    useLocalSearchParams: () => routerMocks.expoParams,
    useNavigation: () => ({ isFocused: () => routerMocks.expoFocused }),
    useRouter: () => ({
      push: routerMocks.expoPush,
      replace: routerMocks.expoReplace,
    }),
  };
});

vi.mock("@react-navigation/native", () => ({
  StackActions: {
    push: (name: string, params: unknown) => ({
      payload: { name, params },
      type: "PUSH",
    }),
    replace: (name: string, params: unknown) => ({
      payload: { name, params },
      type: "REPLACE",
    }),
  },
  useIsFocused: () => routerMocks.reactNavigationFocused,
  useNavigation: () => ({
    dispatch: routerMocks.reactNavigationDispatch,
    isFocused: () => routerMocks.reactNavigationFocused,
  }),
  useRoute: () => routerMocks.reactNavigationRoute,
}));

vi.mock("react-router", () => ({
  useLocation: () => routerMocks.reactRouterLocation,
  useNavigate: () => routerMocks.reactRouterNavigate,
}));

function LinkButton({ children }: { children?: ReactNode }) {
  const link = useTurboLiteLink();
  return (
    <button onClick={link.follow} type="button">
      {children}
    </button>
  );
}

function passthrough(type: string): ComponentType<Record<string, unknown>> {
  return function Passthrough({ children }) {
    return createElement(
      "div",
      { "data-native-type": type },
      children as ReactNode,
    );
  };
}

const renderer = createComponentRenderer({
  components: {
    LinkButton: LinkButton as ComponentType<Record<string, unknown>>,
    Screen: passthrough("screen"),
    Text: passthrough("text"),
  },
});

function renderRoute(route: ReactNode, fetch: typeof globalThis.fetch) {
  return render(
    <TurboLiteProvider
      baseUrl="https://app.test/root"
      fetch={fetch}
      renderer={renderer}
    >
      {route}
    </TurboLiteProvider>,
  );
}

beforeEach(() => {
  routerMocks.expoParams = {};
  routerMocks.expoFocused = true;
  routerMocks.reactNavigationFocused = true;
  routerMocks.reactNavigationRoute = {
    key: "turbo-1",
    name: "Turbo",
    params: { url: "/" },
  };
  routerMocks.reactRouterLocation = {
    hash: "",
    key: "default",
    pathname: "/",
    search: "",
  };
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("first-party router bindings", () => {
  it("preserves query, repeated params, and hash in an Expo catch-all route", async () => {
    routerMocks.expoParams = {
      "#": "summary",
      __turboLitePath: ["cart", "items"],
      q: ["wash", "fold"],
    };
    const fetch = vi.fn(async () =>
      response(
        '<Screen><a href="/checkout?coupon=A%20B#payment"><LinkButton>Checkout</LinkButton></a></Screen>',
      ),
    );

    renderRoute(<TurboLiteExpoRoute />, fetch);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "https://app.test/cart/items?q=wash&q=fold#summary",
        expect.objectContaining({ method: "GET" }),
      ),
    );
    fireEvent.click(screen.getByText("Checkout"));
    expect(routerMocks.expoPush).toHaveBeenCalledWith(
      "/checkout?coupon=A%20B#payment",
    );
    expect(routerMocks.expoReplace).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    fireEvent.click(screen.getByText("Checkout"));
    expect(routerMocks.expoPush).toHaveBeenCalledTimes(1);
  });

  it("preserves a turbo query parameter on the Expo index route", async () => {
    routerMocks.expoParams = { turbo: "1" };
    const fetch = vi.fn(async () =>
      response("<Screen><Text>Root</Text></Screen>"),
    );

    renderRoute(<TurboLiteExpoIndexRoute />, fetch);
    await screen.findByText("Root");
    expect(fetch).toHaveBeenCalledWith(
      "https://app.test/?turbo=1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("includes an explicit static base path for a nested Expo route", async () => {
    routerMocks.expoParams = {
      __turboLitePath: ["orders", "42"],
      tab: "items",
    };
    const fetch = vi.fn(async () =>
      response("<Screen><Text>Order</Text></Screen>"),
    );

    renderRoute(<TurboLiteExpoRoute basePath="/server" />, fetch);
    await screen.findByText("Order");
    expect(fetch).toHaveBeenCalledWith(
      "https://app.test/server/orders/42?tab=items",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("pushes the same React Navigation Stack route with serializable URL params", async () => {
    routerMocks.reactNavigationRoute = {
      key: "turbo-7",
      name: "TurboDocument",
      params: { url: "/orders/7?tab=items#total" },
    };
    const fetch = vi.fn(async () =>
      response(
        '<Screen><a href="/orders/7?tab=items#total"><LinkButton>Open again</LinkButton></a></Screen>',
      ),
    );

    renderRoute(<TurboLiteReactNavigationRoute />, fetch);
    await screen.findByText("Open again");
    fireEvent.click(screen.getByText("Open again"));
    expect(routerMocks.reactNavigationDispatch).toHaveBeenCalledWith({
      payload: {
        name: "TurboDocument",
        params: { url: "/orders/7?tab=items#total" },
      },
      type: "PUSH",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    fireEvent.click(screen.getByText("Open again"));
    expect(routerMocks.reactNavigationDispatch).toHaveBeenCalledTimes(1);
  });

  it("uses React Router location state and pushes same-URL entries", async () => {
    routerMocks.reactRouterLocation = {
      hash: "#details",
      key: "account-1",
      pathname: "/account",
      search: "?tab=billing",
    };
    const fetch = vi.fn(async () =>
      response(
        '<Screen><a href="/account?tab=billing#details"><LinkButton>Open again</LinkButton></a></Screen>',
      ),
    );

    renderRoute(<TurboLiteReactRouterRoute />, fetch);
    await screen.findByText("Open again");
    fireEvent.click(screen.getByText("Open again"));
    expect(routerMocks.reactRouterNavigate).toHaveBeenCalledWith(
      "/account?tab=billing#details",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    fireEvent.click(screen.getByText("Open again"));
    expect(routerMocks.reactRouterNavigate).toHaveBeenCalledTimes(1);
  });

  it("ignores navigation completed by an inactive retained native route", async () => {
    routerMocks.expoParams = { __turboLitePath: ["source"] };
    const fetch = vi.fn(async () =>
      response(
        '<Screen><a href="/destination"><LinkButton>Expo destination</LinkButton></a></Screen>',
      ),
    );
    const expoView = renderRoute(<TurboLiteExpoRoute />, fetch);
    await screen.findByText("Expo destination");
    routerMocks.expoFocused = false;
    fireEvent.click(screen.getByText("Expo destination"));
    await Promise.resolve();
    expect(routerMocks.expoPush).not.toHaveBeenCalled();
    expoView.unmount();

    routerMocks.reactNavigationRoute = {
      key: "turbo-source",
      name: "TurboDocument",
      params: { url: "/source" },
    };
    const nativeView = renderRoute(<TurboLiteReactNavigationRoute />, fetch);
    await screen.findByText("Expo destination");
    routerMocks.reactNavigationFocused = false;
    fireEvent.click(screen.getByText("Expo destination"));
    await Promise.resolve();
    expect(routerMocks.reactNavigationDispatch).not.toHaveBeenCalled();
    nativeView.unmount();
  });

  it("gives each React Router history entry a fresh document runtime", async () => {
    routerMocks.reactRouterLocation = {
      hash: "",
      key: "source-entry",
      pathname: "/source",
      search: "",
    };
    const destination = deferred<Response>();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response("<Screen><Text>Source</Text></Screen>"))
      .mockImplementationOnce(() => destination.promise);
    const app = () => (
      <TurboLiteProvider
        baseUrl="https://app.test/root"
        fetch={fetch}
        renderer={renderer}
      >
        <TurboLiteReactRouterRoute />
      </TurboLiteProvider>
    );
    const view = render(app());
    await screen.findByText("Source");

    routerMocks.reactRouterLocation = {
      hash: "",
      key: "destination-entry",
      pathname: "/destination",
      search: "",
    };
    view.rerender(app());
    expect(screen.queryByText("Source")).toBeNull();
    destination.resolve(response("<Screen><Text>Destination</Text></Screen>"));
    await screen.findByText("Destination");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("converts only same-origin destinations into router paths", () => {
    expect(
      sameOriginRoutePath(
        "https://app.test/orders/2?q=a%20b#summary",
        "https://app.test/root",
      ),
    ).toBe("/orders/2?q=a%20b#summary");
    expect(() =>
      sameOriginRoutePath("https://attacker.test/orders", "https://app.test"),
    ).toThrow("Cross-origin Turbo Lite navigation is not allowed");
  });
});
