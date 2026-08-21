import {
  FrameMissingError,
  ParseError,
  SafetyLimitError,
  TurboLiteError,
} from "./errors.js";
import {
  type InternalNode,
  type ParsedDocument,
  publicNode,
  type StreamAction,
} from "./internal.js";
import { parseDocument, parseStreamResponse, resolveLimits } from "./parser.js";
import { normalizeTagName } from "./tags.js";
import {
  applyStreamAction,
  collectFrames,
  findById,
  replaceFrame,
} from "./tree.js";
import type {
  FormEntry,
  SubmitOptions,
  TurboLiteFrameSnapshot,
  TurboLiteRuntimeOptions,
  TurboLiteSnapshot,
  VisitOptions,
} from "./types.js";

const STREAM_MEDIA_TYPE = "text/vnd.turbo-stream.html";
const VISIT_MEDIA_TYPE = "application/vnd.turbo-lite.visit+json";
const DOCUMENT_MEDIA_TYPES = new Set([
  "application/xhtml+xml",
  "application/xml",
  "text/html",
  "text/xml",
]);

function mediaType(response: Response): string {
  return (
    (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? ""
  );
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError")
  );
}

function abortError(): Error {
  const error = new Error("The request was aborted");
  error.name = "AbortError";
  return error;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener("abort", aborted);
      reject(abortError());
    };
    signal.addEventListener("abort", aborted, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

function asError(error: unknown, url: string): TurboLiteError {
  if (error instanceof TurboLiteError) return error;
  return new TurboLiteError("network", "Turbo Lite request failed", {
    cause: error,
    url,
  });
}

interface RequestTarget {
  frame?: string;
  method: "get" | "post";
}

interface VisitDirective {
  action: "push" | "replace";
  location: string;
}

interface PreparedFrame {
  finalUrl: string;
  generation: number;
  parsed: ParsedDocument;
  src: string;
}

interface PreloadRequest {
  controller: AbortController;
  generation: number;
  promise: Promise<void>;
  src: string;
}

export class TurboLiteRuntime {
  readonly #options: Required<Pick<TurboLiteRuntimeOptions, "fetch">> &
    Omit<TurboLiteRuntimeOptions, "fetch" | "limits"> & {
      limits: ReturnType<typeof resolveLimits>;
    };
  readonly #listeners = new Set<() => void>();
  readonly #requests = new Map<
    string,
    { controller: AbortController; id: number }
  >();
  readonly #frameStates = new Map<string, TurboLiteFrameSnapshot>();
  readonly #preparedFrames = new Map<string, PreparedFrame>();
  readonly #preloadRequests = new Map<string, PreloadRequest>();
  #nextRequest = 0;
  #nextNavigation = 0;
  #activeNavigation: number | undefined;
  #documentGeneration = 0;
  #tree: InternalNode | undefined;
  #snapshot: TurboLiteSnapshot = {
    frames: {},
    pending: false,
    revision: 0,
    tree: undefined,
    url: "",
  };
  #disposed = false;

  constructor(options: TurboLiteRuntimeOptions) {
    this.#options = { ...options, limits: resolveLimits(options.limits) };
  }

  getSnapshot = (): TurboLiteSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Load the document owned by a mounted native route. */
  async load(input: string): Promise<void> {
    await this.visit(input, { history: "none" });
  }

  #emit(): void {
    const frames = Object.fromEntries(this.#frameStates);
    const next: TurboLiteSnapshot = {
      frames,
      pending: this.#requests.size > 0 || this.#activeNavigation !== undefined,
      revision: this.#snapshot.revision,
      tree: this.#tree === undefined ? undefined : publicNode(this.#tree),
      url: this.#snapshot.url,
    };
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }

  #report(error: unknown, url: string): void {
    this.#options.onError?.(asError(error, url));
  }

  #resolve(input: string): string {
    const base = this.#snapshot.url || this.#options.baseUrl;
    if (base === undefined) return input;
    let resolved: URL;
    let origin: URL;
    try {
      resolved = new URL(input, base);
      origin = new URL(base);
    } catch (cause) {
      throw new TurboLiteError("http", `Invalid Turbo Lite URL: ${input}`, {
        cause,
        url: input,
      });
    }
    if (resolved.origin !== origin.origin) {
      throw new TurboLiteError(
        "http",
        `Cross-origin Turbo Lite visit is not allowed: ${resolved.href}`,
        { url: resolved.href },
      );
    }
    return resolved.href;
  }

  #responseUrl(response: Response, requestedUrl: string): string {
    const requested = this.#resolve(requestedUrl);
    const finalUrl = this.#resolve(response.url || requested);
    try {
      const requestedParts = new URL(requested);
      const finalParts = new URL(finalUrl);
      if (
        requestedParts.hash !== "" &&
        finalParts.hash === "" &&
        requestedParts.origin === finalParts.origin &&
        requestedParts.pathname === finalParts.pathname &&
        requestedParts.search === finalParts.search
      ) {
        finalParts.hash = requestedParts.hash;
        return finalParts.href;
      }
    } catch {
      // Relative URLs without a configured base have no origin to compare.
    }
    return finalUrl;
  }

  async visit(input: string, options: VisitOptions = {}): Promise<void> {
    let url: string;
    try {
      url = this.#resolve(input);
    } catch (error) {
      this.#report(error, input);
      return;
    }
    if (
      options.frame === undefined &&
      options.history === "none" &&
      this.#tree !== undefined &&
      url === this.#snapshot.url
    ) {
      return;
    }
    const history =
      options.frame === undefined ? (options.history ?? "push") : "none";
    if (
      options.frame === undefined &&
      history !== "none" &&
      this.#options.navigation !== undefined
    ) {
      await this.#navigate(history, url);
      return;
    }
    await this.#request(
      url,
      {
        headers: {
          Accept:
            options.frame === undefined
              ? this.#options.navigation === undefined
                ? "text/html, application/xhtml+xml"
                : `${VISIT_MEDIA_TYPE}, text/html, application/xhtml+xml`
              : "text/html, application/xhtml+xml",
        },
        method: "GET",
      },
      {
        ...(options.frame === undefined ? {} : { frame: options.frame }),
        method: "get",
      },
    );
  }

  async submit(options: SubmitOptions): Promise<void> {
    let url: string;
    try {
      url = this.#resolve(options.action || this.#snapshot.url);
    } catch (error) {
      this.#report(error, options.action);
      return;
    }
    const headers: Record<string, string> = {};
    let body: string | undefined;
    if (options.method === "get") {
      headers.Accept =
        options.frame === undefined
          ? this.#options.navigation === undefined
            ? "text/html, application/xhtml+xml"
            : `${VISIT_MEDIA_TYPE}, text/html, application/xhtml+xml`
          : "text/html, application/xhtml+xml";
      const base = this.#options.baseUrl ?? this.#snapshot.url;
      try {
        const parsed = new URL(url, base);
        parsed.search = encodeEntries(options.entries);
        url = parsed.href;
      } catch {
        const query = encodeEntries(options.entries);
        const hashIndex = url.indexOf("#");
        const hash = hashIndex < 0 ? "" : url.slice(hashIndex);
        const withoutHash = hashIndex < 0 ? url : url.slice(0, hashIndex);
        const queryIndex = withoutHash.indexOf("?");
        const path =
          queryIndex < 0 ? withoutHash : withoutHash.slice(0, queryIndex);
        url = `${path}${query === "" ? "" : `?${query}`}${hash}`;
      }
    } else {
      headers.Accept =
        options.frame === undefined && this.#options.navigation !== undefined
          ? `${STREAM_MEDIA_TYPE}, ${VISIT_MEDIA_TYPE}, text/html, application/xhtml+xml`
          : `${STREAM_MEDIA_TYPE}, text/html, application/xhtml+xml`;
      body = encodeEntries(options.entries);
      headers["Content-Type"] =
        "application/x-www-form-urlencoded;charset=UTF-8";
    }
    if (
      options.method === "get" &&
      options.frame === undefined &&
      this.#options.navigation !== undefined
    ) {
      await this.#navigate("push", url);
      return;
    }
    await this.#request(
      url,
      {
        ...(body === undefined ? {} : { body }),
        headers,
        method: options.method.toUpperCase(),
      },
      {
        ...(options.frame === undefined ? {} : { frame: options.frame }),
        method: options.method,
      },
    );
  }

  async preloadFrame(frameId: string): Promise<void> {
    if (this.#disposed) return;
    const frame = this.#frameStates.get(frameId);
    if (frame?.src === undefined) {
      this.#report(
        new FrameMissingError(frameId, this.#snapshot.url),
        this.#snapshot.url,
      );
      return;
    }
    if (frame.state === "loaded" || frame.state === "loading") return;
    const prepared = this.#preparedFrames.get(frameId);
    if (
      prepared?.generation === this.#documentGeneration &&
      prepared.src === frame.src
    ) {
      return;
    }
    const active = this.#preloadRequests.get(frameId);
    if (
      active?.generation === this.#documentGeneration &&
      active.src === frame.src
    ) {
      await active.promise;
      return;
    }
    active?.controller.abort();
    const controller = new AbortController();
    const generation = this.#documentGeneration;
    const src = frame.src;
    this.#setFrameState(frameId, "preloading");
    const promise = this.#performPreload(frameId, src, generation, controller);
    this.#preloadRequests.set(frameId, {
      controller,
      generation,
      promise,
      src,
    });
    this.#emit();
    await promise;
  }

  async loadFrame(frameId: string): Promise<void> {
    if (this.#disposed) return;
    let frame = this.#frameStates.get(frameId);
    if (frame?.src === undefined) {
      this.#report(
        new FrameMissingError(frameId, this.#snapshot.url),
        this.#snapshot.url,
      );
      return;
    }
    if (frame.state === "loaded" || frame.state === "loading") return;
    const generation = this.#documentGeneration;
    const src = frame.src;
    const active = this.#preloadRequests.get(frameId);
    if (active !== undefined) await active.promise;
    frame = this.#frameStates.get(frameId);
    if (
      this.#disposed ||
      generation !== this.#documentGeneration ||
      frame?.src !== src
    ) {
      return;
    }
    const prepared = this.#preparedFrames.get(frameId);
    if (
      prepared?.generation === this.#documentGeneration &&
      prepared.src === src
    ) {
      await this.#commitPreparedFrame(frameId, prepared);
      return;
    }
    this.#setFrameState(frameId, "loading");
    this.#emit();
    await this.visit(src, { frame: frameId });
  }

  async #performPreload(
    frameId: string,
    src: string,
    generation: number,
    controller: AbortController,
  ): Promise<void> {
    await Promise.resolve();
    let url = src;
    try {
      url = this.#resolve(src);
      const response = await abortable(
        this.#options.fetch(url, {
          headers: {
            Accept: "text/html, application/xhtml+xml",
            "Turbo-Frame": frameId,
          },
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
        }),
        controller.signal,
      );
      if (!this.#ownsPreload(frameId, generation, src)) return;
      const finalUrl = this.#responseUrl(response, url);
      if (response.status === 204) {
        this.#setFrameState(frameId, "idle");
        return;
      }
      const type = mediaType(response);
      if (!DOCUMENT_MEDIA_TYPES.has(type)) {
        throw new TurboLiteError(
          "media-type",
          `Frame preload requires a document response, received: ${type || "missing"}`,
          { url: finalUrl },
        );
      }
      const parsed = parseDocument(await response.text(), {
        limits: this.#options.limits,
        url: finalUrl,
      });
      if (!this.#ownsPreload(frameId, generation, src)) return;
      const match = findById(parsed.tree, frameId);
      if (
        match === undefined ||
        normalizeTagName(match.node.type) !== "turbo-frame"
      ) {
        throw new FrameMissingError(frameId, finalUrl);
      }
      this.#preparedFrames.set(frameId, { finalUrl, generation, parsed, src });
      this.#setFrameState(frameId, "preloaded");
    } catch (error) {
      if (!isAbort(error) && this.#ownsPreload(frameId, generation, src)) {
        this.#setFrameState(frameId, "idle");
        this.#report(error, url);
      }
    } finally {
      if (this.#ownsPreload(frameId, generation, src)) {
        this.#preloadRequests.delete(frameId);
        this.#emit();
      }
    }
  }

  #ownsPreload(frameId: string, generation: number, src: string): boolean {
    const request = this.#preloadRequests.get(frameId);
    return (
      !this.#disposed &&
      generation === this.#documentGeneration &&
      request?.generation === generation &&
      request.src === src
    );
  }

  async #request(
    url: string,
    init: RequestInit,
    target: RequestTarget,
  ): Promise<void> {
    if (this.#disposed) return;
    const slot =
      target.frame === undefined ? "document" : `frame:${target.frame}`;
    if (target.frame === undefined) {
      this.#requests.get(slot)?.controller.abort();
    } else {
      this.#requests.get(slot)?.controller.abort();
      this.#preloadRequests.get(target.frame)?.controller.abort();
      this.#preloadRequests.delete(target.frame);
      this.#preparedFrames.delete(target.frame);
      this.#setFrameState(target.frame, "loading");
    }
    const generation = this.#documentGeneration;
    const id = ++this.#nextRequest;
    const controller = new AbortController();
    this.#requests.set(slot, { controller, id });
    this.#emit();

    try {
      const headers = new Headers(init.headers);
      if (target.frame !== undefined) headers.set("Turbo-Frame", target.frame);
      const response = await abortable(
        this.#options.fetch(url, {
          ...init,
          headers,
          redirect: "follow",
          signal: controller.signal,
        }),
        controller.signal,
      );
      if (!this.#owns(slot, id, generation)) return;
      await this.#applyResponse(response, url, target, () =>
        this.#owns(slot, id, generation),
      );
    } catch (error) {
      if (!isAbort(error) && this.#owns(slot, id, generation))
        this.#report(error, url);
    } finally {
      if (this.#requests.get(slot)?.id === id) {
        this.#requests.delete(slot);
        if (
          target.frame !== undefined &&
          this.#frameStates.get(target.frame)?.state === "loading"
        ) {
          this.#setFrameState(target.frame, "idle");
        }
        this.#emit();
        if (target.frame === undefined) this.#scheduleEagerFrames();
      }
    }
  }

  #owns(slot: string, id: number, generation: number): boolean {
    return (
      !this.#disposed &&
      generation === this.#documentGeneration &&
      this.#requests.get(slot)?.id === id
    );
  }

  async #applyResponse(
    response: Response,
    requestedUrl: string,
    target: RequestTarget,
    ownsRequest: () => boolean,
  ): Promise<void> {
    const finalUrl = this.#responseUrl(response, requestedUrl);
    if (
      target.frame === undefined &&
      target.method === "post" &&
      this.#options.navigation !== undefined &&
      (response.redirected || !sameDocumentUrl(finalUrl, requestedUrl))
    ) {
      throw new TurboLiteError(
        "http",
        `A followed unsafe-form redirect cannot be applied safely; negotiate ${VISIT_MEDIA_TYPE}`,
        { url: finalUrl },
      );
    }
    if (response.status === 204) {
      if (
        target.frame === undefined &&
        target.method === "get" &&
        this.#options.navigation !== undefined
      ) {
        throw new TurboLiteError(
          "http",
          "A route-owned top-level GET requires a document or visit directive, not 204",
          { url: finalUrl },
        );
      }
      return;
    }
    const type = mediaType(response);
    if (
      type !== STREAM_MEDIA_TYPE &&
      type !== VISIT_MEDIA_TYPE &&
      !DOCUMENT_MEDIA_TYPES.has(type)
    ) {
      throw new TurboLiteError(
        "media-type",
        `Unsupported Turbo response media type: ${type || "missing"}`,
        { url: finalUrl },
      );
    }
    const markup = await response.text();
    if (!ownsRequest()) return;

    if (type === VISIT_MEDIA_TYPE) {
      if (
        target.frame !== undefined ||
        !response.ok ||
        response.redirected ||
        !sameDocumentUrl(finalUrl, requestedUrl)
      ) {
        throw new TurboLiteError(
          "http",
          "Turbo Lite visit directives require a direct successful top-level response",
          { url: finalUrl },
        );
      }
      const directive = this.#parseVisitDirective(
        markup,
        finalUrl,
        target.method === "get" ? "replace" : "push",
        target.method === "get" ? "replace" : undefined,
      );
      if (
        target.method === "get" &&
        sameDocumentUrl(directive.location, finalUrl)
      ) {
        throw new TurboLiteError(
          "http",
          "A top-level GET visit directive cannot replace the route with itself",
          { url: finalUrl },
        );
      }
      await this.#navigate(directive.action, directive.location);
      return;
    }

    if (type === STREAM_MEDIA_TYPE) {
      if (
        target.frame === undefined &&
        target.method === "get" &&
        this.#options.navigation !== undefined
      ) {
        throw new TurboLiteError(
          "media-type",
          "A route-owned top-level GET cannot apply a Turbo Stream to the previous native route",
          { url: finalUrl },
        );
      }
      const streams = parseStreamResponse(markup, {
        limits: this.#options.limits,
        url: finalUrl,
      });
      await this.#applyStreams(streams, finalUrl);
      return;
    }

    if (
      target.frame === undefined &&
      target.method === "get" &&
      this.#options.navigation !== undefined &&
      (response.redirected || finalUrl !== requestedUrl)
    ) {
      throw new TurboLiteError(
        "http",
        `A top-level GET redirect cannot commit a document before native route replacement; negotiate ${VISIT_MEDIA_TYPE}`,
        { url: finalUrl },
      );
    }

    const parsed = parseDocument(markup, {
      limits: this.#options.limits,
      url: finalUrl,
    });
    if (target.frame !== undefined) {
      if (this.#tree === undefined) {
        throw new FrameMissingError(target.frame, finalUrl);
      }
      const replaced = replaceFrame(this.#tree, parsed.tree, target.frame);
      if (replaced === undefined)
        throw new FrameMissingError(target.frame, finalUrl);
      this.#tree = replaced;
      this.#syncFrames();
      this.#setFrameState(target.frame, "loaded");
      this.#snapshot = {
        ...this.#snapshot,
        revision: this.#snapshot.revision + 1,
      };
      this.#emit();
    } else {
      if (target.method === "post") {
        if (response.status < 400) {
          if (this.#options.navigation !== undefined) {
            throw new TurboLiteError(
              "http",
              `A successful top-level POST must return a Turbo Stream, 204, or ${VISIT_MEDIA_TYPE}`,
              { url: finalUrl },
            );
          }
          await this.#commitDocument(parsed, finalUrl, true);
          return;
        }
        const sourceUrl = this.#snapshot.url || requestedUrl;
        await this.#commitDocument(parsed, sourceUrl, true);
        return;
      }
      await this.#commitDocument(parsed, finalUrl, true);
    }
    if (target.frame !== undefined)
      await this.#applyStreams(parsed.streams, finalUrl);
    if (ownsRequest()) this.#scheduleEagerFrames(target.frame);
  }

  #parseVisitDirective(
    markup: string,
    responseUrl: string,
    defaultAction: VisitDirective["action"],
    onlyAction?: VisitDirective["action"],
  ): VisitDirective {
    if (
      new TextEncoder().encode(markup).byteLength >
      this.#options.limits.responseBytes
    ) {
      throw new SafetyLimitError(
        "responseBytes",
        `Turbo Lite response exceeds ${this.#options.limits.responseBytes} UTF-8 bytes`,
        responseUrl,
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(markup);
    } catch (cause) {
      throw new ParseError("Turbo Lite visit directive is not valid JSON", {
        cause,
        url: responseUrl,
      });
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ParseError(
        'Turbo Lite visit directive requires { "location": string, "action"?: "push" | "replace" }',
        { url: responseUrl },
      );
    }
    const candidate = value as Record<string, unknown>;
    const action = candidate.action;
    const locationValue = candidate.location;
    if (
      Object.keys(candidate).some(
        (key) => key !== "location" && key !== "action",
      ) ||
      typeof locationValue !== "string" ||
      locationValue.trim() === "" ||
      (action !== undefined && action !== "push" && action !== "replace") ||
      (onlyAction !== undefined &&
        action !== undefined &&
        action !== onlyAction)
    ) {
      throw new ParseError(
        'Turbo Lite visit directive requires { "location": string, "action"?: "push" | "replace" }',
        { url: responseUrl },
      );
    }
    let location: string;
    try {
      location = new URL(locationValue, responseUrl).href;
    } catch (cause) {
      throw new TurboLiteError(
        "http",
        `Invalid Turbo Lite visit location: ${locationValue}`,
        { cause, url: responseUrl },
      );
    }
    location = this.#resolve(location);
    return {
      action:
        action === "push" || action === "replace" ? action : defaultAction,
      location,
    };
  }

  async #navigate(action: "push" | "replace", url: string): Promise<void> {
    if (this.#disposed || this.#activeNavigation !== undefined) return;
    if (this.#options.navigation === undefined) {
      this.#report(
        new TurboLiteError(
          "http",
          "Turbo Lite received a visit directive without a navigation adapter",
          { url },
        ),
        url,
      );
      return;
    }
    const id = ++this.#nextNavigation;
    this.#activeNavigation = id;
    this.#emit();
    try {
      await this.#options.navigation[action](url);
    } catch (cause) {
      if (!this.#disposed && this.#activeNavigation === id) {
        this.#report(
          new TurboLiteError(
            "network",
            `Turbo Lite navigation ${action} failed`,
            { cause, url },
          ),
          url,
        );
      }
    } finally {
      if (this.#activeNavigation === id) {
        this.#activeNavigation = undefined;
        if (!this.#disposed) this.#emit();
      }
    }
  }

  async #commitDocument(
    parsed: ParsedDocument,
    url: string,
    keepCurrentDocumentRequest = false,
  ): Promise<void> {
    this.#documentGeneration++;
    for (const [slot, request] of this.#requests) {
      if (keepCurrentDocumentRequest && slot === "document") continue;
      request.controller.abort();
      this.#requests.delete(slot);
    }
    for (const request of this.#preloadRequests.values())
      request.controller.abort();
    this.#preloadRequests.clear();
    this.#preparedFrames.clear();
    this.#frameStates.clear();
    this.#tree = parsed.tree;
    this.#syncFrames();
    this.#snapshot = {
      ...this.#snapshot,
      revision: this.#snapshot.revision + 1,
      url,
    };
    this.#emit();
    await this.#applyStreams(parsed.streams, url);
    this.#scheduleEagerFrames();
  }

  async #applyStreams(
    streams: readonly StreamAction[],
    url: string,
  ): Promise<void> {
    if (streams.length === 0) return;
    if (this.#tree === undefined) {
      throw new ParseError(
        "Cannot apply Turbo Streams before a document commits",
        {
          url,
        },
      );
    }
    let tree = this.#tree;
    let changed = false;
    let refresh = false;
    for (const stream of streams) {
      try {
        const result = applyStreamAction(tree, stream, url);
        if (result.diagnostic !== undefined)
          this.#report(result.diagnostic, url);
        if (result.tree !== tree) changed = true;
        tree = result.tree;
        refresh ||= result.refresh;
      } catch (error) {
        this.#report(error, url);
      }
    }
    if (changed) {
      this.#tree = tree;
      this.#syncFrames();
      this.#snapshot = {
        ...this.#snapshot,
        revision: this.#snapshot.revision + 1,
      };
      this.#emit();
    }
    if (changed) this.#scheduleEagerFrames();
    if (refresh) {
      await this.#request(
        this.#snapshot.url,
        {
          headers: {
            Accept:
              this.#options.navigation === undefined
                ? "text/html, application/xhtml+xml"
                : `${VISIT_MEDIA_TYPE}, text/html, application/xhtml+xml`,
          },
          method: "GET",
        },
        { method: "get" },
      );
    }
  }

  async #commitPreparedFrame(
    frameId: string,
    prepared: PreparedFrame,
  ): Promise<void> {
    if (
      this.#tree === undefined ||
      prepared.generation !== this.#documentGeneration
    ) {
      return;
    }
    const replaced = replaceFrame(this.#tree, prepared.parsed.tree, frameId);
    if (replaced === undefined) {
      this.#report(
        new FrameMissingError(frameId, prepared.finalUrl),
        prepared.finalUrl,
      );
      return;
    }
    this.#preparedFrames.delete(frameId);
    this.#tree = replaced;
    this.#syncFrames();
    this.#setFrameState(frameId, "loaded");
    this.#snapshot = {
      ...this.#snapshot,
      revision: this.#snapshot.revision + 1,
    };
    this.#emit();
    await this.#applyStreams(prepared.parsed.streams, prepared.finalUrl);
    this.#scheduleEagerFrames(frameId);
  }

  #syncFrames(): void {
    const next = new Map<string, TurboLiteFrameSnapshot>();
    if (this.#tree !== undefined) {
      for (const frame of collectFrames(this.#tree)) {
        const current = this.#frameStates.get(frame.id);
        if (
          current !== undefined &&
          current.src === frame.src &&
          current.loading === frame.loading
        ) {
          next.set(frame.id, current);
        } else {
          if (current !== undefined) {
            const slot = `frame:${frame.id}`;
            this.#requests.get(slot)?.controller.abort();
            this.#requests.delete(slot);
            this.#preloadRequests.get(frame.id)?.controller.abort();
            this.#preloadRequests.delete(frame.id);
          }
          next.set(frame.id, {
            ...frame,
            state: frame.src === undefined ? "loaded" : "idle",
          });
          this.#preparedFrames.delete(frame.id);
        }
      }
    }
    for (const [id] of this.#frameStates) {
      if (next.has(id)) continue;
      this.#requests.get(`frame:${id}`)?.controller.abort();
      this.#preloadRequests.get(id)?.controller.abort();
      this.#preloadRequests.delete(id);
      this.#preparedFrames.delete(id);
    }
    this.#frameStates.clear();
    for (const [id, frame] of next) this.#frameStates.set(id, frame);
  }

  #setFrameState(
    frameId: string,
    state: TurboLiteFrameSnapshot["state"],
  ): void {
    const frame = this.#frameStates.get(frameId);
    if (frame !== undefined)
      this.#frameStates.set(frameId, { ...frame, state });
  }

  #scheduleEagerFrames(excludedFrame?: string): void {
    for (const frame of this.#frameStates.values()) {
      if (
        frame.id === excludedFrame ||
        frame.loading !== "eager" ||
        frame.src === undefined ||
        frame.state !== "idle"
      ) {
        continue;
      }
      void this.loadFrame(frame.id);
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#activeNavigation = undefined;
    for (const request of this.#requests.values()) request.controller.abort();
    for (const request of this.#preloadRequests.values())
      request.controller.abort();
    this.#requests.clear();
    this.#preloadRequests.clear();
    this.#preparedFrames.clear();
    this.#listeners.clear();
  }
}

function encodeEntries(entries: readonly FormEntry[]): string {
  const params = new URLSearchParams();
  for (const [name, value] of entries) params.append(name, value);
  return params.toString();
}

function sameDocumentUrl(first: string, second: string): boolean {
  try {
    const left = new URL(first);
    const right = new URL(second);
    return (
      left.origin === right.origin &&
      left.pathname === right.pathname &&
      left.search === right.search
    );
  } catch {
    return first.split("#", 1)[0] === second.split("#", 1)[0];
  }
}
