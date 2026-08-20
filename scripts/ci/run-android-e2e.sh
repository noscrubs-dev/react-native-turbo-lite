#!/usr/bin/env bash

set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "Android E2E must not run as root." >&2
  exit 1
fi
if [ ! -r /dev/kvm ] || [ ! -w /dev/kvm ]; then
  echo "Android E2E requires read/write access to /dev/kvm." >&2
  exit 1
fi

export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

readonly adb_serial="emulator-5580"
readonly avd_name="expo-turbo-api35"
readonly artifacts="$PWD/artifacts/android-device"
readonly npm_version="11.5.2"
mkdir -p "$artifacts"

emulator_pid=""
cleanup() {
  local status=$?
  trap - EXIT
  timeout 15 adb -s "$adb_serial" logcat -d >"$artifacts/logcat.txt" 2>&1 || true
  timeout 15 adb -s "$adb_serial" emu kill >/dev/null 2>&1 || true
  if [ -n "$emulator_pid" ]; then
    kill "$emulator_pid" >/dev/null 2>&1 || true
    wait "$emulator_pid" >/dev/null 2>&1 || true
  fi
  {
    echo "exit_status=$status"
    echo "commit=$(git rev-parse HEAD)"
    echo "runner=$(hostname)"
    echo "bun=$(bun --version)"
    echo "npm=$(bun x --package npm@${npm_version} npm --version)"
    echo "java=$(java -version 2>&1 | sed -n '1p')"
    echo "maestro=$(scripts/ci/check-maestro-version.sh)"
  } >"$artifacts/environment.txt" 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

scripts/ci/check-maestro-version.sh
bun x --package "npm@${npm_version}" npm ci --no-audit
bun x --package "npm@${npm_version}" npm run build
bun x --package "npm@${npm_version}" npm pack --ignore-scripts

(
  cd example
  bun x --package "npm@${npm_version}" npm install \
    ../react-native-turbo-lite-0.1.0.tgz \
    --save-exact \
    --package-lock-only \
    --force \
    --ignore-scripts \
    --no-audit
  bun x --package "npm@${npm_version}" npm ci --ignore-scripts --no-audit
  NODE_ENV=production bun x expo prebuild --platform android --no-install --clean
  cd android
  NODE_ENV=production \
    ./gradlew --no-daemon -PreactNativeArchitectures=x86_64 app:assembleRelease
)

readonly apk="$PWD/example/android/app/build/outputs/apk/release/app-release.apk"
test -f "$apk"

adb kill-server >/dev/null 2>&1 || true
if adb -s "$adb_serial" get-state >/dev/null 2>&1; then
  adb -s "$adb_serial" emu kill >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    if ! adb -s "$adb_serial" get-state >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi

"$ANDROID_HOME/emulator/emulator" \
  -avd "$avd_name" \
  -port 5580 \
  -no-window \
  -no-audio \
  -no-boot-anim \
  -no-metrics \
  -no-snapshot \
  -wipe-data \
  -gpu swiftshader_indirect \
  -accel on >"$artifacts/emulator.log" 2>&1 &
emulator_pid=$!

timeout 180 adb -s "$adb_serial" wait-for-device
for _ in $(seq 1 120); do
  if [ "$(timeout 5 adb -s "$adb_serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
    break
  fi
  sleep 2
done
test "$(timeout 5 adb -s "$adb_serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1"
sleep 10

timeout 120 adb -s "$adb_serial" install -r "$apk" >"$artifacts/install.log" 2>&1
adb -s "$adb_serial" wait-for-device
sleep 5
adb -s "$adb_serial" logcat -c
maestro --device "$adb_serial" test \
  --format junit \
  --output "$artifacts/maestro-junit.xml" \
  --test-output-dir "$artifacts/maestro-output" \
  .maestro/release.yml | tee "$artifacts/maestro.log"
