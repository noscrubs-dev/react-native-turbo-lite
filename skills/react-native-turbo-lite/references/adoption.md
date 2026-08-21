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
3. Add a stable authenticated fetch adapter. Preserve redirects and return
   `Response` for valid non-2xx documents such as 422 validation pages.
4. Add stable `push` and `replace` adapters around the host router. Decide
   explicitly whether the router can bind an in-memory prepared document to
   the exact destination entry; otherwise use the safe destination-GET mode.
5. Create one stable renderer and one stable error callback.
6. Mount `TurboLiteScreen` from host-owned URL state.
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

const navigation = useMemo(
  () => ({
    // Ignoring the optional second argument is safe and causes one destination GET.
    push: (url: string) => router.push(toAppRoute(url)),
    replace: (url: string) => router.replace(toAppRoute(url)),
  }),
  [router],
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
    navigation={navigation}
    onError={reportTurboError}
    renderer={renderer}
  >
    <TurboLiteScreen url={currentUrl} />
  </TurboLiteProvider>
)
```

Keep the adapter identities stable. In the current React surface, changing the
provider configuration creates a new Screen runtime. An inline `onError`,
renderer, navigation object, fetch wrapper, or limits object can therefore
cancel work or reset state during an unrelated parent rerender.

## Navigation contract

The native router is the source of truth:

| Event | Native history |
| --- | --- |
| Initial `TurboLiteScreen.url` | none |
| Later host URL prop change or native Back sync | none |
| Successful user link | push |
| Successful full-document GET/POST form | push |
| Turbo refresh Stream | replace |
| Frame load or preload | none |

Do not call native navigation before a response is fetched, parsed, and
validated. Failed, cancelled, or stale visits must leave both the screen and
native history unchanged. For a push, the destination document must not be
written into the cached source runtime.

To avoid the fallback destination GET, accept the optional prepared document in
`push(url, preparedDocument)`, retain it in memory on the exact new route entry,
and pass that same object to the destination `TurboLiteScreen`. Never store it
by URL or serialize it into route params. Same-URL stack entries, redirects,
overlapping navigation, reloads, and deep links make URL-keyed handoff unsafe.
If the router cannot establish exact entry ownership before destination load,
ignore the object and let the destination fetch.

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
