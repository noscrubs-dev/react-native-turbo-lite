import { describe, expect, it } from "vitest";
import {
  createComponentRenderer,
  DuplicateIdError,
  ParseError,
  parseDocument,
  parseStreamResponse,
  SafetyLimitError,
  TagCollisionError,
} from "../src/index.js";
import { textContent } from "./helpers.js";

describe("Turbo markup parser", () => {
  it("parses native elements into the structurally compatible SDUI shape", () => {
    const parsed = parseDocument(
      '<Screen id="cart"><Text tone="strong">Laundry</Text><Amount cents="1200" /></Screen>',
    );
    expect(parsed.streams).toEqual([]);
    expect(parsed.tree).toMatchObject({
      props: {
        children: [
          { props: { children: "Laundry", tone: "strong" }, type: "Text" },
          { props: { cents: "1200" }, type: "Amount" },
        ],
        id: "cart",
      },
      type: "Screen",
    });
  });

  it("accepts multiple sibling streams and embedded same-request streams", () => {
    const streams = parseStreamResponse(
      '<turbo-stream action="append" target="list"><template><Row id="two" /></template></turbo-stream>' +
        '<turbo-stream action="remove" target="old"><template /></turbo-stream>',
    );
    expect(streams.map(({ action, target }) => [action, target])).toEqual([
      ["append", "list"],
      ["remove", "old"],
    ]);

    const document = parseDocument(
      '<Screen id="page"><Text>Old</Text><turbo-stream action="update" target="page"><template><Text>New</Text></template></turbo-stream></Screen>',
    );
    expect(document.streams).toHaveLength(1);
    expect(textContent(document.tree)).toBe("Old");
  });

  it.each([
    ["script", "<Screen><script>bad()</script></Screen>"],
    ["DTD", '<!DOCTYPE Screen SYSTEM "file:///etc/passwd"><Screen />'],
    ["processing instruction", '<?xml version="1.0"?><Screen />'],
    ["malformed", "<Screen><Text></Screen>"],
  ])("rejects %s markup", (_label, markup) => {
    expect(() => parseDocument(markup)).toThrow(ParseError);
  });

  it("rejects duplicate active IDs before commit", () => {
    expect(() =>
      parseDocument('<Screen><Row id="same"/><Row id="same"/></Screen>'),
    ).toThrow(DuplicateIdError);
  });

  it("enforces response, depth, node, attribute, text, and stream limits", () => {
    expect(() =>
      parseDocument("<Screen />", { limits: { responseBytes: 4 } }),
    ).toThrow(SafetyLimitError);
    expect(() =>
      parseDocument("<A><B><C /></B></A>", { limits: { depth: 2 } }),
    ).toThrow(SafetyLimitError);
    expect(() =>
      parseDocument("<A><B/><C/></A>", { limits: { nodes: 2 } }),
    ).toThrow(SafetyLimitError);
    expect(() =>
      parseDocument('<A one="1" two="2" />', {
        limits: { attributesPerElement: 1 },
      }),
    ).toThrow(SafetyLimitError);
    expect(() =>
      parseDocument("<A>12345</A>", { limits: { textCharacters: 4 } }),
    ).toThrow(SafetyLimitError);
    expect(() =>
      parseStreamResponse(
        '<turbo-stream action="remove" target="a"><template /></turbo-stream>' +
          '<turbo-stream action="remove" target="b"><template /></turbo-stream>',
        { limits: { streams: 1 } },
      ),
    ).toThrow(SafetyLimitError);
  });

  it("normalizes component names deterministically and rejects collisions", () => {
    const Component = () => null;
    expect(() =>
      createComponentRenderer({
        components: { CardTitle: Component, "card-title": Component },
      }),
    ).toThrow(TagCollisionError);
    const renderer = createComponentRenderer({
      components: { CardTitle: Component },
    });
    expect(renderer.hasElement("card-title")).toBe(true);
    expect(renderer.hasElement("CardTitle")).toBe(true);
  });

  it("rejects invalid limits and malformed protocol placement", () => {
    expect(() => parseDocument("<Screen/>", { limits: { depth: 0 } })).toThrow(
      TypeError,
    );
    expect(() => parseStreamResponse("")).toThrow(ParseError);
    expect(() => parseDocument("<Screen><template /></Screen>")).toThrow(
      ParseError,
    );
    expect(() => parseStreamResponse("<Screen />")).toThrow(ParseError);
    expect(() => parseDocument("<Screen><turbo-frame /></Screen>")).toThrow(
      ParseError,
    );
    expect(() =>
      parseStreamResponse(
        '<turbo-stream action="refresh" target="page"></turbo-stream>',
      ),
    ).toThrow(ParseError);
    expect(() =>
      parseStreamResponse(
        '<turbo-stream action="append" target="page"><template /><Text /></turbo-stream>',
      ),
    ).toThrow(ParseError);
  });

  it("decodes application attributes through the renderer hook", () => {
    const Component = () => null;
    const renderer = createComponentRenderer({
      components: { Amount: Component },
      decodeAttribute: (value, context) =>
        context.attribute === "cents" ? Number(value) : value,
    });
    const document = parseDocument('<Amount cents="1200" />');
    const rendered = renderer.render(document.tree, {
      children: null,
      key: "key",
      path: "$",
      url: "https://app.test",
    });
    expect(rendered).toMatchObject({ props: { cents: 1200 } });
  });
});
