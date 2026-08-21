# Release example

This Expo app exercises the public package entrypoint, not private runtime
files. It covers native history, links, eager and lazy Frames, Frame preloading,
GET and POST forms, ordered Streams, and unknown-wrapper diagnostics. It uses
the first-party Expo Router route component; the app contains no navigation
adapter or shadow history. The visible request counter proves one GET for a
pushed destination and no additional GET when Back restores the source route.

```sh
cd ..
bun run build
bun pm pack --ignore-scripts
cd example
bun install
bun run android
```

Protocol edge cases and failure races stay in the faster unit and React
integration suites. The Android Maestro flow covers the public package and
native runtime boundary on the release runner. Route documents are fetched
through `documentBasePath="/screens"`; the fixture rejects unprefixed route
document GETs while Frame and form endpoints remain unprefixed.
