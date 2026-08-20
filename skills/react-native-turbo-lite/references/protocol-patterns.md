# Protocol and component patterns

Read this reference when authoring Rails markup, native mapped components,
Frames, forms, Streams, or failure handling.

## Native link

The protocol element is a transparent boundary. Put the interactive native
component inside it:

```xml
<a href="/orders/42"><LinkButton label="Open order" /></a>
```

```tsx
function LinkButton({ label }: { label: string }) {
  const { follow, pending } = useTurboLiteLink()
  return <Button title={label} disabled={pending} onPress={follow} />
}
```

Inside a Frame, links target the nearest Frame by default. Use
`data-turbo-frame="_top"` for a full-document visit, or a specific Frame ID for
an exact target.

## Forms

```xml
<form action="/orders" method="post">
  <NativeField name="notes" label="Notes" />
  <NativeSubmit label="Save" />
</form>
```

```tsx
function NativeField({ name, label }: { name: string; label: string }) {
  const field = useTurboLiteField(name)
  return (
    <TextInput
      accessibilityLabel={label}
      value={field.value}
      onChangeText={field.setValue}
    />
  )
}

function NativeSubmit({ label }: { label: string }) {
  const { submit, pending } = useTurboLiteForm()
  return <Button title={label} disabled={pending} onPress={submit} />
}
```

GET fields become query parameters. POST uses
`application/x-www-form-urlencoded`; ordered and repeated fields are preserved.
Files, multipart data, camera values, and payment objects stay host-owned.

## Frames

Every Frame needs a unique non-empty ID. A Frame response must contain the exact
matching Frame:

```xml
<turbo-frame id="order-summary" src="/orders/42/summary">
  <OrderSummarySkeleton />
</turbo-frame>
```

Missing `loading` means eager. Use `loading="lazy"` only when the native host
has a concrete visibility signal:

```tsx
function LazyFrameBoundary() {
  const frame = useTurboLiteFrame()

  useEffect(() => {
    if (screenIsLikelyNext) void frame.preload()
  }, [frame.preload, screenIsLikelyNext])

  useEffect(() => {
    if (isVisible) void frame.load()
  }, [frame.load, isVisible])

  return <FramePlaceholder state={frame.state} />
}
```

Connect `isVisible` to screen focus, intersection/layout observation, or list
viewability—not a timer. `preload()` fetches, parses, and validates but does not
render or navigate. `load()` reuses a valid prepared response. A new document
invalidates prepared Frames.

Do not record a preload as an impression. Record visibility after commit.

## Streams

Turbo Lite supports same-response Stream actions targeting exact IDs:
`append`, `prepend`, `replace`, `update`, `remove`, `before`, `after`, and
`refresh`.

```xml
<turbo-stream action="replace" target="status">
  <template><Status id="status" tone="success">Saved</Status></template>
</turbo-stream>
<turbo-stream action="append" target="orders">
  <template><OrderRow id="order-42" /></template>
</turbo-stream>
```

Keep IDs unique and stable within the active tree. Missing targets are typed
diagnostics and no-ops. Siblings apply in source order; a later failure does not
roll back earlier committed sibling actions. `refresh` replaces the current
native history entry rather than pushing a duplicate.

Action Cable, WebSockets, CSS selectors, morphing, permanent elements, and
custom actions are not implemented.

## Failure and fallback behavior

The last successful UI remains visible after network, media-type, parse, Frame,
or safety-limit errors. Provide host-owned pending and error affordances from
snapshot state and `onError`; do not assume a blank render means the runtime
will show an error screen.

Unknown wrapper elements keep rendering known children and emit
`UnknownElementError` once per revision. Unknown leaf elements render nothing.
Monitor these errors: otherwise server/native component drift can silently hide
controls or content.

Reject or fix responses with malformed XML, scripts, DTD/entity declarations,
processing instructions, duplicate active IDs, oversized payloads, excessive
depth, or unsupported media types. Do not loosen limits globally to accept one
bad response.

## Default limits

| Resource | Default |
| --- | ---: |
| UTF-8 response body | 1 MiB |
| Element depth | 64 |
| Nodes | 10,000 |
| Attributes per element | 64 |
| Total decoded text | 256 KiB |
| Streams per response | 100 |

Apps may lower limits through the Provider or runtime. Raising a limit requires
evidence about the largest valid response and device memory/latency impact.
