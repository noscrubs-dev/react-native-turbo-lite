# Turbo compatibility matrix

This is the intentional `0.2` boundary. “Supported” means covered by automated
tests in this repository.

| Turbo behavior | 0.2 | Notes |
| --- | --- | --- |
| Document GETs, 422, valid error documents | Supported | First-party bindings own route synchronization |
| Route-owned top-level GET `204` | Rejected with bindings | The already-pushed route reports the missing document; Back remains available |
| Relative and absolute same-origin links | Supported | Cross-origin visits are rejected |
| Native GET redirect directive | Supported | Replace-only; canonical route performs one document GET |
| Followed top-level GET/POST redirect | Rejected with bindings | Negotiate a visit directive; avoids remount and one-request-state loss |
| Request cancellation and latest-request-wins | Supported | Stale/cancelled work cannot commit |
| Native route push and Back | Supported | Expo Router, React Navigation, and React Router bindings use public router APIs |
| Unsafe-form visit directive | Supported | Push by default; replace only when explicit; destination performs one GET |
| Direct `422` form document | Supported | Validation renders on the source route without a history change |
| Eager and lazy Frames and `Turbo-Frame` request header | Supported | Host signals native visibility through `useTurboLiteFrame` |
| Frame preload | Supported | Fetches and validates without committing UI or history; later load reuses it |
| Nearest-Frame link/form targeting and `_top` | Supported | Named exact Frame targets also work |
| GET and URL-encoded POST forms | Supported | Ordered/repeated entries plus form-local pending and immutable submission state via hooks |
| Same-request Stream siblings | Supported | Embedded document Streams or a Frame/form response |
| `append`, `prepend`, `replace`, `update`, `remove`, `before`, `after`, `refresh` | Supported | Exact ID only; source order |
| Direct-child ID collision behavior | Supported | Existing matching direct child is replaced |
| Missing Stream target | Supported no-op | Emits a typed diagnostic |
| Unknown native wrapper | Supported fallback | Children render; typed error once/revision |
| Recurse and Frame history | Not supported | Frame requests never change native history |
| Files, multipart, camera/payment values | Not supported | Native host responsibility |
| CSS targets/selectors and custom Stream actions | Not supported | Exact IDs only |
| Morphing and permanent elements | Not supported | Replacement only |
| Action Cable, WebSockets, subscriptions | Not supported | Same-request Streams only |
| Browser DOM/events, scripts, HTML repair | Not supported | Hardened small node parser |
| Page snapshots, page prefetch, scroll/focus restoration | Not supported | Destination documents load from their route; speculative page prefetch remains host-owned |
| Expo Router, React Navigation, React Router | Optional | First-party bindings; none is required by the core runtime |
