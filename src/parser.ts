import { SaxesParser, type SaxesTag } from "saxes";
import { DuplicateIdError, ParseError, SafetyLimitError } from "./errors.js";
import {
  type ElementNode,
  elementChildren,
  type InternalNode,
  isElement,
  type ParsedDocument,
  type StreamAction,
  withChildren,
} from "./internal.js";
import { normalizeTagName } from "./tags.js";
import { DEFAULT_TURBO_LITE_LIMITS, type TurboLiteLimits } from "./types.js";

const ROOT = "turbo-lite-synthetic-root";
const FORBIDDEN_MARKUP = [
  { pattern: /<!DOCTYPE\b/i, label: "DTDs" },
  { pattern: /<!ENTITY\b/i, label: "entity declarations" },
  { pattern: /<\?/i, label: "processing instructions" },
  { pattern: /<script(?:\s|>)/i, label: "script elements" },
] as const;

let parseSequence = 0;

interface ParseOptions {
  limits?: Partial<TurboLiteLimits>;
  url?: string;
}

interface OpenNode {
  node: ElementNode;
  children: InternalNode[];
}

export function resolveLimits(
  limits: Partial<TurboLiteLimits> | undefined,
): TurboLiteLimits {
  const resolved = { ...DEFAULT_TURBO_LITE_LIMITS, ...limits };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(
        `Turbo Lite limit ${name} must be a positive integer`,
      );
    }
  }
  return resolved;
}

function bodyBytes(markup: string): number {
  return new TextEncoder().encode(markup).byteLength;
}

function rawParse(markup: string, options: ParseOptions): InternalNode[] {
  const limits = resolveLimits(options.limits);
  if (bodyBytes(markup) > limits.responseBytes) {
    throw new SafetyLimitError(
      "responseBytes",
      `Response exceeds ${limits.responseBytes} bytes`,
      options.url,
    );
  }
  for (const forbidden of FORBIDDEN_MARKUP) {
    if (forbidden.pattern.test(markup)) {
      throw new ParseError(`Turbo Lite rejects ${forbidden.label}`, {
        url: options.url,
      });
    }
  }

  const sequence = ++parseSequence;
  let key = 0;
  let nodeCount = 0;
  let textCharacters = 0;
  let failure: unknown;
  const stack: OpenNode[] = [];
  let roots: InternalNode[] = [];
  const parser = new SaxesParser({ xmlns: false, fragment: false });

  const fail = (error: unknown): void => {
    if (failure === undefined) failure = error;
  };

  parser.on("doctype", () => fail(new ParseError("Turbo Lite rejects DTDs")));
  parser.on("processinginstruction", () =>
    fail(new ParseError("Turbo Lite rejects processing instructions")),
  );
  parser.on("error", (error) => fail(error));
  parser.on("opentag", (tag: SaxesTag) => {
    if (failure !== undefined) return;
    const depth = stack.length;
    if (depth > limits.depth) {
      fail(
        new SafetyLimitError(
          "depth",
          `Markup exceeds element depth ${limits.depth}`,
          options.url,
        ),
      );
      return;
    }
    const attributes = Object.entries(tag.attributes);
    if (attributes.length > limits.attributesPerElement) {
      fail(
        new SafetyLimitError(
          "attributesPerElement",
          `<${tag.name}> exceeds ${limits.attributesPerElement} attributes`,
          options.url,
        ),
      );
      return;
    }
    if (tag.name !== ROOT && normalizeTagName(tag.name) === "script") {
      fail(
        new ParseError("Turbo Lite rejects script elements", {
          url: options.url,
        }),
      );
      return;
    }
    if (tag.name !== ROOT && ++nodeCount > limits.nodes) {
      fail(
        new SafetyLimitError(
          "nodes",
          `Markup exceeds ${limits.nodes} nodes`,
          options.url,
        ),
      );
      return;
    }
    const props: Record<string, unknown> = {};
    for (const [name, attribute] of attributes) {
      props[name] = typeof attribute === "string" ? attribute : attribute.value;
    }
    stack.push({
      children: [],
      node: { key: `${sequence}:${++key}`, props, type: tag.name },
    });
  });
  parser.on("text", (text) => {
    if (failure !== undefined || /^\s*$/.test(text)) return;
    textCharacters += text.length;
    if (textCharacters > limits.textCharacters) {
      fail(
        new SafetyLimitError(
          "textCharacters",
          `Markup exceeds ${limits.textCharacters} text characters`,
          options.url,
        ),
      );
      return;
    }
    if (++nodeCount > limits.nodes) {
      fail(
        new SafetyLimitError(
          "nodes",
          `Markup exceeds ${limits.nodes} nodes`,
          options.url,
        ),
      );
      return;
    }
    stack.at(-1)?.children.push(text);
  });
  parser.on("closetag", () => {
    if (failure !== undefined) return;
    const open = stack.pop();
    if (open === undefined) return;
    const complete = withChildren(open.node, open.children);
    const parent = stack.at(-1);
    if (parent === undefined) roots = [complete];
    else parent.children.push(complete);
  });

  try {
    parser.write(`<${ROOT}>${markup}</${ROOT}>`).close();
  } catch (error) {
    fail(error);
  }
  if (failure !== undefined) {
    if (failure instanceof SafetyLimitError || failure instanceof ParseError) {
      throw failure;
    }
    throw new ParseError("Malformed Turbo markup", {
      cause: failure,
      url: options.url,
    });
  }
  const root = roots[0];
  if (!isElement(root) || root.type !== ROOT) {
    throw new ParseError("Malformed Turbo markup", { url: options.url });
  }
  return elementChildren(root);
}

function streamFromNode(node: ElementNode, url?: string): StreamAction {
  const action = node.props.action;
  if (typeof action !== "string" || action.length === 0) {
    throw new ParseError("turbo-stream requires an action", { url });
  }
  const target =
    typeof node.props.target === "string" ? node.props.target : undefined;
  const method =
    typeof node.props.method === "string" ? node.props.method : undefined;
  const children = elementChildren(node);

  if (action === "refresh") {
    if (target !== undefined) {
      throw new ParseError("refresh must not declare a target", { url });
    }
    return { action, ...(method === undefined ? {} : { method }) };
  }
  const templates = children.filter(
    (child): child is ElementNode =>
      isElement(child) && normalizeTagName(child.type) === "template",
  );
  if (templates.length !== 1 || children.length !== 1) {
    throw new ParseError(
      `turbo-stream action ${action} requires exactly one template element`,
      { url },
    );
  }
  if (target === undefined || target.length === 0) {
    throw new ParseError(
      `turbo-stream action ${action} requires one exact target`,
      {
        url,
      },
    );
  }
  return {
    action,
    children: elementChildren(templates[0] as ElementNode),
    ...(method === undefined ? {} : { method }),
    target,
  };
}

function extractStreams(
  node: InternalNode,
  streams: StreamAction[],
  url: string | undefined,
): InternalNode | undefined {
  if (!isElement(node)) return node;
  const tag = normalizeTagName(node.type);
  if (tag === "turbo-stream") {
    streams.push(streamFromNode(node, url));
    return undefined;
  }
  if (tag === "template") {
    throw new ParseError("template is only valid inside turbo-stream", { url });
  }
  const nextChildren = elementChildren(node)
    .map((child) => extractStreams(child, streams, url))
    .filter((child): child is InternalNode => child !== undefined);
  return withChildren(node, nextChildren);
}

function documentRoot(
  nodes: InternalNode[],
  sequenceKey = "document",
): InternalNode {
  if (nodes.length === 1) return nodes[0] as InternalNode;
  return {
    key: sequenceKey,
    props: nodes.length === 0 ? {} : { children: nodes },
    type: "#fragment",
  };
}

export function parseDocument(
  markup: string,
  options: ParseOptions = {},
): ParsedDocument {
  const streams: StreamAction[] = [];
  const nodes = rawParse(markup, options)
    .map((node) => extractStreams(node, streams, options.url))
    .filter((node): node is InternalNode => node !== undefined);
  const limits = resolveLimits(options.limits);
  if (streams.length > limits.streams) {
    throw new SafetyLimitError(
      "streams",
      `Response exceeds ${limits.streams} Turbo Streams`,
      options.url,
    );
  }
  const tree = documentRoot(nodes);
  assertUniqueIds(tree, options.url);
  return { streams, tree };
}

export function parseStreamResponse(
  markup: string,
  options: ParseOptions = {},
): StreamAction[] {
  const nodes = rawParse(markup, options);
  if (nodes.length === 0) {
    throw new ParseError("Turbo Stream response is empty", {
      url: options.url,
    });
  }
  const streams = nodes.map((node) => {
    if (!isElement(node) || normalizeTagName(node.type) !== "turbo-stream") {
      throw new ParseError(
        "Turbo Stream response may only contain turbo-stream siblings",
        { url: options.url },
      );
    }
    return streamFromNode(node, options.url);
  });
  const limits = resolveLimits(options.limits);
  if (streams.length > limits.streams) {
    throw new SafetyLimitError(
      "streams",
      `Response exceeds ${limits.streams} Turbo Streams`,
      options.url,
    );
  }
  return streams;
}

export function assertUniqueIds(node: InternalNode, url?: string): void {
  const ids = new Set<string>();
  const visit = (current: InternalNode): void => {
    if (!isElement(current)) return;
    if (
      normalizeTagName(current.type) === "turbo-frame" &&
      (typeof current.props.id !== "string" || current.props.id.length === 0)
    ) {
      throw new ParseError("turbo-frame requires a non-empty id", { url });
    }
    if (
      normalizeTagName(current.type) === "turbo-frame" &&
      current.props.loading !== undefined &&
      current.props.loading !== "eager" &&
      current.props.loading !== "lazy"
    ) {
      throw new ParseError(
        'turbo-frame loading must be either "eager" or "lazy"',
        { url },
      );
    }
    const id = current.props.id;
    if (typeof id === "string") {
      if (ids.has(id)) throw new DuplicateIdError(id, url);
      ids.add(id);
    }
    for (const child of elementChildren(current)) visit(child);
  };
  visit(node);
}
