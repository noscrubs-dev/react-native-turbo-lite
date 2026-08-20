import { FrameMissingError, ParseError, TurboLiteError } from "./errors.js";
import {
  type InternalNode,
  publicNode,
  type StreamAction,
} from "./internal.js";
import { parseDocument, parseStreamResponse, resolveLimits } from "./parser.js";
import { applyStreamAction, collectEagerFrames, replaceFrame } from "./tree.js";
import type {
  FormEntry,
  SubmitOptions,
  TurboLiteRuntimeOptions,
  TurboLiteSnapshot,
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

function asError(error: unknown, url: string): TurboLiteError {
  if (error instanceof TurboLiteError) return error;
  return new TurboLiteError("network", "Turbo Lite request failed", {
    cause: error,
    url,
  });
}

interface RequestTarget {
  frame?: string;
  replace: boolean;
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
  #nextRequest = 0;
  #documentGeneration = 0;
  #tree: InternalNode | undefined;
  #snapshot: TurboLiteSnapshot = {
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

  #emit(): void {
    const next: TurboLiteSnapshot = {
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
        replace: options.replace ?? false,
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
        replace: false,
      },
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
      this.#documentGeneration++;
      for (const request of this.#requests.values()) request.controller.abort();
      this.#requests.clear();
    } else {
      this.#requests.get(slot)?.controller.abort();
    }
    const generation = this.#documentGeneration;
    const id = ++this.#nextRequest;
    const controller = new AbortController();
    this.#requests.set(slot, { controller, id });
    this.#emit();

    try {
      const headers = new Headers(init.headers);
      if (target.frame !== undefined) headers.set("Turbo-Frame", target.frame);
      const response = await this.#options.fetch(url, {
        ...init,
        headers,
        redirect: "follow",
        signal: controller.signal,
      });
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
        this.#emit();
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
      this.#snapshot = {
        ...this.#snapshot,
        revision: this.#snapshot.revision + 1,
      };
      this.#emit();
    } else {
      this.#tree = parsed.tree;
      this.#snapshot = {
        ...this.#snapshot,
        revision: this.#snapshot.revision + 1,
        url: finalUrl,
      };
      this.#emit();
      this.#options.navigation?.navigate(finalUrl, { replace: target.replace });
    }
    await this.#applyStreams(parsed.streams, finalUrl);
    if (target.frame === undefined) {
      if (ownsRequest() && this.#tree !== undefined)
        this.#loadEagerFrames(this.#tree);
    } else if (ownsRequest()) {
      this.#loadEagerFrames(parsed.tree, target.frame);
    }
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
      this.#snapshot = {
        ...this.#snapshot,
        revision: this.#snapshot.revision + 1,
      };
      this.#emit();
    }
    if (refresh) await this.visit(this.#snapshot.url, { replace: true });
  }

  #loadEagerFrames(tree: InternalNode, excludedFrame?: string): void {
    for (const frame of collectEagerFrames(tree)) {
      if (frame.id === excludedFrame) continue;
      void this.visit(frame.src, { frame: frame.id });
    }
  }

  dispose(): void {
    this.#disposed = true;
    for (const request of this.#requests.values()) request.controller.abort();
    this.#requests.clear();
    this.#listeners.clear();
  }
}

function encodeEntries(entries: readonly FormEntry[]): string {
  const params = new URLSearchParams();
  for (const [name, value] of entries) params.append(name, value);
  return params.toString();
}
