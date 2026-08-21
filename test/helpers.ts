import type { TurboLiteNode } from "../src/index.js";

export function response(
  body: string | null,
  options: {
    contentType?: string;
    redirected?: boolean;
    status?: number;
    url?: string;
  } = {},
): Response {
  const native = new Response(body, {
    headers: {
      "content-type": options.contentType ?? "text/html; charset=utf-8",
    },
    status: options.status ?? 200,
  });
  if (options.url === undefined && options.redirected === undefined)
    return native;
  return new Proxy(native, {
    get(target, property, receiver) {
      if (property === "url") return options.url;
      if (property === "redirected") return options.redirected ?? false;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function nodeById(
  node: TurboLiteNode | undefined,
  id: string,
): Exclude<TurboLiteNode, string | number> | undefined {
  if (node === undefined || typeof node !== "object") return undefined;
  if (node.props.id === id) return node;
  const children = node.props.children;
  const list =
    children === undefined
      ? []
      : Array.isArray(children)
        ? children
        : [children];
  for (const child of list) {
    const found = nodeById(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function textContent(node: TurboLiteNode | undefined): string {
  if (node === undefined) return "";
  if (typeof node !== "object") return String(node);
  const children = node.props.children;
  const list =
    children === undefined
      ? []
      : Array.isArray(children)
        ? children
        : [children];
  return list.map(textContent).join("");
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
