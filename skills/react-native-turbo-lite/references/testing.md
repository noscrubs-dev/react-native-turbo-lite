# Testing and release evidence

Read this reference when adding tests, reviewing an adoption, diagnosing a
failure, or claiming a release is ready.

## Separate the layers

1. **Rails contract tests** prove media types, XML shape, unique IDs, matching
   Frame responses, validation documents, and Stream ordering.
2. **Native component tests** prove mapped component props, accessibility,
   hook wiring, pending states, and host error UI.
3. **Runtime/integration tests** prove cancellation, latest-request-wins,
   navigation semantics, Frame targeting/preload, form encoding, and Stream
   mutations.
4. **Packed-package E2E** proves the public registry boundary, Expo/React Native
   bundling, release APK, router Back behavior, native input, and accessibility
   selectors.

Do not replace one layer with another. A mocked React test does not prove the
Rails response, and a device screenshot does not prove cancellation races.

## Minimum adoption matrix

| Behavior | Required proof |
| --- | --- |
| Initial screen | One fetch; no native push/replace |
| User link | Source stays unchanged; one push; destination renders; native Back returns without remounting source |
| Prepared navigation handoff | Exact destination renders with no duplicate GET; missing, invalid, and wrong-URL handoffs refetch safely |
| Refresh | Current document reloads; one replace; no duplicate Back entry |
| Eager Frame | Automatic request with matching `Turbo-Frame` header |
| Lazy Frame | No request before visibility; load after visibility |
| Preload | UI/history unchanged; later load makes no second request |
| GET form | Ordered fields encoded in URL; full document pushes |
| POST form | URL-encoded body; form-local pending and immutable submission snapshot; document or Stream response applies |
| Stream siblings | Source order and partial-failure behavior |
| Unknown wrapper/leaf | Children fallback and monitored typed error |
| Failure | Last committed UI remains; host error signal appears |
| Race | Older document or Frame response cannot overwrite newer work |

## Test the package users install

For the release example and native E2E:

1. Build the package.
2. Create the package tarball with `bun pm pack`.
3. Install that tarball into the example app. Avoid `file:..` symlinks, which
   can create duplicate React copies and conceal package-boundary defects.
4. Generate native projects from a clean Expo prebuild.
5. Build a release APK/IPA, install it, and run native automation.

Selectors should use stable accessibility labels or test IDs. Test behavior,
not debug-only state text. For push semantics, prove that a user visit can go
Back with URL/document equality and retained source state. Count requests to
prove an exact handoff does not issue a destination GET. Also test the
one-argument adapter fallback so compatibility does not depend on handoff
support. For lazy preload, prove the placeholder remains until load and that
the request count stays unchanged on commit.

## Diagnosing failures

Classify the failure before editing:

- **Blank or stale UI:** inspect `onError`, media type, parser error, duplicate
  IDs, adapter identity churn, and request ownership.
- **Back broken:** compare initial prop sync, user push, refresh replace, and
  Frame history behavior separately. Confirm that a pushed document never
  committed into the source runtime and that handoff ownership uses a route
  entry key rather than URL equality.
- **Frame unchanged:** verify the request header, exact response Frame ID,
  current document generation, and visibility/load callback.
- **Double request:** check eager plus manual load, preload identity, component
  remounts, and provider adapter stability.
- **Form missing values:** ensure fields are inside the intended form boundary
  and preserve repeated names/order.
- **Device-only failure:** test the packed package, React singleton resolution,
  release bundling, native safe-area/keyboard behavior, and accessibility tree.

Do not patch an assertion until the current screenshot, hierarchy, request log,
or runtime snapshot proves whether the product or the test is wrong.

## Release claim

A release-ready claim should name:

- the exact commit and package version;
- unit/integration results and coverage thresholds;
- package contents and tarball size;
- dependency audit result;
- packed-package native E2E result and runner/device;
- registry version, integrity/signature, and provenance after publish.

Keep host-specific routes, credentials, tenancy, and app rollout outside the
independent package release boundary unless the release explicitly includes an
adopter migration.
