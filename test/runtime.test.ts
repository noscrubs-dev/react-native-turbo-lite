import { describe, expect, it, vi } from "vitest";
import {
  FrameMissingError,
  ParseError,
  SafetyLimitError,
  TurboLiteError,
  TurboLiteRuntime,
} from "../src/index.js";
import { createTurboLiteRouterRuntime } from "../src/runtime.js";
import { deferred, nodeById, response, textContent } from "./helpers.js";

const page = (text: string) =>
  `<Screen id="page"><Text>${text}</Text></Screen>`;

describe("TurboLiteRuntime requests", () => {
  it("pushes a full-document GET before fetching and lets the destination perform the sole GET", async () => {
    const push = vi.fn();
    const replace = vi.fn();
    const sourceFetch = vi.fn(async () => response(page("Preferences")));
    const source = new TurboLiteRuntime({
      baseUrl: "https://app.test/",
      fetch: sourceFetch,
      navigation: { push, replace },
    });
    await source.visit("/preferences", { history: "none" });
    await source.visit("/cart");

    expect(textContent(source.getSnapshot().tree)).toBe("Preferences");
    expect(source.getSnapshot().url).toBe("https://app.test/preferences");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("https://app.test/cart");
    expect(replace).not.toHaveBeenCalled();
    expect(sourceFetch).toHaveBeenCalledTimes(1);

    const destinationFetch = vi.fn(async () => response(page("Cart")));
    const destination = new TurboLiteRuntime({
      baseUrl: "https://app.test/",
      fetch: destinationFetch,
    });
    await destination.load("https://app.test/cart");
    expect(textContent(destination.getSnapshot().tree)).toBe("Cart");
    expect(destination.getSnapshot().url).toBe("https://app.test/cart");
    expect(destinationFetch).toHaveBeenCalledTimes(1);
  });

  it("pushes a full-document GET form without submitting it from the source runtime", async () => {
    const push = vi.fn();
    const fetch = vi.fn(async () => response(page("Source")));
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test/",
      fetch,
      navigation: {
        push,
        replace() {},
      },
    });
    await runtime.load("/source");
    await runtime.submit({
      action: "/search?scope=all",
      entries: [
        ["tag", "wash & fold"],
        ["tag", "dry"],
      ],
      method: "get",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(
      "https://app.test/search?tag=wash+%26+fold&tag=dry",
    );
    push.mockClear();
    await runtime.submit({
      action: "/search?scope=all",
      entries: [],
      method: "get",
    });
    expect(push).toHaveBeenCalledWith("https://app.test/search");
    expect(textContent(runtime.getSnapshot().tree)).toBe("Source");
  });

  it.each([
    ["followed response", true],
    ["different final URL", false],
  ])(
    "fails closed on a top-level GET %s instead of committing before replace",
    async (_case, redirected) => {
      const errors: TurboLiteError[] = [];
      const replace = vi.fn();
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(response(page("Stable")))
        .mockResolvedValueOnce(
          response(page("One-shot canonical content"), {
            redirected,
            url: "https://app.test/orders/1",
          }),
        );
      const runtime = new TurboLiteRuntime({
        baseUrl: "https://app.test/",
        fetch,
        navigation: { push() {}, replace },
        onError: (error) => errors.push(error),
      });
      await runtime.load("/stable");
      await runtime.load("/orders/latest");
      expect(textContent(runtime.getSnapshot().tree)).toBe("Stable");
      expect(runtime.getSnapshot().url).toBe("https://app.test/stable");
      expect(replace).not.toHaveBeenCalled();
      expect(errors.at(-1)?.message).toContain("top-level GET redirect");
    },
  );

  it("replaces for a direct GET visit directive before the canonical route performs its sole document GET", async () => {
    const push = vi.fn();
    const replace = vi.fn();
    const aliasFetch = vi.fn(async (_url: string, _init: RequestInit) =>
      response('{"location":"/orders/1"}', {
        contentType: "application/vnd.turbo-lite.visit+json",
      }),
    );
    const alias = new TurboLiteRuntime({
      baseUrl: "https://app.test/",
      fetch: aliasFetch,
      navigation: { push, replace },
    });
    await alias.load("/orders/latest");
    expect(alias.getSnapshot().tree).toBeUndefined();
    expect(aliasFetch).toHaveBeenCalledTimes(1);
    expect(
      new Headers(aliasFetch.mock.calls[0]?.[1].headers).get("Accept"),
    ).toContain("application/vnd.turbo-lite.visit+json");
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("https://app.test/orders/1");

    const canonicalFetch = vi.fn(async () => response(page("Canonical")));
    const canonical = new TurboLiteRuntime({
      baseUrl: "https://app.test/",
      fetch: canonicalFetch,
    });
    await canonical.load("/orders/1");
    expect(textContent(canonical.getSnapshot().tree)).toBe("Canonical");
    expect(canonicalFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a logical route URL while loading and refreshing a separate document URL", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          `${page("Cart")}<turbo-stream action="refresh"></turbo-stream>`,
        ),
      )
      .mockResolvedValueOnce(response(page("Refreshed cart")));
    const runtime = createTurboLiteRouterRuntime(
      {
        baseUrl: "https://app.test/",
        fetch,
        navigation: { push() {}, replace() {} },
      },
      "/screens/cart",
    );

    await runtime.load("/cart");

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://app.test/screens/cart",
      "https://app.test/screens/cart",
    ]);
    expect(runtime.getSnapshot().url).toBe("https://app.test/cart");
    expect(textContent(runtime.getSnapshot().tree)).toBe("Refreshed cart");
  });

  it("does not apply a document path prefix to links, forms, or Frames", async () => {
    const push = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          '<Screen><turbo-frame id="offers" src="offers" loading="lazy"><Text>Old</Text></turbo-frame></Screen>',
        ),
      )
      .mockResolvedValueOnce(
        response('<turbo-frame id="offers"><Text>Offers</Text></turbo-frame>'),
      );
    const runtime = createTurboLiteRouterRuntime(
      {
        baseUrl: "https://app.test/",
        fetch,
        navigation: { push, replace() {} },
      },
      "/screens/cart",
    );

    await runtime.load("/cart");
    await runtime.visit("checkout");
    await runtime.submit({
      action: "search",
      entries: [["q", "pickup"]],
      method: "get",
    });
    await runtime.loadFrame("offers");

    expect(push.mock.calls.map(([url]) => url)).toEqual([
      "https://app.test/checkout",
      "https://app.test/search?q=pickup",
    ]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://app.test/screens/cart",
      "https://app.test/offers",
    ]);
  });

  it("resolves a document GET visit directive against the logical route URL", async () => {
    const replace = vi.fn();
    const runtime = createTurboLiteRouterRuntime(
      {
        baseUrl: "https://app.test/",
        fetch: async () =>
          response('{"location":"canonical"}', {
            contentType: "application/vnd.turbo-lite.visit+json",
          }),
        navigation: { push() {}, replace },
      },
      "/screens/cart",
    );

    await runtime.load("/cart");

    expect(replace).toHaveBeenCalledWith("https://app.test/canonical");
  });

  it("keeps unsafe-form actions and visit directives on the logical route namespace", async () => {
    const push = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(page("Cart")))
      .mockResolvedValueOnce(
        response('{"location":"/orders/42"}', {
          contentType: "application/vnd.turbo-lite.visit+json",
        }),
      );
    const runtime = createTurboLiteRouterRuntime(
      {
        baseUrl: "https://app.test/",
        fetch,
        navigation: { push, replace() {} },
      },
      "/screens/cart",
    );

    await runtime.load("/cart");
    await runtime.submit({ action: "orders", entries: [], method: "post" });

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://app.test/screens/cart",
      "https://app.test/orders",
    ]);
    expect(push).toHaveBeenCalledWith("https://app.test/orders/42");
  });

  it("rejects push in a top-level GET visit directive", async () => {
    const errors: TurboLiteError[] = [];
    const push = vi.fn();
    const replace = vi.fn();
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test/",
      fetch: async () =>
        response('{"location":"/orders/1","action":"push"}', {
          contentType: "application/vnd.turbo-lite.visit+json",
        }),
      navigation: { push, replace },
      onError: (error) => errors.push(error),
    });
    await runtime.load("/orders/latest");
    expect(runtime.getSnapshot().tree).toBeUndefined();
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(errors.at(-1)?.code).toBe("parse");
  });

  it.each([
    ["same URL", "/orders/latest"],
    ["hash-only URL", "#items"],
  ])(
    "rejects a self-targeting top-level GET visit directive using the %s",
    async (_case, location) => {
      const errors: TurboLiteError[] = [];
      const replace = vi.fn();
      const runtime = new TurboLiteRuntime({
        baseUrl: "https://app.test/",
        fetch: async () =>
          response(JSON.stringify({ location }), {
            contentType: "application/vnd.turbo-lite.visit+json",
            url: "https://app.test/orders/latest",
          }),
        navigation: { push() {}, replace },
        onError: (error) => errors.push(error),
      });
      await runtime.load("/orders/latest");
      expect(runtime.getSnapshot().tree).toBeUndefined();
      expect(replace).not.toHaveBeenCalled();
      expect(errors.at(-1)?.message).toContain("replace the route with itself");
    },
  );

  it("performs an explicit replace router-first without fetching in the source runtime", async () => {
    const replace = vi.fn();
    const fetch = vi.fn(async () => response(page("Source")));
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test/",
      fetch,
      navigation: { push() {}, replace },
    });
    await runtime.load("/source");
    await runtime.visit("/canonical", { history: "replace" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("https://app.test/canonical");
    expect(textContent(runtime.getSnapshot().tree)).toBe("Source");
  });

  it("marks router navigation pending and ignores a rapid duplicate visit", async () => {
    const navigation = deferred<void>();
    const push = vi.fn(() => navigation.promise);
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test/",
      fetch: async () => response(page("Source")),
      navigation: { push, replace() {} },
    });
    await runtime.load("/source");
    const first = runtime.visit("/orders/1");
    expect(runtime.getSnapshot().pending).toBe(true);
    const duplicate = runtime.visit("/orders/1");
    expect(push).toHaveBeenCalledTimes(1);
    navigation.resolve(undefined);
    await Promise.all([first, duplicate]);
    expect(runtime.getSnapshot().pending).toBe(false);
  });

  it("preserves a requested fragment when Response.url omits it", async () => {
    const replace = vi.fn();
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test/",
      fetch: async () =>
        response(page("Items"), { url: "https://app.test/orders/1" }),
      navigation: { push() {}, replace },
    });
    await runtime.load("/orders/1#items");
    expect(textContent(runtime.getSnapshot().tree)).toBe("Items");
    expect(runtime.getSnapshot().url).toBe("https://app.test/orders/1#items");
    expect(replace).not.toHaveBeenCalled();
  });

  it("enforces latest-request-wins even when an aborted adapter resolves late", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
    });
    const oldVisit = runtime.visit("/old");
    const newVisit = runtime.visit("/new");
    expect((fetch.mock.calls[0]?.[1].signal as AbortSignal).aborted).toBe(true);
    second.resolve(response(page("New")));
    await newVisit;
    await oldVisit;
    first.resolve(response(page("Old")));
    await Promise.resolve();
    expect(textContent(runtime.getSnapshot().tree)).toBe("New");
    expect(runtime.getSnapshot().url).toBe("https://app.test/new");
  });

  it("sends Turbo-Frame and replaces only a matching Frame while retaining identity", async () => {
    const push = vi.fn();
    const replace = vi.fn();
    const requests: Array<{ init: RequestInit; url: string }> = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ init, url });
      if (url.endsWith("/frame")) {
        return response(
          '<Screen><turbo-frame id="summary"><Text>New</Text></turbo-frame><Text id="outside">Wrong</Text></Screen>',
          {
            redirected: true,
            url: "https://app.test/frame/canonical",
          },
        );
      }
      return response(
        '<Screen><turbo-frame id="summary"><Text>Old</Text></turbo-frame><Text id="outside">Stable</Text></Screen>',
      );
    });
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
      navigation: { push, replace },
    });
    await runtime.load("/cart");
    const before = nodeById(runtime.getSnapshot().tree, "summary");
    const outside = nodeById(runtime.getSnapshot().tree, "outside");
    await runtime.visit("/frame", { frame: "summary" });
    const after = nodeById(runtime.getSnapshot().tree, "summary");
    expect(textContent(after)).toBe("New");
    expect(after).not.toBe(before);
    expect((after as typeof after & { key: string }).key).toBe(
      (before as typeof before & { key: string }).key,
    );
    expect(nodeById(runtime.getSnapshot().tree, "outside")).toBe(outside);
    expect(new Headers(requests[1]?.init.headers).get("Turbo-Frame")).toBe(
      "summary",
    );
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("reports a missing matching Frame and preserves the old Frame", async () => {
    const errors: TurboLiteError[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          '<Screen><turbo-frame id="summary">Old</turbo-frame></Screen>',
        ),
      )
      .mockResolvedValueOnce(
        response('<Screen><turbo-frame id="other">New</turbo-frame></Screen>'),
      );
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
      onError: (error) => errors.push(error),
    });
    await runtime.visit("/cart");
    await runtime.visit("/frame", { frame: "summary" });
    expect(errors.at(-1)).toBeInstanceOf(FrameMissingError);
    expect(textContent(nodeById(runtime.getSnapshot().tree, "summary"))).toBe(
      "Old",
    );
  });

  it("prevents an older request for the same Frame from committing late", async () => {
    const oldFrame = deferred<Response>();
    const newFrame = deferred<Response>();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          '<Screen><turbo-frame id="summary">Initial</turbo-frame></Screen>',
        ),
      )
      .mockImplementationOnce(() => oldFrame.promise)
      .mockImplementationOnce(() => newFrame.promise);
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
    });
    await runtime.visit("/cart");
    const oldVisit = runtime.visit("/old-frame", { frame: "summary" });
    const newVisit = runtime.visit("/new-frame", { frame: "summary" });
    newFrame.resolve(
      response('<Screen><turbo-frame id="summary">New</turbo-frame></Screen>'),
    );
    await newVisit;
    oldFrame.resolve(
      response('<Screen><turbo-frame id="summary">Old</turbo-frame></Screen>'),
    );
    await oldVisit;
    expect(textContent(nodeById(runtime.getSnapshot().tree, "summary"))).toBe(
      "New",
    );
  });

  it("eager-loads Frame src values", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          '<Screen><turbo-frame id="price" src="/price">Loading</turbo-frame></Screen>',
        ),
      )
      .mockResolvedValueOnce(
        response('<Screen><turbo-frame id="price">$12</turbo-frame></Screen>'),
      );
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
    });
    await runtime.visit("/cart");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(textContent(nodeById(runtime.getSnapshot().tree, "price"))).toBe(
        "$12",
      ),
    );
  });

  it("does not request a lazy Frame until the host marks it visible", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          '<Screen><turbo-frame id="price" src="/price" loading="lazy">Placeholder</turbo-frame></Screen>',
        ),
      )
      .mockResolvedValueOnce(
        response('<Screen><turbo-frame id="price">$12</turbo-frame></Screen>'),
      );
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
    });
    await runtime.visit("/cart");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot().frames.price).toMatchObject({
      loading: "lazy",
      state: "idle",
    });
    await runtime.loadFrame("price");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(textContent(nodeById(runtime.getSnapshot().tree, "price"))).toBe(
      "$12",
    );
    expect(runtime.getSnapshot().frames.price?.state).toBe("loaded");
  });

  it("preloads a lazy Frame without committing UI or navigation, then reuses it", async () => {
    const push = vi.fn();
    const replace = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          '<Screen><turbo-frame id="price" src="/price" loading="lazy">Placeholder</turbo-frame></Screen>',
        ),
      )
      .mockResolvedValueOnce(
        response(
          '<Screen><turbo-frame id="price">Prepared</turbo-frame></Screen>',
        ),
      );
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
      navigation: { push, replace },
    });
    await runtime.visit("/cart", { history: "none" });
    await runtime.preloadFrame("price");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(textContent(nodeById(runtime.getSnapshot().tree, "price"))).toBe(
      "Placeholder",
    );
    expect(runtime.getSnapshot().frames.price?.state).toBe("preloaded");
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    await runtime.loadFrame("price");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(textContent(nodeById(runtime.getSnapshot().tree, "price"))).toBe(
      "Prepared",
    );
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("shares an in-flight preload with load and reports invalid preload responses", async () => {
    const prepared = deferred<Response>();
    const errors: TurboLiteError[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          '<Screen><turbo-frame id="price" src="/price" loading="lazy">Placeholder</turbo-frame></Screen>',
        ),
      )
      .mockImplementationOnce(() => prepared.promise)
      .mockResolvedValueOnce(
        response(
          '<Screen><turbo-frame id="bad" src="/bad" loading="lazy">Bad placeholder</turbo-frame></Screen>',
        ),
      )
      .mockResolvedValueOnce(
        response("{}", { contentType: "application/json" }),
      );
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
      onError: (error) => errors.push(error),
    });
    await runtime.visit("/cart");
    const preload = runtime.preloadFrame("price");
    expect(runtime.getSnapshot().frames.price?.state).toBe("preloading");
    expect(runtime.getSnapshot().pending).toBe(false);
    const load = runtime.loadFrame("price");
    prepared.resolve(
      response('<Screen><turbo-frame id="price">Shared</turbo-frame></Screen>'),
    );
    await Promise.all([preload, load]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(textContent(nodeById(runtime.getSnapshot().tree, "price"))).toBe(
      "Shared",
    );

    await runtime.visit("/bad", { history: "none" });
    await runtime.preloadFrame("bad");
    expect(runtime.getSnapshot().frames.bad?.state).toBe("idle");
    expect(errors.at(-1)?.code).toBe("media-type");
  });

  it("does not let an awaited old Frame preload load into a newer document", async () => {
    const oldPreload = deferred<Response>();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          '<Screen><turbo-frame id="price" src="/old-price" loading="lazy">Old placeholder</turbo-frame></Screen>',
        ),
      )
      .mockImplementationOnce(() => oldPreload.promise)
      .mockResolvedValueOnce(
        response(
          '<Screen><turbo-frame id="price" src="/new-price" loading="lazy">New placeholder</turbo-frame></Screen>',
        ),
      );
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
    });
    await runtime.load("/old");
    const preload = runtime.preloadFrame("price");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const load = runtime.loadFrame("price");

    await runtime.load("/new");
    oldPreload.resolve(
      response(
        '<Screen><turbo-frame id="price">Old prepared content</turbo-frame></Screen>',
      ),
    );
    await Promise.all([preload, load]);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(textContent(nodeById(runtime.getSnapshot().tree, "price"))).toBe(
      "New placeholder",
    );
    expect(runtime.getSnapshot().frames.price).toMatchObject({
      src: "/new-price",
      state: "idle",
    });
  });

  it("reports preload and load calls for a Frame without src", async () => {
    const errors: TurboLiteError[] = [];
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch: async () =>
        response(
          '<Screen><turbo-frame id="static">Done</turbo-frame></Screen>',
        ),
      onError: (error) => errors.push(error),
    });
    await runtime.visit("/cart");
    await runtime.preloadFrame("static");
    await runtime.loadFrame("static");
    expect(errors).toHaveLength(2);
    expect(errors.every((error) => error instanceof FrameMissingError)).toBe(
      true,
    );
  });

  it("encodes ordered, repeated GET and POST form fields", async () => {
    const calls: Array<{ init: RequestInit; url: string }> = [];
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test/cart",
      fetch: async (url, init) => {
        calls.push({ init, url });
        return response(page("Done"));
      },
    });
    await runtime.submit({
      action: "/search?scope=all",
      entries: [
        ["tag", "wash & fold"],
        ["tag", "dry"],
      ],
      method: "get",
    });
    await runtime.submit({
      action: "/orders",
      entries: [
        ["item", "shirt"],
        ["item", "pants"],
      ],
      method: "post",
    });
    expect(calls[0]?.url).toBe(
      "https://app.test/search?tag=wash+%26+fold&tag=dry",
    );
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[1]?.init.body).toBe("item=shirt&item=pants");
    expect(calls[1]?.init.method).toBe("POST");
    expect(new Headers(calls[1]?.init.headers).get("Content-Type")).toContain(
      "application/x-www-form-urlencoded",
    );
    expect(new Headers(calls[0]?.init.headers).get("Accept")).not.toContain(
      "application/vnd.turbo-lite.visit+json",
    );
    expect(new Headers(calls[1]?.init.headers).get("Accept")).not.toContain(
      "application/vnd.turbo-lite.visit+json",
    );
  });

  it.each([
    ["422", page("Validation failed"), 422, undefined, "Validation failed"],
    ["server error document", page("Try again"), 500, undefined, "Try again"],
    [
      "Frame",
      '<Screen><turbo-frame id="form-result"><Text>Frame saved</Text></turbo-frame></Screen>',
      200,
      "form-result",
      "Frame saved",
    ],
  ])(
    "POST forms handle %s responses",
    async (_case, body, status, frame, expected) => {
      const push = vi.fn();
      const replace = vi.fn();
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          response(
            '<Screen><turbo-frame id="form-result">Old</turbo-frame></Screen>',
          ),
        )
        .mockResolvedValueOnce(
          response(body, {
            status,
            ...(frame === undefined ? { url: "https://app.test/save" } : {}),
          }),
        );
      const runtime = new TurboLiteRuntime({
        baseUrl: "https://app.test",
        fetch,
        navigation: { push, replace },
      });
      await runtime.load("/form");
      await runtime.submit({
        action: "/save",
        entries: [["name", "Ada"]],
        ...(frame === undefined ? {} : { frame }),
        method: "post",
      });
      const output =
        frame === undefined
          ? runtime.getSnapshot().tree
          : nodeById(runtime.getSnapshot().tree, frame);
      expect(textContent(output)).toBe(expected);
      expect(push).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      if (frame === undefined) {
        expect(runtime.getSnapshot().url).toBe("https://app.test/form");
      }
    },
  );

  it("fails closed on a successful top-level POST document", async () => {
    const errors: TurboLiteError[] = [];
    const push = vi.fn();
    const replace = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(page("Form")))
      .mockResolvedValueOnce(response(page("Created"), { status: 201 }));
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
      navigation: { push, replace },
      onError: (error) => errors.push(error),
    });
    await runtime.load("/form");
    await runtime.submit({ action: "/orders", entries: [], method: "post" });
    expect(textContent(runtime.getSnapshot().tree)).toBe("Form");
    expect(runtime.getSnapshot().url).toBe("https://app.test/form");
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(errors.at(-1)).toMatchObject({ code: "http" });
  });

  it.each([
    ["direct success", false, "https://app.test/orders", "Created"],
    ["followed success", true, "https://app.test/orders/42", "Receipt"],
  ])(
    "commits a %s POST document in routerless mode",
    async (_case, redirected, finalUrl, expected) => {
      const calls: Array<{ init: RequestInit; url: string }> = [];
      const fetch = vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ init, url });
        if (calls.length === 1) return response(page("Form"));
        return response(page(expected), {
          redirected,
          status: redirected ? 200 : 201,
          url: finalUrl,
        });
      });
      const runtime = new TurboLiteRuntime({
        baseUrl: "https://app.test",
        fetch,
      });
      await runtime.load("/form");
      await runtime.submit({ action: "/orders", entries: [], method: "post" });
      expect(textContent(runtime.getSnapshot().tree)).toBe(expected);
      expect(runtime.getSnapshot().url).toBe(finalUrl);
      expect(new Headers(calls[1]?.init.headers).get("Accept")).not.toContain(
        "application/vnd.turbo-lite.visit+json",
      );
    },
  );

  it.each([
    [undefined, "push"],
    ["push", "push"],
    ["replace", "replace"],
  ] as const)(
    "navigates a successful unsafe form using a validated visit directive action=%s",
    async (action, expectedAction) => {
      const push = vi.fn();
      const replace = vi.fn();
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(response(page("Form")))
        .mockResolvedValueOnce(
          response(
            JSON.stringify({
              ...(action === undefined ? {} : { action }),
              location: "/orders/42",
            }),
            { contentType: "application/vnd.turbo-lite.visit+json" },
          ),
        );
      const runtime = new TurboLiteRuntime({
        baseUrl: "https://app.test",
        fetch,
        navigation: { push, replace },
      });
      await runtime.load("/form");
      await runtime.submit({
        action: "/orders",
        entries: [["item", "shirt"]],
        method: "post",
      });

      expect(textContent(runtime.getSnapshot().tree)).toBe("Form");
      expect(runtime.getSnapshot().url).toBe("https://app.test/form");
      expect(expectedAction === "push" ? push : replace).toHaveBeenCalledWith(
        "https://app.test/orders/42",
      );
      expect(expectedAction === "push" ? replace : push).not.toHaveBeenCalled();
      const accept = new Headers(fetch.mock.calls[1]?.[1].headers).get(
        "Accept",
      );
      expect(accept).toContain("application/vnd.turbo-lite.visit+json");
    },
  );

  it.each([
    ["invalid JSON", "{", "parse"],
    ["missing location", '{"action":"push"}', "parse"],
    ["invalid action", '{"location":"/orders/42","action":"forward"}', "parse"],
    ["unknown field", '{"location":"/orders/42","actions":"push"}', "parse"],
    [
      "cross-origin location",
      '{"location":"https://evil.test/orders/42"}',
      "http",
    ],
  ])(
    "rejects a %s visit directive without changing UI or history",
    async (_case, body, code) => {
      const errors: TurboLiteError[] = [];
      const push = vi.fn();
      const replace = vi.fn();
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(response(page("Form")))
        .mockResolvedValueOnce(
          response(body, {
            contentType: "application/vnd.turbo-lite.visit+json",
          }),
        );
      const runtime = new TurboLiteRuntime({
        baseUrl: "https://app.test",
        fetch,
        navigation: { push, replace },
        onError: (error) => errors.push(error),
      });
      await runtime.load("/form");
      await runtime.submit({ action: "/orders", entries: [], method: "post" });
      expect(textContent(runtime.getSnapshot().tree)).toBe("Form");
      expect(runtime.getSnapshot().url).toBe("https://app.test/form");
      expect(push).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(errors.at(-1)?.code).toBe(code);
    },
  );

  it("reports a visit directive when no navigation adapter is configured", async () => {
    const errors: TurboLiteError[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(page("Form")))
      .mockResolvedValueOnce(
        response('{"location":"/orders/42"}', {
          contentType: "application/vnd.turbo-lite.visit+json",
        }),
      );
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
      onError: (error) => errors.push(error),
    });
    await runtime.load("/form");
    await runtime.submit({ action: "/orders", entries: [], method: "post" });
    expect(textContent(runtime.getSnapshot().tree)).toBe("Form");
    expect(errors.at(-1)?.message).toContain("without a navigation adapter");
  });

  it("preserves the source and reports when the router rejects navigation", async () => {
    const errors: TurboLiteError[] = [];
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch: vi
        .fn()
        .mockResolvedValueOnce(response(page("Form")))
        .mockResolvedValueOnce(
          response('{"location":"/orders/42"}', {
            contentType: "application/vnd.turbo-lite.visit+json",
          }),
        ),
      navigation: {
        push() {
          throw new Error("router unavailable");
        },
        replace() {},
      },
      onError: (error) => errors.push(error),
    });
    await runtime.load("/form");
    await runtime.submit({ action: "/orders", entries: [], method: "post" });
    expect(textContent(runtime.getSnapshot().tree)).toBe("Form");
    expect(errors.at(-1)).toMatchObject({
      code: "network",
      url: "https://app.test/orders/42",
    });
  });

  it("applies the response byte limit to visit directives before parsing", async () => {
    const errors: TurboLiteError[] = [];
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch: vi
        .fn()
        .mockResolvedValueOnce(response(page("Form")))
        .mockResolvedValueOnce(
          response(`{"location":"/${"é".repeat(40)}"}`, {
            contentType: "application/vnd.turbo-lite.visit+json",
          }),
        ),
      limits: { responseBytes: 70 },
      navigation: { push() {}, replace() {} },
      onError: (error) => errors.push(error),
    });
    await runtime.load("/form");
    await runtime.submit({ action: "/orders", entries: [], method: "post" });
    expect(textContent(runtime.getSnapshot().tree)).toBe("Form");
    expect(errors.at(-1)).toBeInstanceOf(SafetyLimitError);
  });

  it("applies Stream responses in order, keeps earlier success after failure, and reports diagnostics", async () => {
    const errors: TurboLiteError[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response('<Screen><List id="list">Old</List></Screen>'),
      )
      .mockResolvedValueOnce(
        response(
          '<turbo-stream action="update" target="list"><template><Text>First</Text></template></turbo-stream>' +
            '<turbo-stream action="custom" target="list"><template><Text>Bad</Text></template></turbo-stream>' +
            '<turbo-stream action="append" target="list"><template><Text>Last</Text></template></turbo-stream>',
          { contentType: "text/vnd.turbo-stream.html" },
        ),
      );
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
      onError: (error) => errors.push(error),
    });
    await runtime.visit("/cart");
    await runtime.submit({ action: "/save", entries: [], method: "post" });
    expect(textContent(nodeById(runtime.getSnapshot().tree, "list"))).toBe(
      "FirstLast",
    );
    expect(errors.some((error) => error.code === "stream")).toBe(true);
  });

  it("rejects a route-owned top-level GET Stream without mutating the previous page", async () => {
    const errors: TurboLiteError[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(page("Stable")))
      .mockResolvedValueOnce(
        response(
          '<turbo-stream action="update" target="page"><template>Wrong route</template></turbo-stream>',
          { contentType: "text/vnd.turbo-stream.html" },
        ),
      );
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
      navigation: { push() {}, replace() {} },
      onError: (error) => errors.push(error),
    });
    await runtime.load("/stable");
    await runtime.load("/next");
    expect(textContent(runtime.getSnapshot().tree)).toBe("Stable");
    expect(runtime.getSnapshot().url).toBe("https://app.test/stable");
    expect(errors.at(-1)?.code).toBe("media-type");
  });

  it("rejects a route-owned top-level GET 204 without leaving a silent stale page", async () => {
    const errors: TurboLiteError[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(page("Stable")))
      .mockResolvedValueOnce(response(null, { status: 204 }));
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
      navigation: { push() {}, replace() {} },
      onError: (error) => errors.push(error),
    });
    await runtime.load("/stable");
    await runtime.load("/next");
    expect(textContent(runtime.getSnapshot().tree)).toBe("Stable");
    expect(runtime.getSnapshot().url).toBe("https://app.test/stable");
    expect(errors.at(-1)?.code).toBe("http");
  });

  it("applies embedded Streams after the response document commits", async () => {
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch: async () =>
        response(
          '<Screen><List id="list">Old</List><turbo-stream action="update" target="list"><template><Text>Embedded</Text></template></turbo-stream></Screen>',
        ),
    });
    await runtime.visit("/cart");
    expect(textContent(nodeById(runtime.getSnapshot().tree, "list"))).toBe(
      "Embedded",
    );
  });

  it("reloads the current document for a refresh Stream", async () => {
    const push = vi.fn();
    const replace = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(page("Before")))
      .mockResolvedValueOnce(
        response('<turbo-stream action="refresh"></turbo-stream>', {
          contentType: "text/vnd.turbo-stream.html",
        }),
      )
      .mockResolvedValueOnce(response(page("After refresh")));
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
      navigation: { push, replace },
    });
    await runtime.visit("/cart", { history: "none" });
    await runtime.submit({ action: "/save", entries: [], method: "post" });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2]?.[0]).toBe("https://app.test/cart");
    expect(fetch.mock.calls[2]?.[1].method).toBe("GET");
    expect(textContent(runtime.getSnapshot().tree)).toBe("After refresh");
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("fails closed on a followed unsafe-form redirect document", async () => {
    const errors: TurboLiteError[] = [];
    const push = vi.fn();
    const replace = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(page("Form")))
      .mockResolvedValueOnce(
        response(page("Receipt"), {
          redirected: true,
          url: "https://app.test/orders/42",
        }),
      );
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
      navigation: { push, replace },
      onError: (error) => errors.push(error),
    });
    await runtime.load("/form");
    await runtime.submit({
      action: "/orders",
      entries: [["item", "shirt"]],
      method: "post",
    });
    expect(textContent(runtime.getSnapshot().tree)).toBe("Form");
    expect(runtime.getSnapshot().url).toBe("https://app.test/form");
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(errors.at(-1)?.message).toContain("followed unsafe-form redirect");
  });

  it.each([
    [
      "Stream",
      '<turbo-stream action="update" target="page"><template>Redirected</template></turbo-stream>',
      200,
      "text/vnd.turbo-stream.html",
    ],
    ["204", null, 204, "text/html"],
  ])(
    "fails closed on a followed unsafe-form %s response before applying it",
    async (_case, body, status, contentType) => {
      const errors: TurboLiteError[] = [];
      const push = vi.fn();
      const replace = vi.fn();
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(response(page("Form")))
        .mockResolvedValueOnce(
          response(body, {
            contentType,
            redirected: true,
            status,
            url: "https://app.test/orders/42",
          }),
        );
      const runtime = new TurboLiteRuntime({
        baseUrl: "https://app.test",
        fetch,
        navigation: { push, replace },
        onError: (error) => errors.push(error),
      });
      await runtime.load("/form");
      await runtime.submit({ action: "/orders", entries: [], method: "post" });
      expect(textContent(runtime.getSnapshot().tree)).toBe("Form");
      expect(push).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(errors.at(-1)?.message).toContain("followed unsafe-form redirect");
    },
  );

  it("preserves the committed tree across 204, media, network, parse, and safety failures", async () => {
    const errors: TurboLiteError[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(page("Stable")))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        response("{}", { contentType: "application/json" }),
      )
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response("<Screen>broken"))
      .mockResolvedValueOnce(response(page("x".repeat(100))));
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
      limits: { responseBytes: 50 },
      onError: (error) => errors.push(error),
    });
    await runtime.visit("/good");
    for (const path of ["/empty", "/json", "/offline", "/broken", "/large"]) {
      await runtime.visit(path);
      expect(textContent(runtime.getSnapshot().tree)).toBe("Stable");
    }
    expect(errors.some((error) => error.code === "media-type")).toBe(true);
    expect(errors.some((error) => error.code === "network")).toBe(true);
    expect(errors.some((error) => error instanceof ParseError)).toBe(true);
    expect(errors.some((error) => error instanceof SafetyLimitError)).toBe(
      true,
    );
  });

  it("rejects cross-origin links without making a request", async () => {
    const errors: TurboLiteError[] = [];
    const fetch = vi.fn();
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
      onError: (error) => errors.push(error),
    });
    await runtime.visit("https://evil.test/steal");
    expect(fetch).not.toHaveBeenCalled();
    expect(errors[0]?.code).toBe("http");
  });

  it("rejects a cross-origin final document URL without committing or canonicalizing", async () => {
    const errors: TurboLiteError[] = [];
    const replace = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(page("Stable")))
      .mockResolvedValueOnce(
        response(page("Stolen"), {
          redirected: true,
          url: "https://evil.test/stolen",
        }),
      );
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
      navigation: { push() {}, replace },
      onError: (error) => errors.push(error),
    });
    await runtime.load("/stable");
    await runtime.load("/redirected");
    expect(textContent(runtime.getSnapshot().tree)).toBe("Stable");
    expect(runtime.getSnapshot().url).toBe("https://app.test/stable");
    expect(replace).not.toHaveBeenCalled();
    expect(errors.at(-1)?.code).toBe("http");
  });

  it("rejects cross-origin final URLs for Streams and Frame loads", async () => {
    const errors: TurboLiteError[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          '<Screen><List id="list">Stable</List><turbo-frame id="panel">Old</turbo-frame></Screen>',
        ),
      )
      .mockResolvedValueOnce(
        response(
          '<turbo-stream action="update" target="list"><template>Stolen</template></turbo-stream>',
          {
            contentType: "text/vnd.turbo-stream.html",
            redirected: true,
            url: "https://evil.test/stream",
          },
        ),
      )
      .mockResolvedValueOnce(
        response(
          '<Screen><turbo-frame id="panel">Stolen</turbo-frame></Screen>',
          {
            redirected: true,
            url: "https://evil.test/frame",
          },
        ),
      );
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
      onError: (error) => errors.push(error),
    });
    await runtime.load("/stable");
    await runtime.submit({ action: "/stream", entries: [], method: "post" });
    await runtime.visit("/frame", { frame: "panel" });
    expect(textContent(nodeById(runtime.getSnapshot().tree, "list"))).toBe(
      "Stable",
    );
    expect(textContent(nodeById(runtime.getSnapshot().tree, "panel"))).toBe(
      "Old",
    );
    expect(errors.filter((error) => error.code === "http")).toHaveLength(2);
  });

  it("rejects a cross-origin final URL during Frame preload", async () => {
    const errors: TurboLiteError[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          '<Screen><turbo-frame id="panel" src="/panel" loading="lazy">Old</turbo-frame></Screen>',
        ),
      )
      .mockResolvedValueOnce(
        response(
          '<Screen><turbo-frame id="panel">Stolen</turbo-frame></Screen>',
          {
            redirected: true,
            url: "https://evil.test/frame",
          },
        ),
      );
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
      onError: (error) => errors.push(error),
    });
    await runtime.load("/stable");
    await runtime.preloadFrame("panel");
    expect(textContent(nodeById(runtime.getSnapshot().tree, "panel"))).toBe(
      "Old",
    );
    expect(runtime.getSnapshot().frames.panel?.state).toBe("idle");
    expect(errors.at(-1)?.code).toBe("http");
  });
});
