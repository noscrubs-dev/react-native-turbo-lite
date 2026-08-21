# Native navigation handoff

Turbo Lite separates fetching a destination document from committing it to a
native route. This prevents a pushed document from replacing the cached source
screen before the native router creates the destination entry.

## Two safe adapter modes

The navigation adapter receives an optional opaque prepared document:

```ts
interface TurboLiteNavigationAdapter {
  push(url: string, preparedDocument?: TurboLitePreparedDocument): void
  replace(url: string, preparedDocument?: TurboLitePreparedDocument): void
}
```

An adapter may choose either mode:

1. **Exact handoff:** retain the value in memory on the exact new route entry
   and pass it to that entry's `TurboLiteScreen`. The destination performs no
   duplicate GET.
2. **Safe fallback:** ignore the second argument and push only the URL. The
   source remains correct and the destination performs one GET.

The fallback costs a request, but never guesses which screen owns a response.

## Exact-entry requirement

Route URLs are not route identities. A stack can contain two entries with the
same URL, redirects can change the destination URL, and two navigations can
overlap. Therefore:

- allocate or use one stable key for each native stack entry;
- store the prepared document only on that entry or in an in-memory store keyed
  by that entry;
- pass the original opaque object to `TurboLiteScreen`;
- remove the entry and its handoff together when the router pops it;
- never index prepared documents only by URL;
- never serialize, persist, deep-link, or send the prepared document over a
  native bridge.

An invalid or wrong-URL handoff emits a typed error and falls back to a GET.
Reloads, cold starts, new tabs, and deep links always fetch normally.

## Router capability boundary

Turbo Lite's base adapter works with Expo Router, React Navigation, React
Router, TanStack Router, and native navigation libraries because all can push a
URL. Exact response reuse is a stronger capability: the host integration must
bind in-memory data to the exact destination entry before that screen loads.

Use exact handoff when the app owns such an entry store, as the release example
does. For routers that expose only URL or serializable route parameters at the
integration point, use the safe fallback until the app has an entry-keyed
in-memory adapter. Do not put the opaque object in router params merely to avoid
the fallback GET.

On web, a same-process client navigation may use an application-owned memory
store plus the router's unique location key. Browser history serialization,
SSR, hydration, reload, and new-tab navigation cannot carry this object and
must fetch.

## Commit order

For a pushed document, the runtime:

1. fetches, redirects, parses, and validates the response;
2. leaves the source runtime unchanged;
3. calls `navigation.push(finalUrl, preparedDocument)`;
4. lets the destination `TurboLiteScreen` adopt that exact response.

Refresh uses `replace`, while Frame visits and Frame preloads never change
native history.
