import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const forbidden = ["expo-turbo", "noscrubs", "@acme/"];
const dependencyNames = Object.keys({
  ...manifest.dependencies,
  ...manifest.optionalDependencies,
  ...manifest.peerDependencies,
});
for (const name of dependencyNames) {
  if (forbidden.some((needle) => name.toLowerCase().includes(needle))) {
    throw new Error(`Forbidden package dependency: ${name}`);
  }
}

const packed = execFileSync(
  "bun",
  ["pm", "pack", "--dry-run", "--ignore-scripts"],
  { encoding: "utf8" },
);
const paths = Array.from(
  packed.matchAll(/^packed\s+\S+\s+(.+)$/gm),
  (match) => match[1],
);
for (const required of [
  "dist/expo-router.js",
  "dist/expo-router.d.ts",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/react-navigation.js",
  "dist/react-navigation.d.ts",
  "dist/react-router.js",
  "dist/react-router.d.ts",
  "README.md",
  "LICENSE",
  "package.json",
]) {
  if (!paths.includes(required))
    throw new Error(`Packed archive is missing ${required}`);
}
for (const path of paths) {
  if (/^(src|test|example|scripts)\//.test(path) || path === "goal.md") {
    throw new Error(`Development-only file leaked into package: ${path}`);
  }
}

const root = await import(new URL("../dist/index.js", import.meta.url));
for (const name of [
  "TurboLiteProvider",
  "TurboLiteRuntime",
  "TurboLiteScreen",
  "createComponentRenderer",
  "useTurboLiteFrame",
]) {
  if (!(name in root)) throw new Error(`Built entrypoint is missing ${name}`);
}
for (const [entrypoint, name] of [
  ["../dist/expo-router.js", "TurboLiteExpoRoute"],
  ["../dist/expo-router.js", "TurboLiteExpoIndexRoute"],
  ["../dist/react-navigation.js", "TurboLiteReactNavigationRoute"],
  ["../dist/react-router.js", "TurboLiteReactRouterRoute"],
]) {
  const source = readFileSync(new URL(entrypoint, import.meta.url), "utf8");
  if (!source.includes(`export function ${name}`)) {
    throw new Error(`Built entrypoint is missing ${name}`);
  }
}
const unpackedSize = packed.match(/^Unpacked size:\s+(.+)$/m)?.[1] ?? "unknown";
console.log(`package-content: ${paths.length} files, ${unpackedSize} unpacked`);
