# React Native Turbo Lite

A small, independently publishable Rails Turbo runtime for React Native. Rails
owns documents and updates; React Native owns components; Turbo Lite owns
requests, eager Frames, URL-encoded forms, and same-request Turbo Streams.

It has no Expo, Expo Router, React Query, NoScrubs, or Expo Turbo runtime
dependency.

## Root setup

```tsx
const renderer = createComponentRenderer({ components: existingComponentMap })

<TurboLiteProvider
  baseUrl="https://app.example.com"
  renderer={renderer}
  fetch={authenticatedFetch}
  navigation={{ navigate: (url) => router.replace(url) }}
  onError={reportError}
>
  <TurboLiteScreen url="/cart" />
</TurboLiteProvider>
```

After the root adapter is installed, a screen needs only its URL. There is no
session/controller assembly and no per-screen registry.

Links and forms are transparent protocol boundaries. A mapped native child uses
`useTurboLiteLink()`, `useTurboLiteField(name)`, or `useTurboLiteForm()` to bind
native press/input behavior. See the
[working example](https://github.com/noscrubs-dev/react-native-turbo-lite/blob/main/example/App.tsx) for a
complete document, link, eager Frame, GET form, POST form, replace Stream,
append Stream, and unknown-wrapper fallback.

## Existing NoScrubs SDUI map

This bridge reads the existing SDUI context once. It does not copy the component
map or create a second registry:

```tsx
import { SduiContext } from "@expo-shared/lib/sdui/context"
import { createComponentRenderer, TurboLiteProvider } from "react-native-turbo-lite"

function NoScrubsTurboBridge({ children }) {
  const { components } = React.useContext(SduiContext)
  const renderer = React.useMemo(
    () => createComponentRenderer({
      components,
      decodeAttribute(value) {
        // Optional: apply the app's existing safe string-to-value rules here.
        return value
      },
    }),
    [components],
  )

  return (
    <TurboLiteProvider renderer={renderer} fetch={useApiFetch()} onError={captureError}>
      {children}
    </TurboLiteProvider>
  )
}
```

No NoScrubs package is imported by Turbo Lite; the host application owns this
adapter.

## Public API

- `TurboLiteProvider`, `TurboLiteScreen`
- `createComponentRenderer`, `normalizeTagName`
- `useTurboLiteLink`, `useTurboLiteField`, `useTurboLiteForm`
- `TurboLiteRuntime`, `useTurboLiteRuntime` for advanced host integration
- Typed errors and adapter/node/limit/request types
- `parseDocument` and `parseStreamResponse` for protocol tooling

## Reliability boundary

- The old committed tree stays visible after network, media-type, parse, Frame,
  or safety-limit failures.
- A stale/cancelled response never replaces newer work.
- Duplicate active IDs are rejected before commit.
- Stream siblings apply in source order. Each target mutation is atomic; earlier
  successful siblings remain committed if a later action fails.
- Unknown app wrappers render children and emit `UnknownElementError`; unknown
  leaves render nothing. Turbo Lite never displays package-owned error UI.

Read the [wire-format and limits](./docs/protocol.md) and the exact
[compatibility matrix](./docs/compatibility.md).

## Development and release checks

```sh
npm ci
npm run check
npm run test:coverage
npm audit
```

`npm run check` runs lint, strict TypeScript, unit and React integration tests,
the typed React Native example, ESM/declaration build, archive boundary checks,
and `npm pack --dry-run`. Publishing is intentionally only wired to the GitHub
release workflow; local checks do not publish.
