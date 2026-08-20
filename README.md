# React Native Turbo Lite

A small Rails Turbo runtime for React Native. Rails owns documents and updates,
React Native owns components, and Turbo Lite connects them with document visits,
Frames, URL-encoded forms, and same-request Turbo Streams.

Turbo Lite does not require Expo, a particular router, or a server-driven UI
framework.

## Install

```sh
npm install react-native-turbo-lite
```

## Root setup

```tsx
const renderer = createComponentRenderer({ components })

const navigation = {
  push: (url: string) => router.push(url),
  replace: (url: string) => router.replace(url),
}

<TurboLiteProvider
  baseUrl="https://app.example.com"
  renderer={renderer}
  fetch={authenticatedFetch}
  navigation={navigation}
  onError={reportError}
>
  <TurboLiteScreen url="/cart" />
</TurboLiteProvider>
```

`TurboLiteScreen` treats its `url` as host-owned state, so the initial load and
later prop changes do not create another history entry. A successful link or
full-document form submission calls `navigation.push`. A Turbo refresh calls
`navigation.replace`. Frame requests never change native history.

## Native interaction hooks

Protocol elements are transparent boundaries. Put a mapped native component
inside the corresponding element and use its hook:

- `useTurboLiteLink()` provides `follow()` and `pending` inside `<a>`.
- `useTurboLiteField(name)` provides a string value and setter inside `<form>`.
- `useTurboLiteForm()` provides `submit()` and `pending` inside `<form>`.
- `useTurboLiteFrame()` provides Frame state plus `preload()` and `load()`
  inside `<turbo-frame>`.

Those four hooks cover the host integration points in `0.1.0`. Advanced hosts
can use `useTurboLiteRuntime()` directly.

## Lazy Frames and preloading

Frames without `loading`, or with `loading="eager"`, load automatically. A lazy
Frame waits until the native host says it is visible:

```xml
<turbo-frame id="recommendations" src="/recommendations" loading="lazy">
  <FrameBoundary />
</turbo-frame>
```

```tsx
function FrameBoundary() {
  const frame = useTurboLiteFrame()

  // Connect this to real visibility, such as FlatList viewability or screen focus.
  const onVisible = () => void frame.load()
  const onLikelyToBecomeVisible = () => void frame.preload()

  return <NativeFramePlaceholder {...{ onVisible, onLikelyToBecomeVisible }} />
}
```

`preload()` fetches, parses, and validates the matching Frame but does not render
it or change navigation. A later `load()` commits that prepared response without
a second request. A new document invalidates prepared Frames.

## Component renderer

The renderer adapts one application-owned component map:

```tsx
const renderer = createComponentRenderer({
  components,
  decodeAttribute(value, context) {
    // Optional: apply the application's safe string-to-value rules.
    return value
  },
})
```

There is no per-screen registry. Unknown wrapper elements keep rendering their
children and report `UnknownElementError`; unknown leaves render nothing.

See the [runnable Expo example](./example) for links, navigation history, eager
and lazy Frames, preloading, GET and POST forms, Streams, and error reporting.

## Public API

- `TurboLiteProvider`, `TurboLiteScreen`
- `createComponentRenderer`, `normalizeTagName`
- `useTurboLiteLink`, `useTurboLiteField`, `useTurboLiteForm`,
  `useTurboLiteFrame`
- `TurboLiteRuntime`, `useTurboLiteRuntime`
- Typed errors and adapter, Frame, node, limit, and request types
- `parseDocument` and `parseStreamResponse` for protocol tooling

## Failure behavior

- The last successful UI remains visible after network, media-type, parse,
  Frame, or safety-limit failures.
- A stale or cancelled response cannot replace newer work.
- Duplicate active IDs are rejected before commit.
- Stream siblings apply in source order. Each target mutation is atomic;
  earlier successful siblings remain committed if a later action fails.
- Turbo Lite reports typed errors through `onError` and never displays
  package-owned error UI.

Read the [wire format and limits](./docs/protocol.md) and the exact
[compatibility matrix](./docs/compatibility.md).

## Agent skill

The repository includes an installable
[React Native Turbo Lite agent skill](./skills/react-native-turbo-lite/SKILL.md).
It tells coding agents when to use the package, which behavior must remain
host-owned, how to implement links, forms, Frames, and Streams, and what evidence
is required before calling an adoption release-ready.

## Development and release checks

```sh
npm ci
npm run check
npm run test:coverage
npm audit
```

`npm run check` runs formatting and lint checks, strict TypeScript, unit and
React integration tests, example type checking, the ESM and declaration build,
archive-boundary checks, and `npm pack --dry-run`. Android device E2E runs on the
self-hosted release runner. Publishing happens only from the GitHub release
workflow; local checks never publish.
