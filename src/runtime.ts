import { FrameMissingError, ParseError, TurboLiteError } from "./errors.js";
import {
  type InternalNode,
  type ParsedDocument,
  publicNode,
  type StreamAction,
} from "./internal.js";
import { parseDocument, parseStreamResponse, resolveLimits } from "./parser.js";
import {
  createPreparedDocument,
  preparedDocumentContents,
  type TurboLitePreparedDocument,
} from "./prepared.js";
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
  TurboLiteVisitHistory,
  VisitOptions,
} from "./types.js";

const STREAM_MEDIA_TYPE = "text/vnd.turbo-stream.html";
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
  history: TurboLiteVisitHistory;
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

  /** Load a route from its exact prepared response, or safely fetch it. */
  async load(
    input: string,
    preparedDocument?: TurboLitePreparedDocument,
  ): Promise<void> {
    if (preparedDocument !== undefined) {
      let url: string;
      try {
        url = this.#resolve(input);
      } catch (error) {
        this.#report(error, input);
        return;
      }
      const parsed = preparedDocumentContents(preparedDocument);
      if (parsed !== undefined && preparedDocument.url === url) {
        await this.#commitDocument(parsed, url);
        return;
      }
      this.#report(
        new TurboLiteError(
          "http",
          parsed === undefined
            ? "Turbo Lite prepared document is invalid or was serialized"
            : `Prepared document URL does not match screen URL: ${preparedDocument.url}`,
          { url },
        ),
        url,
      );
    }
    await this.visit(input, { history: "none" });
  }

  #emit(): void {
    const frames = Object.fromEntries(this.#frameStates);
    const next: TurboLiteSnapshot = {
      frames,
      pending: this.#requests.size > 0,
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
    await this.#request(
      url,
      {
        headers: {
          Accept: `${STREAM_MEDIA_TYPE}, text/html, application/xhtml+xml`,
        },
        method: "GET",
      },
      {
        ...(options.frame === undefined ? {} : { frame: options.frame }),
        history:
          options.frame === undefined ? (options.history ?? "push") : "none",
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
    const headers: Record<string, string> = {
      Accept: `${STREAM_MEDIA_TYPE}, text/html, application/xhtml+xml`,
    };
    let body: string | undefined;
    if (options.method === "get") {
      const base = this.#options.baseUrl ?? this.#snapshot.url;
      try {
        const parsed = new URL(url, base);
        for (const [name, value] of options.entries)
          parsed.searchParams.append(name, value);
        url = parsed.href;
      } catch {
        const query = encodeEntries(options.entries);
        url += `${url.includes("?") ? "&" : "?"}${query}`;
      }
    } else {
      body = encodeEntries(options.entries);
      headers["Content-Type"] =
        "application/x-www-form-urlencoded;charset=UTF-8";
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
        history: options.frame === undefined ? "push" : "none",
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
    const frame = this.#frameStates.get(frameId);
    if (frame?.src === undefined) {
      this.#report(
        new FrameMissingError(frameId, this.#snapshot.url),
        this.#snapshot.url,
      );
      return;
    }
    if (frame.state === "loaded" || frame.state === "loading") return;
    const active = this.#preloadRequests.get(frameId);
    if (active !== undefined) await active.promise;
    const prepared = this.#preparedFrames.get(frameId);
    if (
      prepared?.generation === this.#documentGeneration &&
      prepared.src === frame.src
    ) {
      await this.#commitPreparedFrame(frameId, prepared);
      return;
    }
    this.#setFrameState(frameId, "loading");
    this.#emit();
    await this.visit(frame.src, { frame: frameId });
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
      if (response.status === 204) {
        this.#setFrameState(frameId, "idle");
        return;
      }
      const type = mediaType(response);
      if (!DOCUMENT_MEDIA_TYPES.has(type)) {
        throw new TurboLiteError(
          "media-type",
          `Frame preload requires a document response, received: ${type || "missing"}`,
          { url: response.url || url },
        );
      }
      const finalUrl = response.url || url;
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
    const finalUrl = response.url || requestedUrl;
    if (response.status === 204) return;
    const type = mediaType(response);
    if (type !== STREAM_MEDIA_TYPE && !DOCUMENT_MEDIA_TYPES.has(type)) {
      throw new TurboLiteError(
        "media-type",
        `Unsupported Turbo response media type: ${type || "missing"}`,
        { url: finalUrl },
      );
    }
    const markup = await response.text();
    if (!ownsRequest()) return;

    if (type === STREAM_MEDIA_TYPE) {
      const streams = parseStreamResponse(markup, {
        limits: this.#options.limits,
        url: finalUrl,
      });
      await this.#applyStreams(streams, finalUrl);
      return;
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
      const preparedDocument = createPreparedDocument(finalUrl, parsed);
      if (target.history === "push" && this.#options.navigation !== undefined) {
        await this.#options.navigation.push(finalUrl, preparedDocument);
        return;
      }
      await this.#commitDocument(parsed, finalUrl, true);
      if (target.history === "replace") {
        await this.#options.navigation?.replace(finalUrl, preparedDocument);
      }
    }
    if (target.frame !== undefined)
      await this.#applyStreams(parsed.streams, finalUrl);
    if (ownsRequest()) this.#scheduleEagerFrames(target.frame);
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
    if (refresh) await this.visit(this.#snapshot.url, { history: "replace" });
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
