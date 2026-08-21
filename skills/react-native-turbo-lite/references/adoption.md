# Adoption architecture

Read this reference when deciding whether Turbo Lite fits a flow, installing it,
or designing the root integration.

## Decision boundary

Choose Turbo Lite when all of these are true:

- Rails can emit well-formed XML-style markup whose tags map to native
  components.
- The flow is primarily document navigation, partial Frames, URL-encoded forms,
  or same-response Turbo Streams.
- The native app should retain control of navigation, authentication, visual
  components, accessibility, and loading/error presentation.

Choose another approach when the flow needs a real browser DOM, arbitrary HTML,
CSS/script execution, WebSockets or Action Cable, multipart uploads, native
camera/payment values, offline conflict resolution, or custom Stream actions.
Do not hide these gaps behind adapters.

## Integration sequence

1. Inventory the existing app router, authenticated fetch path, error reporting,
   component library, and current Rails response formats.
2. Define the smallest component map required for one complete vertical flow.
   Reuse native design-system components; do not build a second UI system.
3. Add a stable authenticated fetch adapter. Return `Response` for valid
   non-2xx documents such as 422 validation pages.
4. Mount the matching first-party Expo Router, React Navigation, or React
   Router route component. Do not build a second history store or handoff cache.
5. Create one stable renderer and one stable error callback.
6. Give the Provider an absolute `baseUrl`; the route component owns URL state.
7. Add protocol-bound native controls through hooks.
8. Prove the real server contract and packed native app before expanding the
   component map.

## Root template

Adapt this to the app's router and authentication path:

```tsx
const renderer = useMemo(
  () => createComponentRenderer({ components, decodeAttribute }),
  [],
)

const reportTurboError = useCallback((error: TurboLiteError) => {
  reportError(error, {
    code: error.code,
    url: error.url,
  })
}, [])

return (
  <TurboLiteProvider
    baseUrl={API_ORIGIN}
    fetch={authenticatedFetch}
    onError={reportTurboError}
    renderer={renderer}
  >
    <AppRouter />
  </TurboLiteProvider>
)
```

Then mount one package route component, for example an Expo Router catch-all:

```tsx
// app/index.tsx (when Rails owns /)
export { TurboLiteExpoIndexRoute as default } from "react-native-turbo-lite/expo-router"

// app/[...__turboLitePath].tsx
export { TurboLiteExpoRoute as default } from "react-native-turbo-lite/expo-router"
```

For a static nested URL prefix, wrap both components with the same `basePath`.
Dynamic Expo parent routes are unsupported by this binding because their path
params collide with query-param reconstruction.

Keep the adapter identities stable. In the current React surface, changing the
provider configuration creates a new Screen runtime. An inline `onError`,
renderer, fetch wrapper, or limits object can therefore
cancel work or reset state during an unrelated parent rerender.

## Navigation contract

The native router is the source of truth:

| Event | Native history |
| --- | --- |
| Initial `TurboLiteScreen.url` | none |
| Later host URL prop change or native Back sync | none |
| User link or full-document GET form | push before the destination GET |
| Native GET redirect directive | replace before the canonical GET |
| Successful unsafe form visit directive | directive action, default push |
| Turbo refresh Stream | none; reload current entry in place |
| Frame load or preload | none |

Router-first GET navigation means a network or parse failure happens on the new
route; host error UI must make that visible, and Back returns to the preserved
source entry. Unsafe POST navigation is response-first: malformed, failed, or
cross-origin visit directives leave both UI and history unchanged. A `422`
document renders on the source route. Frames never change history.

Successful top-level unsafe forms that navigate return
`application/vnd.turbo-lite.visit+json` with
`{"location":"/orders/42","action":"push"}`. Keep normal `303 See Other`
responses for browsers and unmodified Turbo through content negotiation. Do
not discard a followed POST redirect and issue another GET: that can consume
one-request Rails flash state before the destination renders.

Native GET redirects use the same media type with a `replace` action. Do not
commit a followed top-level GET document and then replace the native route: a
router may remount it and issue a second GET. Keep ordinary HTTP redirects for
browsers through `Accept` negotiation.

## Fetch contract

The adapter receives a resolved same-origin URL and `RequestInit`. It should:

- attach session credentials and required app/tenant headers;
- preserve the package `Accept`, `Content-Type`, `Turbo-Frame`, and abort signal;
- return the final `Response` so redirects and media types remain observable;
- avoid converting all non-2xx responses into thrown errors;
- keep retry/offline policy in the host without replaying unsafe POSTs.

Cross-origin visits are rejected. If multiple API origins are legitimate, make
that an explicit host routing decision rather than weakening the runtime.

## Component and attribute policy

Create one root component map. Names such as `CardTitle`, `card-title`, and
`card_title` normalize to the same wire tag, so normalized collisions are a
startup error.

Attributes arrive as strings. Decode only attributes with an explicit native
contract. If decoding JSON, dates, colors, URLs, or enums, enforce size, schema,
and allowlist checks. Never turn server strings into arbitrary component names,
functions, styles, or navigation destinations.

## Rollout

Start with one reversible, observable flow. Keep the prior native route until
the real Rails response, Back navigation, offline/error behavior, and native
E2E pass. Expand by component family or user flow, not by adding ad hoc tags to
fix individual screens.
