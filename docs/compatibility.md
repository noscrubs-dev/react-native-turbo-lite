# Turbo compatibility matrix

This is the intentional `0.1` boundary. “Supported” means covered by automated
tests in this repository.

| Turbo behavior | 0.1 | Notes |
| --- | --- | --- |
| Document GETs, redirects, 204, 422, valid error documents | Supported | Host owns URL/navigation UI |
| Relative and absolute same-origin links | Supported | Cross-origin visits are rejected |
| Request cancellation and latest-request-wins | Supported | Stale/cancelled work cannot commit |
| Eager and lazy Frames and `Turbo-Frame` request header | Supported | Host signals native visibility through `useTurboLiteFrame` |
| Frame preload | Supported | Fetches and validates without committing UI or history; later load reuses it |
| Nearest-Frame link/form targeting and `_top` | Supported | Named exact Frame targets also work |
| GET and URL-encoded POST forms | Supported | Ordered/repeated entries plus form-local pending and immutable submission state via hooks |
| Same-request Stream siblings | Supported | Document, link, Frame, or form response |
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
| Page snapshots, page prefetch, scroll/focus restoration | Not supported | Native host responsibility |
| Expo Router, React Query, Expo | Not required | Host adapters only |
