import type { ReactNode } from "react";

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
  /** Called after a full-document response commits. */
  navigate(url: string, options: { replace: boolean }): void;
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
}

export type FormEntry = readonly [name: string, value: string];

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
}

export interface VisitOptions {
  frame?: string;
  replace?: boolean;
}

export interface SubmitOptions {
  action: string;
  method: "get" | "post";
  entries: readonly FormEntry[];
  frame?: string;
}

// Imported as a type above without creating a runtime cycle.
import type { TurboLiteError } from "./errors.js";
