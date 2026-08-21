# React Native Turbo Lite

A small Rails Turbo runtime for React Native. Rails owns documents and updates,
React Native owns components, and Turbo Lite connects them with document visits,
Frames, URL-encoded forms, and same-request Turbo Streams.

Turbo Lite does not require Expo, a particular router, or a server-driven UI
framework.

## Install

```sh
bun add react-native-turbo-lite
```

## Root setup

```tsx
const renderer = createComponentRenderer({ components })

const navigation = {
  // This minimal adapter is safe. Because it ignores the optional prepared
  // document, the destination screen performs its own GET.
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

### Expo Router without a special adapter

```tsx
import { type Href, router, usePathname } from "expo-router"

const apiOrigin = "https://app.example.com"
const appHref = (url: string) => {
  const parsed = new URL(url)
  return `${parsed.pathname}${parsed.search}` as Href
}
const navigation = {
  push: (url: string) => router.push(appHref(url)),
  replace: (url: string) => router.replace(appHref(url)),
}

export default function TurboRoute() {
  const pathname = usePathname()
  const documentUrl = new URL(pathname, apiOrigin).href
  return (
    <TurboLiteProvider {...{ navigation }} baseUrl={apiOrigin} fetch={authenticatedFetch} renderer={renderer}>
      <TurboLiteScreen url={documentUrl} />
    </TurboLiteProvider>
  )
}
```

If the document identity includes query parameters, include the route's current
search params in `documentUrl`. Expo Router's `push` adds a stack entry and
`replace` does not. See its [navigation guide](https://docs.expo.dev/router/basics/navigation/).

### React Navigation without a special adapter

```tsx
import {
  type RouteProp,
  StackActions,
  useNavigation,
  useRoute,
} from "@react-navigation/native"

type Routes = { TurboDocument: { url: string } }

function TurboRoute() {
  const host = useNavigation()
  const route = useRoute<RouteProp<Routes, "TurboDocument">>()
  const navigation = useMemo(() => ({
    push: (url: string) => host.dispatch(StackActions.push("TurboDocument", { url })),
    replace: (url: string) => host.dispatch(StackActions.replace("TurboDocument", { url })),
  }), [host])

  return (
    <TurboLiteProvider {...{ navigation }} baseUrl={apiOrigin} fetch={authenticatedFetch} renderer={renderer}>
      <TurboLiteScreen url={route.params.url} />
    </TurboLiteProvider>
  )
}
```

Use a stack or native-stack navigator. React Navigation documents that `push`
always adds a route, including another route with the same name. See its
[stack actions](https://reactnavigation.org/docs/stack-actions/).

### React Router on web without a special adapter

```tsx
import { useLocation, useNavigate } from "react-router"

const appPath = (url: string) => {
  const parsed = new URL(url)
  return `${parsed.pathname}${parsed.search}`
}

function TurboRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  const navigation = useMemo(() => ({
    push: (url: string) => navigate(appPath(url)),
    replace: (url: string) => navigate(appPath(url), { replace: true }),
  }), [navigate])

  return (
    <TurboLiteProvider {...{ navigation }} baseUrl={apiOrigin} fetch={authenticatedFetch} renderer={renderer}>
      <TurboLiteScreen url={`${location.pathname}${location.search}`} />
    </TurboLiteProvider>
  )
}
```

These three integrations intentionally ignore the optional prepared document.
They need no Turbo Lite router package: source screens and Back stay correct,
and each pushed destination performs one GET.

### Optional exact response handoff

For a full-document push, Turbo Lite does not commit the response into the
cached source screen. It supplies the already parsed response as the optional
second argument to `push`:

```tsx
push(url, preparedDocument) {
  const entry = { key: makeUniqueEntryKey(), url, preparedDocument }
  nativeStack.push(entry)
}

// Rendered by that exact entry—not looked up by URL.
<TurboLiteScreen
  url={entry.url}
  preparedDocument={entry.preparedDocument}
/>
```

This exact-entry handoff makes the destination render without another GET and
keeps Back state intact. Keep the opaque value in memory; do not serialize it,
put it in route parameters, or cache it by URL. If a router cannot carry
per-entry in-memory state, ignore the second argument. Turbo Lite preserves the
source screen and safely refetches at the destination.

See [native navigation handoff](./docs/navigation.md) for the adapter contract
and router capability boundaries.

## Native interaction hooks

Protocol elements are transparent boundaries. Put a mapped native component
inside the corresponding element and use its hook:

- `useTurboLiteLink()` provides `follow()` and `pending` inside `<a>`.
- `useTurboLiteField(name)` provides a string value and setter inside `<form>`.
- `useTurboLiteForm()` provides `submit()`, form-local `pending`, and an
  immutable `submission` snapshot inside `<form>`.
- `useTurboLiteFrame()` provides Frame state plus `preload()` and `load()`
  inside `<turbo-frame>`.

Those four hooks cover the host integration points in `0.1.2`. Advanced hosts
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
- A pushed full document cannot overwrite the cached source route. An invalid,
  serialized, or wrong-URL prepared handoff reports an error and refetches.
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
bun install --frozen-lockfile
bun run check
bun run test:coverage
bun audit
```

`bun run check` runs formatting and lint checks, strict TypeScript, unit and
React integration tests, example type checking, the ESM and declaration build,
archive-boundary checks, and `bun pm pack --dry-run`. Android device E2E runs on the
self-hosted release runner. Publishing happens only from the GitHub release
workflow; local checks never publish. The final registry upload intentionally
uses npm CLI because npm trusted publishing authenticates that command through
GitHub OIDC; all dependency, build, test, audit, and pack work uses Bun.
