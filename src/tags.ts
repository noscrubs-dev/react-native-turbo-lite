import type { ComponentType } from "react";
import { createElement } from "react";
import { TagCollisionError } from "./errors.js";
import type {
  DecodeAttribute,
  RendererContext,
  TurboLiteNode,
  TurboLiteRenderer,
} from "./types.js";

export function normalizeTagName(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

export interface ComponentRendererOptions {
  components: Readonly<Record<string, ComponentType<Record<string, unknown>>>>;
  decodeAttribute?: DecodeAttribute;
}

/** Build one root renderer from an application's existing component map. */
export function createComponentRenderer({
  components,
  decodeAttribute,
}: ComponentRendererOptions): TurboLiteRenderer {
  const normalized = new Map<
    string,
    { component: ComponentType<Record<string, unknown>>; source: string }
  >();

  for (const [source, component] of Object.entries(components)) {
    const wireTag = normalizeTagName(source);
    const existing = normalized.get(wireTag);
    if (existing !== undefined) {
      throw new TagCollisionError(existing.source, source, wireTag);
    }
    normalized.set(wireTag, { component, source });
  }

  return {
    hasElement(tag) {
      return normalized.has(normalizeTagName(tag));
    },
    render(node: TurboLiteNode, context: RendererContext) {
      if (typeof node !== "object") return node;
      const entry = normalized.get(normalizeTagName(node.type));
      if (entry === undefined) return context.children;

      const props: Record<string, unknown> = {};
      for (const [attribute, value] of Object.entries(node.props)) {
        if (attribute === "children") continue;
        props[attribute] =
          decodeAttribute !== undefined && typeof value === "string"
            ? decodeAttribute(value, {
                attribute,
                path: context.path,
                tag: normalizeTagName(node.type),
              })
            : value;
      }
      return createElement(entry.component, props, context.children);
    },
  };
}
