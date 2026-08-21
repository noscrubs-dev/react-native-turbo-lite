# Release example

This Expo app exercises the public package entrypoint, not private runtime
files. It covers native history, links, eager and lazy Frames, Frame preloading,
GET and POST forms, ordered Streams, and unknown-wrapper diagnostics. Each
history entry retains its own mounted `TurboLiteScreen`; pushed responses are
handed directly to the exact new entry, so Back restores the untouched source
screen without a duplicate destination GET. The visible request counter lets
the device flow prove that both the destination render and Back add no request.

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
native runtime boundary on the release runner.
