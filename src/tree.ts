import { StreamError } from "./errors.js";
import {
  type ElementNode,
  elementChildren,
  type InternalNode,
  isElement,
  type StreamAction,
  withChildren,
} from "./internal.js";
import { assertUniqueIds } from "./parser.js";
import { normalizeTagName } from "./tags.js";

interface LocatedNode {
  node: ElementNode;
  path: number[];
}

export interface AppliedStream {
  tree: InternalNode;
  diagnostic?: StreamError;
  refresh: boolean;
}

export function findById(
  root: InternalNode,
  id: string,
): LocatedNode | undefined {
  const visit = (
    node: InternalNode,
    path: number[],
  ): LocatedNode | undefined => {
    if (!isElement(node)) return undefined;
    if (node.props.id === id) return { node, path };
    const children = elementChildren(node);
    for (let index = 0; index < children.length; index++) {
      const found = visit(children[index] as InternalNode, [...path, index]);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return visit(root, []);
}

function replaceAtPath(
  root: InternalNode,
  path: readonly number[],
  replacements: InternalNode[],
): InternalNode | undefined {
  if (path.length === 0) {
    if (replacements.length === 0) return undefined;
    if (replacements.length === 1) return replacements[0];
    return {
      key: "replacement-fragment",
      props: { children: replacements },
      type: "#fragment",
    };
  }
  if (!isElement(root)) return root;
  const [index, ...rest] = path;
  const children = [...elementChildren(root)];
  const child = children[index as number];
  if (child === undefined) return root;
  if (rest.length === 0) {
    children.splice(index as number, 1, ...replacements);
  } else {
    const replaced = replaceAtPath(child, rest, replacements);
    if (replaced === undefined) children.splice(index as number, 1);
    else children[index as number] = replaced;
  }
  return withChildren(root, children);
}

function directId(node: InternalNode): string | undefined {
  if (!isElement(node)) return undefined;
  return typeof node.props.id === "string" ? node.props.id : undefined;
}

function appendLike(
  target: ElementNode,
  incoming: readonly InternalNode[],
  prepend: boolean,
): ElementNode {
  const incomingIds = new Set(
    incoming.map(directId).filter((id): id is string => id !== undefined),
  );
  const existing = elementChildren(target).filter((child) => {
    const id = directId(child);
    return id === undefined || !incomingIds.has(id);
  });
  return withChildren(
    target,
    prepend ? [...incoming, ...existing] : [...existing, ...incoming],
  );
}

function requireTemplate(action: StreamAction): InternalNode[] {
  if (action.children === undefined) {
    throw new StreamError(`Stream action ${action.action} has no template`, {
      action: action.action,
      target: action.target,
    });
  }
  return action.children;
}

export function applyStreamAction(
  root: InternalNode,
  action: StreamAction,
  url?: string,
): AppliedStream {
  if (action.method === "morph") {
    throw new StreamError('Turbo Lite does not support method="morph"', {
      action: action.action,
      target: action.target,
      url,
    });
  }
  if (action.action === "refresh") {
    return { refresh: true, tree: root };
  }
  const supported = new Set([
    "append",
    "prepend",
    "replace",
    "update",
    "remove",
    "before",
    "after",
  ]);
  if (!supported.has(action.action)) {
    throw new StreamError(
      `Unsupported Turbo Stream action \"${action.action}\"`,
      {
        action: action.action,
        target: action.target,
        url,
      },
    );
  }
  if (action.target === undefined) {
    throw new StreamError(
      `Stream action ${action.action} requires an exact target`,
      {
        action: action.action,
        url,
      },
    );
  }
  const located = findById(root, action.target);
  if (located === undefined) {
    return {
      diagnostic: new StreamError(
        `Turbo Stream target #${action.target} was not found; action was a no-op`,
        { action: action.action, target: action.target, url },
      ),
      refresh: false,
      tree: root,
    };
  }

  const template = action.action === "remove" ? [] : requireTemplate(action);
  let candidate: InternalNode | undefined;
  switch (action.action) {
    case "append":
      candidate = replaceAtPath(root, located.path, [
        appendLike(located.node, template, false),
      ]);
      break;
    case "prepend":
      candidate = replaceAtPath(root, located.path, [
        appendLike(located.node, template, true),
      ]);
      break;
    case "replace":
      candidate = replaceAtPath(root, located.path, template);
      break;
    case "update":
      candidate = replaceAtPath(root, located.path, [
        withChildren(located.node, template),
      ]);
      break;
    case "remove":
      candidate = replaceAtPath(root, located.path, []);
      break;
    case "before":
      candidate = replaceAtPath(root, located.path, [
        ...template,
        located.node,
      ]);
      break;
    case "after":
      candidate = replaceAtPath(root, located.path, [
        located.node,
        ...template,
      ]);
      break;
  }
  const committed =
    candidate ??
    ({ key: "empty-document", props: {}, type: "#fragment" } as ElementNode);
  assertUniqueIds(committed, url);
  return { refresh: false, tree: committed };
}

export function replaceFrame(
  root: InternalNode,
  response: InternalNode,
  frameId: string,
): InternalNode | undefined {
  const current = findById(root, frameId);
  if (
    current === undefined ||
    normalizeTagName(current.node.type) !== "turbo-frame"
  ) {
    return undefined;
  }
  const next = findById(response, frameId);
  if (
    next === undefined ||
    normalizeTagName(next.node.type) !== "turbo-frame"
  ) {
    return undefined;
  }
  const candidate = replaceAtPath(root, current.path, [
    withChildren(current.node, elementChildren(next.node)),
  ]);
  if (candidate === undefined) return undefined;
  assertUniqueIds(candidate);
  return candidate;
}

export function collectFrames(
  root: InternalNode,
): Array<{ id: string; loading: "eager" | "lazy"; src?: string }> {
  const frames: Array<{
    id: string;
    loading: "eager" | "lazy";
    src?: string;
  }> = [];
  const visit = (node: InternalNode): void => {
    if (!isElement(node)) return;
    if (normalizeTagName(node.type) === "turbo-frame") {
      const id = node.props.id;
      const src = node.props.src;
      const loading = node.props.loading === "lazy" ? "lazy" : "eager";
      if (typeof id === "string") {
        frames.push({
          id,
          loading,
          ...(typeof src === "string" && src.length > 0 ? { src } : {}),
        });
      }
    }
    for (const child of elementChildren(node)) visit(child);
  };
  visit(root);
  return frames;
}
