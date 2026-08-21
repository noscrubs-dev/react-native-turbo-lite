---
name: react-native-turbo-lite
description: Integrate, review, or debug react-native-turbo-lite in Expo and React Native apps backed by Rails Turbo documents, Frames, forms, and same-request Streams. Use for package adoption, component registries, navigation and fetch adapters, lazy Frame loading, native Turbo markup, or integration tests. Do not use for React Native TurboModules, generic performance tuning, browser Hotwire, or arbitrary HTML/WebView rendering.
---

# React Native Turbo Lite

Use Turbo Lite as a narrow protocol adapter: Rails owns documents and updates;
the native app owns components, authentication, navigation, visibility, and
loading/error UI. Do not recreate a browser DOM or move product policy into the
package integration.

## Start with fit

Use Turbo Lite when the server can return well-formed XML-style native component
markup and the app benefits from Rails-owned document, Frame, form, or
same-request Stream behavior.

Do not use it when the flow requires arbitrary HTML repair, CSS selectors,
scripts, browser events, multipart/file input, WebSockets, offline-first state,
or custom Stream actions. Those are outside the package boundary; choose a
WebView, native API, or host-owned subsystem instead of silently approximating
them.

Before implementing or reviewing an adoption, read
[references/adoption.md](references/adoption.md). For markup, hooks, Frames,
forms, Streams, and failure behavior, read
[references/protocol-patterns.md](references/protocol-patterns.md). For test or
release work, read [references/testing.md](references/testing.md).

## Preserve the ownership seams

- Keep one application-owned component map at the root. Do not create a
  per-screen registry.
- Keep `fetch`, `renderer`, and `onError` identities stable across ordinary
  host rerenders. Inline values can recreate the Screen runtime and lose
  in-flight or local state.
- Treat `TurboLiteScreen.url` as host-owned state. Initial loads and later prop
  synchronization must not add history.
- Use a first-party router route component. A full-document GET link or GET
  form pushes its URL first, and the destination route owns the only document
  GET. An unsafe form stays on the source route until it returns a validated
  visit directive. Native GET redirects use a direct `replace` directive before
  document loading; never commit a followed document and then replace. Frames,
  refresh, and preload never mutate native history.
- In Expo Router, use `documentBasePath` only when a visible route such as
  `/cart` must load its document from a static endpoint such as `/screens/cart`.
  The hidden prefix belongs only to route-owned GETs and refresh; never add it
  to router history, links, forms, Frames, or visit directives.
- Put app authentication, tenant headers, retries, telemetry, and connectivity
  policy in the fetch adapter. Return ordinary `Response` objects, including
  valid 422 document responses.
- Render package errors in host-owned UI or telemetry through `onError`. The
  runtime deliberately keeps the last committed UI and owns no error screen.

## Use the high-level surface by default

Prefer `TurboLiteProvider`, the matching first-party route component,
`createComponentRenderer`, and the four protocol hooks. Route components ship
from `react-native-turbo-lite/expo-router`, `/react-navigation`, and
`/react-router`.

- `useTurboLiteLink()` inside an `<a>` boundary.
- `useTurboLiteField(name)` and `useTurboLiteForm()` inside a `<form>`.
- `useTurboLiteFrame()` inside a `<turbo-frame>`.

Use `useTurboLiteRuntime()` or `TurboLiteRuntime` only when the host genuinely
needs custom orchestration. If constructing a runtime directly, subscribe to
snapshots, preserve latest-request-wins behavior, and always call `dispose()`.

## Review for silent failures first

Flag these before style or abstraction findings:

- unstable provider adapters recreating the runtime;
- ordinary user navigation implemented as `replace`, which destroys Back;
- a user-owned history map, URL mapper, response-handoff cache, or route token
  added instead of using a first-party route component;
- a followed top-level GET/POST document treated as safely replayable; use the
  negotiated visit directive before loading the destination document;
- a lazy Frame with no real visibility path to `load()`;
- preload treated as a render, navigation, or analytics impression;
- mismatched or duplicate Frame/Stream target IDs;
- missing or incorrect response media types;
- unknown leaf components disappearing without monitored `onError` reporting;
- attribute decoding that parses untrusted JSON without size and schema checks;
- tests importing private source files instead of the packed public package.

## Finish with evidence

Test the server contract and the native boundary separately. A release-ready
adoption proves at least one packed-package native journey covering navigation,
Back behavior, a Frame, a form, a Stream mutation, and error reporting. State
which unsupported behaviors remain host-owned; do not label partial browser
Turbo compatibility as complete.
