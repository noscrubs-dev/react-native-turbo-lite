import { describe, expect, it } from "vitest";
import {
  DuplicateIdError,
  parseDocument,
  parseStreamResponse,
  StreamError,
} from "../src/index.js";
import type { InternalNode } from "../src/internal.js";
import { applyStreamAction } from "../src/tree.js";
import { nodeById, textContent } from "./helpers.js";

function tree(
  markup = '<Screen><List id="list"><Row id="one">One</Row></List><Aside id="aside">A</Aside></Screen>',
): InternalNode {
  return parseDocument(markup).tree;
}

function action(markup: string) {
  return parseStreamResponse(markup)[0]!;
}

function stream(
  actionName: string,
  target: string,
  template = "<Text>New</Text>",
) {
  return action(
    `<turbo-stream action="${actionName}" target="${target}"><template>${template}</template></turbo-stream>`,
  );
}

describe("exact-ID Turbo Stream mutations", () => {
  it.each([
    ["append", "OneNew"],
    ["prepend", "NewOne"],
    ["update", "New"],
    ["before", "NewOne"],
    ["after", "OneNew"],
  ])("applies %s to only the selected target", (name, expected) => {
    const target = name === "before" || name === "after" ? "one" : "list";
    const result = applyStreamAction(tree(), stream(name, target));
    expect(
      textContent(
        nodeById(
          result.tree,
          name === "before" || name === "after" ? "list" : target,
        ),
      ),
    ).toBe(expected);
    expect(textContent(nodeById(result.tree, "aside"))).toBe("A");
  });

  it("replaces and removes targets, including empty replacement", () => {
    const replaced = applyStreamAction(
      tree(),
      stream("replace", "one", '<Row id="two">Two</Row>'),
    );
    expect(nodeById(replaced.tree, "one")).toBeUndefined();
    expect(textContent(nodeById(replaced.tree, "two"))).toBe("Two");

    const removed = applyStreamAction(
      replaced.tree,
      action(
        '<turbo-stream action="remove" target="two"><template /></turbo-stream>',
      ),
    );
    expect(nodeById(removed.tree, "two")).toBeUndefined();

    const empty = applyStreamAction(tree(), stream("replace", "one", ""));
    expect(nodeById(empty.tree, "one")).toBeUndefined();
  });

  it("runs siblings in source order", () => {
    const actions = parseStreamResponse(
      '<turbo-stream action="update" target="list"><template><Text>First</Text></template></turbo-stream>' +
        '<turbo-stream action="append" target="list"><template><Text>Second</Text></template></turbo-stream>',
    );
    const result = actions.reduce(
      (current, next) => applyStreamAction(current, next).tree,
      tree(),
    );
    expect(textContent(nodeById(result, "list"))).toBe("FirstSecond");
  });

  it("keeps untouched node identity and implements direct-child ID collision replacement", () => {
    const original = tree();
    const aside = nodeById(original, "aside");
    const result = applyStreamAction(
      original,
      stream("append", "list", '<Row id="one">Replacement</Row>'),
    );
    expect(nodeById(result.tree, "aside")).toBe(aside);
    expect(textContent(nodeById(result.tree, "list"))).toBe("Replacement");
  });

  it("makes missing targets diagnostic no-ops", () => {
    const original = tree();
    const result = applyStreamAction(original, stream("update", "missing"));
    expect(result.tree).toBe(original);
    expect(result.diagnostic).toBeInstanceOf(StreamError);
  });

  it("does not partially mutate a target when the result has duplicate IDs", () => {
    const original = tree();
    expect(() =>
      applyStreamAction(
        original,
        stream("append", "list", '<Row id="aside">Bad</Row>'),
      ),
    ).toThrow(DuplicateIdError);
    expect(textContent(nodeById(original, "list"))).toBe("One");
  });

  it.each([
    [
      '<turbo-stream action="targets" target="list"><template /></turbo-stream>',
    ],
    [
      '<turbo-stream action="append" target="list" method="morph"><template /></turbo-stream>',
    ],
  ])("rejects unsupported actions without changing the tree", (markup) => {
    const original = tree();
    expect(() => applyStreamAction(original, action(markup))).toThrow(
      StreamError,
    );
    expect(textContent(nodeById(original, "list"))).toBe("One");
  });
});
