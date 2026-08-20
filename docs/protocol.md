# Wire format and safety

Turbo Lite parses well-formed XML-style Turbo markup. It does not repair arbitrary
HTML. A response may have one document root or multiple sibling `turbo-stream`
elements.

## Tag names

Application component names are normalized once at the root:

- `CardTitle`, `card-title`, and `card_title` normalize to `card-title`.
- Normalization is ASCII case folding, camel-case boundary insertion, and `_` to
  `-` conversion.
- Two component-map names that normalize to the same wire tag fail immediately
  with `TagCollisionError`.
- Protocol tags (`a`, `form`, `turbo-frame`, `turbo-stream`, and `template`) are
  owned by Turbo Lite and never use the unknown-component fallback.

## Attributes

XML attribute names and values arrive as strings exactly as written. Turbo Lite
consumes protocol attributes such as `href`, `action`, `method`, `target`, `id`,
and `src`. Application attributes are passed to the renderer unchanged.

Use `createComponentRenderer({ decodeAttribute })` when an application needs
typed values. The hook receives the string value plus normalized tag, attribute
name, and node path. Do not decode untrusted JSON without its own size/schema
checks.

## Default parser limits

| Limit | Default |
| --- | ---: |
| UTF-8 response body | 1 MiB |
| Element depth | 64 |
| Element + non-whitespace text nodes | 10,000 |
| Attributes on one element | 64 |
| Total decoded text | 256 KiB |
| Turbo Streams per response | 100 |

All limits can be lowered through `TurboLiteProvider` or `TurboLiteRuntime`.
Limit failures are typed and never replace the committed screen.

Scripts, DTDs, entity declarations, processing instructions, malformed XML,
duplicate active IDs, and external entities are rejected before commit.
