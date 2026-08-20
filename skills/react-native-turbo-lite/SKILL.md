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
- Keep `fetch`, `renderer`, `navigation`, and `onError` identities stable across
  ordinary host rerenders. Inline adapters can recreate the Screen runtime and
  lose in-flight or local state.
- Treat `TurboLiteScreen.url` as host-owned state. Initial loads and later prop
  synchronization must not add history.
- Use native `push` after committed user link or full-document form visits.
  Use `replace` only for refresh-style document replacement. Frames and preload
  never mutate native history.
- Put app authentication, tenant headers, retries, telemetry, and connectivity
  policy in the fetch adapter. Return ordinary `Response` objects, including
  valid 422 document responses.
- Render package errors in host-owned UI or telemetry through `onError`. The
  runtime deliberately keeps the last committed UI and owns no error screen.

## Use the high-level surface by default

Prefer `TurboLiteProvider`, `TurboLiteScreen`, `createComponentRenderer`, and
the four protocol hooks:

- `useTurboLiteLink()` inside an `<a>` boundary.
- `useTurboLiteField(name)` and `useTurboLiteForm()` inside a `<form>`.
- `useTurboLiteFrame()` inside a `<turbo-frame>`.

Use `useTurboLiteRuntime()` or `TurboLiteRuntime` only when the host genuinely
needs custom orchestration. If constructing a runtime directly, subscribe to
snapshots, preserve latest-request-wins behavior, and always call `dispose()`.

## Review for silent failures first

Flag these before style or abstraction findings:

- unstable provider adapters recreating the runtime;
- a `replace` adapter used for ordinary user navigation, which destroys Back;
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
