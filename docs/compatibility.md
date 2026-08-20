# Turbo compatibility matrix

This is the intentional `0.1` boundary. “Supported” means covered by automated
tests in this repository.

| Turbo behavior | 0.1 | Notes |
| --- | --- | --- |
| Document GETs, redirects, 204, 422, valid error documents | Supported | Host owns URL/navigation UI |
| Relative and absolute same-origin links | Supported | Cross-origin visits are rejected |
| Request cancellation and latest-request-wins | Supported | Stale/cancelled work cannot commit |
| Eager Frames and `Turbo-Frame` request header | Supported | Exact matching Frame only |
| Nearest-Frame link/form targeting and `_top` | Supported | Named exact Frame targets also work |
| GET and URL-encoded POST forms | Supported | Ordered/repeated entries via hooks |
| Same-request Stream siblings | Supported | Document, link, Frame, or form response |
| `append`, `prepend`, `replace`, `update`, `remove`, `before`, `after`, `refresh` | Supported | Exact ID only; source order |
| Direct-child ID collision behavior | Supported | Existing matching direct child is replaced |
| Missing Stream target | Supported no-op | Emits a typed diagnostic |
| Unknown native wrapper | Supported fallback | Children render; typed error once/revision |
| Lazy Frames, recurse, Frame history, preload | Not supported | Deliberately outside 0.1 |
| Files, multipart, camera/payment values | Not supported | Native host responsibility |
| CSS targets/selectors and custom Stream actions | Not supported | Exact IDs only |
| Morphing and permanent elements | Not supported | Replacement only |
| Action Cable, WebSockets, subscriptions | Not supported | Same-request Streams only |
| Browser DOM/events, scripts, HTML repair | Not supported | Hardened small node parser |
| Snapshots, prefetch, scroll/focus restoration | Not supported | Native host responsibility |
| Expo Router, React Query, Expo | Not required | Host adapters only |
