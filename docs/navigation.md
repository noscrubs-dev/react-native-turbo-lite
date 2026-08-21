# Router integration and server responses

Turbo Lite ships route components for Expo Router, React Navigation, and React
Router. They use each router's public URL APIs. Applications do not need a
history mirror, visit IDs, response cache, or URL mapping callback.

## Router setup

### Expo Router

```tsx
// app/index.tsx
export { TurboLiteExpoIndexRoute as default } from "react-native-turbo-lite/expo-router"

// app/[...__turboLitePath].tsx
export { TurboLiteExpoRoute as default } from "react-native-turbo-lite/expo-router"
```

Add the index route when Rails owns `/`; Expo catch-all routes do not match the
root URL. Keep both inside the part of the route tree owned by Rails documents.
Static Expo routes continue to take precedence. Reserve `__turboLitePath` for
the catch-all route parameter; every other query parameter is preserved.

`basePath` describes the visible static Expo route prefix. With
`basePath="/server"`, the route `/server/cart` requests `/server/cart`.

Use `documentBasePath` when Rails serves the same document from a different
path:

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

The visible route `/cart?mode=pickup#summary` performs its route-owned GET at
`/screens/cart?mode=pickup#summary`. The runtime still resolves document links,
GET and unsafe form actions, Frame `src` values, visit directives, and Back
against `/cart`; `/screens` never enters router history. A Stream refresh
repeats the route-owned GET at `/screens/cart` without adding history.

Use both props when needed:

```tsx
<TurboLiteExpoRoute
  basePath="/server"
  documentBasePath="/screens"
/>
```

This displays `/server/cart` while requesting `/screens/server/cart`. The
document prefix is added before the complete visible pathname, so separate
`/admin` and `/store` mounts remain distinct on the server. Both values must be
static absolute paths. Trailing slashes are normalized; query, hash, protocol,
duplicate slash, and dot-segment values are rejected. A path in
`TurboLiteProvider.baseUrl` follows normal URL resolution and is not a route or
document prefix. Dynamic parent routes remain unsupported because Expo exposes
their path params in the same local object as query params.

### React Navigation

```tsx
import { TurboLiteReactNavigationRoute } from "react-native-turbo-lite/react-navigation"

<Stack.Screen
  name="TurboDocument"
  component={TurboLiteReactNavigationRoute}
  initialParams={{ url: "/cart" }}
/>
```

Use a stack or native-stack navigator. The binding discovers its registered
screen name and pushes that screen again with the serializable `{ url }` param.

### React Router

```tsx
import { TurboLiteReactRouterRoute } from "react-native-turbo-lite/react-router"

<Route path="*" element={<TurboLiteReactRouterRoute />} />
```

All three bindings read `baseUrl` and the renderer from the nearest
`TurboLiteProvider`. They preserve path, query, and hash while rejecting a
destination on another origin.

## Navigation behavior

| Event | Document | Router history |
| --- | --- | --- |
| Route mount, deep link, reload | Destination performs one route-owned GET, using `documentBasePath` when configured | No extra entry |
| Back | Retained native entries resume; other routers GET the prior URL | No extra entry |
| User follows a full-document link | Destination performs one GET | `push` |
| Full-document GET form succeeds | Destination performs one GET | `push` |
| GET returns a visit directive | Canonical destination performs one GET | `replace` |
| Unsafe form returns a visit directive | Destination performs one GET | Directive action |
| Unsafe form returns a `422` document | Errors render on the source route | No change |
| Turbo Stream or Frame response | Current route updates | No change |
| Turbo Stream refresh | Current route-owned document GET repeats in place | No change |
| Unsafe form, Frame, or refresh returns `204` | Current document stays visible | No change |
| Route-owned document GET returns `204` | Rejected and reported; route has no committed document | Already-pushed entry remains |

Normal user navigation pushes before the destination GET, so Back keeps
working. If that GET fails, `onError` reports it; a newly mounted route has no
package UI until a document commits. Replace is only for an explicit directive.
A failed or invalid form response must not add history.

## Native navigation directives

A native `fetch` normally follows a `303` before application code can inspect
its `Location`. Issuing another GET after that can consume one-request state,
including a Rails flash, before the destination screen renders it. For native
Turbo Lite requests, return a location-only directive instead:

```http
Content-Type: application/vnd.turbo-lite.visit+json

{"location":"/orders/42","action":"push"}
```

`location` must resolve to the configured `baseUrl` origin. For an unsafe form,
`action` is `push` or `replace`; omit it to use `push`. The binding changes the
route, and the destination route performs the only GET.

Use the same media type for a native GET redirect, but omit `action` or set it
to `replace`:

```http
Content-Type: application/vnd.turbo-lite.visit+json
Cache-Control: no-store
Vary: Accept

{"location":"/canonical-orders","action":"replace"}
```

This replaces the alias route before its document loads. A GET directive with
`action: "push"` is rejected because it would leave an unnecessary alias entry.

For an unsafe form, keep the normal browser/Turbo response as a `303 See Other`.
Negotiate on the Turbo Lite visit media type rather than changing the browser
contract:

```ruby
if request.accepts.include?(Mime::Type.lookup("application/vnd.turbo-lite.visit+json"))
  response.set_header("Cache-Control", "no-store")
  response.set_header("Vary", "Accept")
  render json: { location: order_path(@order), action: "push" },
         content_type: "application/vnd.turbo-lite.visit+json"
else
  redirect_to @order, status: :see_other
end
```

For a canonical GET, use `replace`; keep the application's normal GET redirect
status for browsers:

```ruby
if request.accepts.include?(Mime::Type.lookup("application/vnd.turbo-lite.visit+json"))
  response.set_header("Cache-Control", "no-store")
  response.set_header("Vary", "Accept")
  render json: { location: canonical_orders_path, action: "replace" },
         content_type: "application/vnd.turbo-lite.visit+json"
else
  redirect_to canonical_orders_path, status: :moved_permanently
end
```

If a native unsafe-form request receives and follows a redirect, Turbo Lite
fails closed and leaves the source document in place. A direct successful HTML
document is also rejected: use a Stream, `204`, or the visit directive.

A followed top-level GET document is also rejected when a router binding is
active. Otherwise committing it and then replacing the route can remount the
screen, issue a second GET, and consume one-request state. Negotiate the direct
GET `replace` directive instead. Frame redirects remain document responses
because they do not change router history.

Validation remains a document response with status `422`; it is committed to
the current route and never converted into a navigation directive.

## Why there is no response handoff

A URL is not a route-entry identity: the same URL may appear multiple times in
one stack, requests may overlap, and browser history may be serialized. Binding
an opaque response to the correct future entry would require application-owned
tokens or a shadow history store. Turbo Lite avoids that failure mode. Router
entries carry only URLs, and each destination performs one predictable GET.
