# Migrating to 0.2

Version 0.2 makes the application router the only owner of top-level route
entries. It removes the response-handoff API that could not bind a document
reliably across Expo Router, React Navigation, and browser history.

## Replace application navigation plumbing

Remove `TurboLiteProvider.navigation`, `TurboLitePreparedDocument`, and the
`preparedDocument` Screen prop. Mount the matching first-party route component
instead:

```tsx
<TurboLiteProvider baseUrl={origin} fetch={fetch} renderer={renderer}>
  <AppRouter />
</TurboLiteProvider>
```

```tsx
// Expo Router: app/index.tsx
export { TurboLiteExpoIndexRoute as default } from "react-native-turbo-lite/expo-router"

// Expo Router: app/[...__turboLitePath].tsx
export { TurboLiteExpoRoute as default } from "react-native-turbo-lite/expo-router"
```

React Navigation uses `TurboLiteReactNavigationRoute`; React Router uses
`TurboLiteReactRouterRoute`. Delete application history mirrors, visit tokens,
prepared-response maps, and URL mapping callbacks.

## Negotiate native navigation responses

For a successful unsafe form, return
`application/vnd.turbo-lite.visit+json` with a same-origin `location` and an
optional `push` or `replace` action. For a native GET redirect, return the same
media type with `replace`. Send `Cache-Control: no-store` and `Vary: Accept`.
Browsers should keep their ordinary redirect response.

Router-bound followed redirects now fail closed instead of risking a duplicate
GET or losing one-request server state. A `422` document still commits on the
source route. Routerless `TurboLiteScreen` and `TurboLiteRuntime` remain
available as low-level surfaces.

GET forms now replace the action URL's existing query, matching browser form
submission semantics.
