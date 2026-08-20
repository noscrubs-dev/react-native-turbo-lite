# Goal: Build React Native Turbo Lite

Create a new, independently publishable npm package named
react-native-turbo-lite.

Work only in:

    /Users/sudhanshugautam/workspace/react-native-turbo-lite

Implement the package, tests, documentation, and a working example. Do not stop
after writing a plan. Do not publish the package.

Initialize this directory as an independent TypeScript package. Do not put it
inside the Expo Turbo repository and do not convert another repository into a
workspace.

## Read-only reference projects

Inspect these projects when useful, but do not change any file in them:

- /Users/sudhanshugautam/workspace/expo-turbo
- /Users/sudhanshugautam/workspace/noscrubs
- /Users/sudhanshugautam/.herdr/worktrees/noscrubs/codex-cart-v3-expo-turbo
  if this worktree still exists

Use Expo Turbo as a reference for Rails Turbo behavior, tests, and failure
cases. Do not make React Native Turbo Lite a wrapper around Expo Turbo and do
not add Expo Turbo as a runtime dependency.

Use NoScrubs as a reference for the current SDUI node format, renderer,
provider, component maps, forms, and Rails XML-to-JSON conversion. Do not add
NoScrubs or @acme packages as dependencies.

Useful NoScrubs reference files:

- packages/expo-shared/src/lib/sdui/renderer.tsx
- packages/expo-shared/src/lib/sdui/provider.tsx
- packages/expo-shared/src/lib/sdui/context.tsx
- packages/expo-shared/src/lib/sdui/registry/components.ts
- packages/expo-shared/src/lib/sdui/components/form.tsx
- apps/rails/app/controllers/api_controller.rb
- apps/rails/config/initializers/nokogiri_json.rb

Resolve these paths from the NoScrubs repository root.

## Product intent

Build a small React Native Turbo runtime. Keep the useful Rails Turbo response
format without recreating a browser DOM.

Rails developers must be able to write normal Turbo documents, links, forms,
Frames, and Turbo Stream responses. They can use native component tags in the
markup.

This is SDUI in a Turbo form:

- Rails owns the document and updates.
- React Native owns component rendering.
- Turbo Lite owns requests, Frames, forms, and same-request Streams.

## Package boundary

The package must be general-purpose.

It must not import:

- NoScrubs packages
- @acme packages
- Expo Router
- React Query
- NoScrubs authentication or API code
- The Expo Turbo runtime

React and React Native must be peer dependencies. Expo must not be required.
Allow the host to supply fetch and navigation adapters.

Keep the package small. Do not copy the large Expo Turbo DOM, registry,
capability, snapshot, Cable, or controller systems.

## Reuse the current SDUI model

Use a small plain node type that is structurally compatible with the current
SDUI shape:

    type TurboLiteNode =
      | string
      | number
      | {
          type: string
          props: {
            children?: TurboLiteNode | TurboLiteNode[]
            [name: string]: unknown
          }
        }

Do not import the NoScrubs SduiNode type.

The package must support a renderer adapter. This lets an application reuse its
existing component system.

NoScrubs must be able to bridge its current SduiProvider and component map once
at the application root. It must not create a second registry or pass a
registry to each Turbo Lite screen.

The target high-level API shape is:

    <TurboLiteProvider
      renderer={rendererAdapter}
      fetch={fetchAdapter}
      navigation={navigationAdapter}
      onError={handleError}
    >
      <TurboLiteScreen url="/cart" />
    </TurboLiteProvider>

The exact names can change if a smaller and clearer API is found.

TurboLiteScreen must not require callers to assemble sessions, controllers,
Frame stores, form handlers, or Stream handlers.

Do not add:

- Separate component definition files
- A capability manifest
- A capability manifest generator
- Build-time component scanning
- React or React Native mocks for a generator
- A per-screen component registry
- Automatic module discovery

## Markup and parsing

Accept well-formed Rails Turbo markup, including:

- Native component tags
- a
- form
- turbo-frame
- turbo-stream
- template

Accept standard Turbo Stream responses with this media type:

    text/vnd.turbo-stream.html

Parse markup directly into the small node tree. Do not create a live DOM,
parent-linked nodes, a CSS selector engine, or a browser event system.

The parser must:

- Use documented limits for response size, depth, node count, attribute count,
  text size, and Stream count.
- Reject scripts, DTDs, external entities, processing instructions, and
  malformed markup.
- Detect duplicate active IDs before a document commits.
- Preserve the last committed screen when parsing fails.
- Support multiple sibling Turbo Stream tags.
- Keep native tag resolution deterministic after tag-name normalization.
- Reject two component names that normalize to the same wire tag.

Document the tag-name and attribute conversion rules. Provide an adapter hook
for applications that must decode string attributes into numbers, booleans,
arrays, or objects.

Do not promise browser repair for arbitrary invalid HTML.

## Documents and links

Support:

- Initial document GET
- Relative and absolute same-origin links
- Redirects
- 204 with no document replacement
- Server-rendered 422 responses
- Valid server error documents
- Request cancellation
- Latest-request-wins behavior
- Host-owned navigation and URL updates

A stale or cancelled response must never replace a newer screen.

Keep the current committed tree when a network, media type, or parse error
occurs. Report the error to the host.

Do not add snapshot caching, prefetching, scroll restoration, or browser
history emulation. The host application owns back navigation.

## Turbo Frames

Support this small Frame contract:

- turbo-frame with id
- Eager src loading
- The Turbo-Frame request header
- Matching Frame extraction from the response
- Links and forms target their nearest Frame by default
- _top targets the full document
- Replace only the matching Frame content
- Keep the Frame identity when its children change

A missing matching Frame must report a typed error and preserve the old Frame.

Do not support lazy Frames, recurse, Frame history, preload, morphing, or
complex named targeting in the first release.

## Forms

Turbo Lite owns normal GET and POST form submission.

Native input components supply ordered name and value entries through a small
hook or form context. Turbo Lite owns:

- Relative form actions
- GET query encoding
- URL-encoded POST bodies
- Repeated field names
- Pending state
- Request cancellation
- Redirect handling
- 422 document responses
- Frame responses
- Full-document responses
- Turbo Stream responses

Do not implement browser control discovery.

Exclude file uploads, multipart forms, camera data, payment SDK data, browser
validation, and confirmation dialogs. Those remain native application
components.

## Same-request Turbo Streams

Support Turbo Streams returned from a document, link, Frame, or form request.

Do not add Action Cable, WebSockets, subscriptions, an external live Stream
API, or other live delivery in this release.

Support these exact-ID actions:

- append
- prepend
- replace
- update
- remove
- before
- after
- refresh

Rules:

- Require one exact target ID for structural actions.
- Apply sibling actions in response order.
- Keep untouched node identity and React keys.
- Replaced nodes can remount.
- An empty replacement removes the target.
- append and prepend must follow Turbo direct-child ID collision behavior.
- A missing target is a no-op, but it must produce a diagnostic.
- One failed action must not partially change its target.
- Earlier successful sibling actions remain committed.
- refresh reloads the current document.

Reject and report:

- CSS targets
- Selector-based targeting
- method="morph"
- Custom Stream actions
- Malformed or missing template content

## Unknown native tags

Unknown application tags must behave like transparent HTML wrappers:

- Render their children.
- Report a typed UnknownElementError.
- Include the tag, URL, and node path in the error.
- Report it once per node and document revision.
- Never display package-owned update or error UI.

An unknown leaf renders nothing and reports the same error.

Protocol tags such as turbo-frame, turbo-stream, and template must never use
the application-tag fallback.

Use onError or an equivalent host error channel so the application decides
whether to log, throw, or display an error.

## Explicit non-goals

Do not implement:

- Action Cable
- WebSockets
- A mutable DOM
- CSS or CSS selectors
- Morphing
- Permanent elements
- Snapshot caching
- Prefetch or preload
- Scroll or focus restoration
- Browser lifecycle events
- Script execution
- Full browser HTML repair
- Capability manifests
- A Rails gem
- Full API compatibility with Expo Turbo

## Required proof

Add tests that prove:

1. A Rails document renders native component tags.
2. A screen needs only a URL after the root adapter is installed.
3. No second registry or per-screen registry is required.
4. Unknown parents render their children and report an error.
5. A newer visit cannot be replaced by a stale response.
6. A Frame request replaces only the matching Frame.
7. GET forms encode query values correctly.
8. POST forms handle document, Frame, 422, redirect, and Stream responses.
9. Every supported Stream action changes the correct exact-ID target.
10. Multiple Stream actions run in source order.
11. Untouched stateful components do not remount after a Stream update.
12. Malformed markup and failed Stream actions do not corrupt the current tree.
13. The package archive contains no NoScrubs, @acme, or Expo Turbo dependency.
14. Parser safety limits fail clearly and preserve the committed tree.

Add a small example that shows:

- One document
- One link
- One Frame
- One GET form
- One POST form
- One replace Stream response
- One append Stream response
- One unknown wrapper with visible children

Add a NoScrubs adapter example in the documentation. It must show how to read
the existing SDUI context and component map without creating another registry.
Do not modify NoScrubs for this proof.

## Package quality

Use TypeScript with strict checks. Provide ESM output and declaration files.
Keep exports small and documented.

Add:

- Lint
- Type checking
- Unit tests
- React integration tests
- Build verification
- npm package dry-run verification
- A package-content check
- A compatibility matrix that lists supported and unsupported Turbo behavior

Use focused fixtures based on normal Rails Turbo responses. Compare behavior
with Expo Turbo or browser Turbo only where that comparison is useful. Do not
copy large test suites.

## Completion

Before reporting completion:

- Run lint, type checks, tests, build, and package dry-run checks.
- Inspect the packed npm contents.
- Confirm that no reference project was changed.
- Confirm that no npm package was published.
- Report the public API.
- Report supported behavior and exclusions.
- Report production source-line count and packed size.
- Report exact commands and results.
- Report any remaining gaps.

Ask the user only if work requires publication, a change to a reference
project, or a material expansion of this scope.
