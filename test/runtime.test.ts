import { describe, expect, it, vi } from "vitest";
import {
  FrameMissingError,
  ParseError,
  SafetyLimitError,
  TurboLiteError,
  TurboLiteRuntime,
} from "../src/index.js";
import { deferred, nodeById, response, textContent } from "./helpers.js";

const page = (text: string) =>
  `<Screen id="page"><Text>${text}</Text></Screen>`;

describe("TurboLiteRuntime requests", () => {
  it("loads a document, follows the final redirected URL, and tells host navigation", async () => {
    const navigate = vi.fn();
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test/",
      fetch: async () =>
        response(page("Cart"), { url: "https://app.test/cart/final" }),
      navigation: { navigate },
    });
    await runtime.visit("/cart");
    expect(textContent(runtime.getSnapshot().tree)).toBe("Cart");
    expect(runtime.getSnapshot().url).toBe("https://app.test/cart/final");
    expect(navigate).toHaveBeenCalledWith("https://app.test/cart/final", {
      replace: false,
    });
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
    first.resolve(response(page("Old")));
    await oldVisit;
    expect(textContent(runtime.getSnapshot().tree)).toBe("New");
    expect(runtime.getSnapshot().url).toBe("https://app.test/new");
  });

  it("sends Turbo-Frame and replaces only a matching Frame while retaining identity", async () => {
    const requests: Array<{ init: RequestInit; url: string }> = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ init, url });
      if (url.endsWith("/frame")) {
        return response(
          '<Screen><turbo-frame id="summary"><Text>New</Text></turbo-frame><Text id="outside">Wrong</Text></Screen>',
        );
      }
      return response(
        '<Screen><turbo-frame id="summary"><Text>Old</Text></turbo-frame><Text id="outside">Stable</Text></Screen>',
      );
    });
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch,
    });
    await runtime.visit("/cart");
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
      "https://app.test/search?scope=all&tag=wash+%26+fold&tag=dry",
    );
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[1]?.init.body).toBe("item=shirt&item=pants");
    expect(calls[1]?.init.method).toBe("POST");
    expect(new Headers(calls[1]?.init.headers).get("Content-Type")).toContain(
      "application/x-www-form-urlencoded",
    );
  });

  it.each([
    ["document", page("Created"), 201, undefined, "Created"],
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
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          response(
            '<Screen><turbo-frame id="form-result">Old</turbo-frame></Screen>',
          ),
        )
        .mockResolvedValueOnce(response(body, { status }));
      const runtime = new TurboLiteRuntime({
        baseUrl: "https://app.test",
        fetch,
      });
      await runtime.visit("/form");
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
    },
  );

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
    });
    await runtime.visit("/cart");
    await runtime.submit({ action: "/save", entries: [], method: "post" });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2]?.[0]).toBe("https://app.test/cart");
    expect(fetch.mock.calls[2]?.[1].method).toBe("GET");
    expect(textContent(runtime.getSnapshot().tree)).toBe("After refresh");
  });

  it("commits a POST redirect URL and reports it to host navigation", async () => {
    const navigate = vi.fn();
    const runtime = new TurboLiteRuntime({
      baseUrl: "https://app.test",
      fetch: async () =>
        response(page("Receipt"), { url: "https://app.test/orders/42" }),
      navigation: { navigate },
    });
    await runtime.submit({
      action: "/orders",
      entries: [["item", "shirt"]],
      method: "post",
    });
    expect(runtime.getSnapshot().url).toBe("https://app.test/orders/42");
    expect(navigate).toHaveBeenCalledWith("https://app.test/orders/42", {
      replace: false,
    });
  });

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
});
