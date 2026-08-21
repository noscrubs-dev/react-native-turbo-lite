import type { ReactNode } from "react";
import type { TurboLitePreparedDocument } from "./prepared.js";

export type TurboLiteNode =
  | string
  | number
  | {
      type: string;
      props: {
        children?: TurboLiteNode | TurboLiteNode[];
        [name: string]: unknown;
      };
    };

export interface TurboLiteLimits {
  /** Maximum UTF-8 response body size. Default: 1 MiB. */
  responseBytes: number;
  /** Maximum element nesting below the synthetic root. Default: 64. */
  depth: number;
  /** Maximum element and non-whitespace text node count. Default: 10,000. */
  nodes: number;
  /** Maximum attributes on one element. Default: 64. */
  attributesPerElement: number;
  /** Maximum total decoded text characters. Default: 256 KiB. */
  textCharacters: number;
  /** Maximum Turbo Stream elements in one response. Default: 100. */
  streams: number;
}

export const DEFAULT_TURBO_LITE_LIMITS: Readonly<TurboLiteLimits> = {
  responseBytes: 1024 * 1024,
  depth: 64,
  nodes: 10_000,
  attributesPerElement: 64,
  textCharacters: 256 * 1024,
  streams: 100,
};

export interface TurboLiteFetch {
  (input: string, init: RequestInit): Promise<Response>;
}

export interface TurboLiteNavigationAdapter {
  /**
   * Push a destination without changing the cached source screen.
   *
   * Exact-handoff adapters retain `preparedDocument` in memory for the new
   * route entry and pass it to that entry's `TurboLiteScreen`. Adapters that
   * ignore it remain correct, but the destination performs a fresh GET.
   */
  push(
    url: string,
    preparedDocument?: TurboLitePreparedDocument,
  ): void | Promise<void>;
  /**
   * Replace the current native history entry after a refresh-style commit.
   * The prepared document is supplied for routers that remount on replace.
   */
  replace(
    url: string,
    preparedDocument?: TurboLitePreparedDocument,
  ): void | Promise<void>;
}

export interface RendererContext {
  children: ReactNode;
  key: string;
  path: string;
  url: string;
}

export interface TurboLiteRenderer {
  /** True when the application can render this normalized wire tag. */
  hasElement(tag: string): boolean;
  render(node: TurboLiteNode, context: RendererContext): ReactNode;
}

export interface DecodeAttributeContext {
  attribute: string;
  path: string;
  tag: string;
}

export type DecodeAttribute = (
  value: string,
  context: DecodeAttributeContext,
) => unknown;

export type TurboLiteErrorHandler = (error: TurboLiteError) => void;

export interface TurboLiteProviderProps {
  children: ReactNode;
  renderer: TurboLiteRenderer;
  fetch?: TurboLiteFetch;
  navigation?: TurboLiteNavigationAdapter;
  onError?: TurboLiteErrorHandler;
  limits?: Partial<TurboLiteLimits>;
  baseUrl?: string;
}

export interface TurboLiteScreenProps {
  url: string;
  /** Prepared response bound to this exact in-memory native route entry. */
  preparedDocument?: TurboLitePreparedDocument;
}

export type FormEntry = readonly [name: string, value: string];

export interface TurboLiteFormSubmission {
  readonly action: string;
  readonly entries: readonly FormEntry[];
  readonly frame?: string;
  readonly method: "get" | "post";
}

export interface TurboLiteFormController {
  readonly pending: boolean;
  readonly submission?: TurboLiteFormSubmission;
  submit(): void;
}

export interface TurboLiteRuntimeOptions {
  fetch: TurboLiteFetch;
  navigation?: TurboLiteNavigationAdapter;
  onError?: TurboLiteErrorHandler;
  limits?: Partial<TurboLiteLimits>;
  baseUrl?: string;
}

export interface TurboLiteSnapshot {
  readonly url: string;
  readonly tree: TurboLiteNode | undefined;
  readonly revision: number;
  readonly pending: boolean;
  readonly frames: Readonly<Record<string, TurboLiteFrameSnapshot>>;
}

export type TurboLiteFrameLoading = "eager" | "lazy";
export type TurboLiteFrameState =
  | "idle"
  | "preloading"
  | "preloaded"
  | "loading"
  | "loaded";

export interface TurboLiteFrameSnapshot {
  readonly id: string;
  readonly loading: TurboLiteFrameLoading;
  readonly src?: string;
  readonly state: TurboLiteFrameState;
}

export interface TurboLiteFrameController extends TurboLiteFrameSnapshot {
  /** Fetch and validate the Frame without rendering it. */
  preload(): Promise<void>;
  /** Render a prepared Frame, or fetch and render it when not prepared. */
  load(): Promise<void>;
}

export type TurboLiteVisitHistory = "push" | "replace" | "none";

export interface VisitOptions {
  frame?: string;
  /** Full-document history behavior. Frame visits never change history. */
  history?: TurboLiteVisitHistory;
}

export interface SubmitOptions {
  action: string;
  method: "get" | "post";
  entries: readonly FormEntry[];
  frame?: string;
}

// Imported as a type above without creating a runtime cycle.
import type { TurboLiteError } from "./errors.js";
