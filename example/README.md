# Release example

This Expo app exercises the public package entrypoint, not private runtime
files. It covers native history, links, eager and lazy Frames, Frame preloading,
GET and POST forms, ordered Streams, and unknown-wrapper diagnostics.

```sh
npm run build --prefix ..
npm pack --prefix .. --ignore-scripts
npm install
npm run android
```

Protocol edge cases and failure races stay in the faster unit and React
integration suites. The Android Maestro flow covers the public package and
native runtime boundary on the release runner.
