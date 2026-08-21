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

## Setup

```tsx
const renderer = createComponentRenderer({ components })

<TurboLiteProvider
  baseUrl="https://app.example.com"
  renderer={renderer}
  fetch={authenticatedFetch}
  onError={reportError}
>
  <AppRouter />
</TurboLiteProvider>
```

Choose one first-party route component below. It reads the current route,
renders the document, and uses the router's public `push` and `replace` APIs.
There is no application history map or response-handoff store to maintain.

### Expo Router

```tsx
// app/index.tsx
export { TurboLiteExpoIndexRoute as default } from "react-native-turbo-lite/expo-router"

// app/[...__turboLitePath].tsx
export { TurboLiteExpoRoute as default } from "react-native-turbo-lite/expo-router"
```

Add `app/index.tsx` when Rails owns `/`; the catch-all handles every non-root
document URL. Put these routes only in the URL space Rails owns. Static Expo
routes continue to win over the catch-all. `__turboLitePath` is the reserved
catch-all parameter name; other query parameters are preserved.

`basePath` is the visible Expo route prefix. For example,
`<TurboLiteExpoRoute basePath="/server" />` serves `/server/cart` and requests
the document from `/server/cart`.

When the visible route and Rails document endpoint differ, add
`documentBasePath`:

```tsx
// app/index.tsx
import { TurboLiteExpoIndexRoute } from "react-native-turbo-lite/expo-router"

export default function IndexRoute() {
  return <TurboLiteExpoIndexRoute documentBasePath="/screens" />
}

// app/[...__turboLitePath].tsx
import { TurboLiteExpoRoute } from "react-native-turbo-lite/expo-router"

export default function DocumentRoute() {
  return <TurboLiteExpoRoute documentBasePath="/screens" />
}
```

Now `/cart?mode=pickup#summary` fetches
`/screens/cart?mode=pickup#summary`, while links, forms, redirects, reload,
Back, and Expo history continue to use `/cart`. The document prefix applies
only to the route-owned document GET and Stream refresh; it does not rewrite
form actions or Frame `src` URLs.

Both prefix props accept only a static absolute path. Trailing slashes are
normalized; query, hash, protocol, duplicate slash, and dot-segment values are
rejected. They compose when both are present: `basePath="/admin"
documentBasePath="/screens"` keeps `/admin/users` visible and fetches
`/screens/admin/users`. Dynamic parent routes are not supported because Expo
combines their path params with query params. A path on
`TurboLiteProvider.baseUrl` is not a replacement for either prefix.

### React Navigation

```tsx
import { TurboLiteReactNavigationRoute } from "react-native-turbo-lite/react-navigation"

<Stack.Screen
  name="TurboDocument"
  component={TurboLiteReactNavigationRoute}
  initialParams={{ url: "/cart" }}
/>
```

Use a stack or native-stack navigator. The binding pushes another
`TurboDocument` entry, including when the destination URL matches the current
one.

### React Router on web

```tsx
import { TurboLiteReactRouterRoute } from "react-native-turbo-lite/react-router"

<Route path="*" element={<TurboLiteReactRouterRoute />} />
```

See [router integration and server responses](./docs/navigation.md) for the
complete navigation contract.

Upgrading from 0.1? Read [Migrating to 0.2](./docs/migrating-to-0.2.md).

### What happens on a visit

From `/cart`, this server document:

```xml
<a href="/checkout"><CheckoutButton /></a>
```

pushes `/checkout`; the destination route performs one GET; Back returns to
`/cart`. A `422` form document renders its validation errors on `/cart` without
adding history. A successful unsafe form returns a small visit directive, and
the destination route performs the only GET:

```http
Content-Type: application/vnd.turbo-lite.visit+json
Cache-Control: no-store
Vary: Accept

{"location":"/orders/42","action":"push"}
```

Ordinary user visits use `push`. Unsafe-form directives default to `push`; a
native GET redirect uses a `replace` directive before the destination document
loads. Refresh, Frames, and Frame preloads do not add route history.

## Native interaction hooks

Protocol elements are transparent boundaries. Put a mapped native component
inside the corresponding element and use its hook:

- `useTurboLiteLink()` provides `follow()` and `pending` inside `<a>`.
- `useTurboLiteField(name)` provides a string value and setter inside `<form>`.
- `useTurboLiteForm()` provides `submit()`, form-local `pending`, and an
  immutable `submission` snapshot inside `<form>`.
- `useTurboLiteFrame()` provides Frame state plus `preload()` and `load()`
  inside `<turbo-frame>`.

Those four hooks cover the normal component integration points. Advanced hosts
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
- First-party route components for Expo Router, React Navigation, and React
  Router
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
- A destination GET failure reports through `onError`; a newly mounted route
  has no package UI until a document commits, and Back remains available.
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
bun run audit:ci
```

`bun run check` runs formatting and lint checks, strict TypeScript, unit and
React integration tests, example type checking, the ESM and declaration build,
archive-boundary checks, and `bun pm pack --dry-run`. Android device E2E runs on the
self-hosted release runner. Publishing happens only from the GitHub release
workflow; local checks never publish. The final registry upload intentionally
uses npm CLI because npm trusted publishing authenticates that command through
GitHub OIDC; all dependency, build, test, audit, and pack work uses Bun.

`audit:ci` still fails on any unreviewed advisory. It explicitly ignores three
current Expo/Metro build-tool advisories with no usable upstream fix; none is in
the packed runtime dependency path.
