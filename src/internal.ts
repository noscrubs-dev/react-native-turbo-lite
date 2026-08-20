import type { TurboLiteNode } from "./types.js";

export interface ElementNode {
  type: string;
  props: Record<string, unknown> & {
    children?: InternalNode | InternalNode[];
  };
  readonly key: string;
}

export type InternalNode = string | number | ElementNode;

export interface StreamAction {
  action: string;
  target?: string;
  method?: string;
  children?: InternalNode[];
}

export interface ParsedDocument {
  tree: InternalNode;
  streams: StreamAction[];
}

export function publicNode(node: InternalNode): TurboLiteNode {
  return node as TurboLiteNode;
}

export function elementChildren(node: ElementNode): InternalNode[] {
  const children = node.props.children;
  if (children === undefined) return [];
  return Array.isArray(children) ? children : [children];
}

export function withChildren(
  node: ElementNode,
  children: InternalNode[],
): ElementNode {
  const props = { ...node.props };
  if (children.length === 0) delete props.children;
  else if (children.length === 1) props.children = children[0] as InternalNode;
  else props.children = children;
  return { ...node, props };
}

export function isElement(node: unknown): node is ElementNode {
  return typeof node === "object" && node !== null;
}
