import { Stack } from "expo-router";
import React, {
  type ComponentType,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import {
  Button,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  createComponentRenderer,
  TurboLiteProvider,
  useTurboLiteField,
  useTurboLiteForm,
  useTurboLiteFrame,
  useTurboLiteLink,
} from "react-native-turbo-lite";

function LinkButton({ label }: { label: string }) {
  const { follow, pending } = useTurboLiteLink();
  return <Button disabled={pending} onPress={follow} title={label} />;
}

function Field({ name, placeholder }: { name: string; placeholder?: string }) {
  const field = useTurboLiteField(name);
  return (
    <TextInput
      accessibilityLabel={placeholder ?? name}
      onChangeText={field.setValue}
      placeholder={placeholder}
      style={styles.input}
      value={field.value}
    />
  );
}

function Submit({ label, stateId }: { label: string; stateId: string }) {
  const { pending, submission, submit } = useTurboLiteForm();
  const state = pending
    ? `Submitting ${submission?.entries
        .map(([name, value]) => `${name}=${value}`)
        .join("&")}`
    : "Form idle";
  return (
    <View>
      <Button disabled={pending} onPress={submit} title={label} />
      <Text
        accessibilityLabel={state}
        testID={`${stateId}-${pending ? "pending" : "idle"}`}
      >
        {state}
      </Text>
    </View>
  );
}

function FrameControls() {
  const frame = useTurboLiteFrame();
  const stateLabel = `lazy: ${frame.state}`;
  return (
    <View style={styles.frameControls}>
      <Text
        accessibilityLabel={stateLabel}
        testID={`lazy-frame-${frame.state}`}
      >
        {stateLabel}
      </Text>
      <Button onPress={() => void frame.preload()} title="Preload lazy Frame" />
      <Button onPress={() => void frame.load()} title="Load lazy Frame" />
    </View>
  );
}

function Screen({ children }: { children?: ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.screen}>{children}</ScrollView>
  );
}

function Title({ children }: { children?: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

function Panel({ children }: { children?: ReactNode }) {
  return <View style={styles.panel}>{children}</View>;
}

const documents: Record<string, string> = {
  "/": `
    <Screen>
      <Title>Turbo Lite release example</Title>
      <Text>Home document</Text>
      <a href="/details"><LinkButton label="Open details" /></a>
      <Panel>
        <Text>Eager Frame</Text>
        <turbo-frame id="eager-summary" src="/eager-summary"><Text>Eager placeholder</Text></turbo-frame>
      </Panel>
      <Panel>
        <Text>Lazy Frame</Text>
        <turbo-frame id="lazy-summary" src="/lazy-summary" loading="lazy">
          <Text>Lazy placeholder</Text><FrameControls />
        </turbo-frame>
      </Panel>
      <form action="/search" method="get">
        <Field name="q" placeholder="Search query"/><Submit label="Run GET form" stateId="get-form"/>
      </form>
      <form action="/items" method="post">
        <Field name="item" placeholder="Laundry item"/><Submit label="Run POST Stream" stateId="post-form"/>
      </form>
      <form action="/orders" method="post">
        <Field name="note" placeholder="Order note"/><Submit label="Create order" stateId="visit-form"/>
      </form>
      <Text id="status">Ready</Text>
      <Panel id="items"><Text>Shirts</Text></Panel>
      <FuturePanel><Text>Unknown wrappers keep their children.</Text></FuturePanel>
    </Screen>`,
  "/details": `
    <Screen>
      <Title>Details document</Title>
      <Text>A normal Turbo visit pushed one native history entry.</Text>
    </Screen>`,
  "/search": `
    <Screen>
      <Title>GET form result</Title>
      <Text>The query value was encoded in the request URL.</Text>
    </Screen>`,
  "/orders/42": `
    <Screen>
      <Title>Order 42</Title>
      <Text>The visit directive pushed this route, which performed one GET.</Text>
    </Screen>`,
  "/eager-summary": `
    <Screen><turbo-frame id="eager-summary"><Text>Eager Frame loaded</Text></turbo-frame></Screen>`,
  "/lazy-summary": `
    <Screen><turbo-frame id="lazy-summary"><Text>Lazy Frame loaded from preload</Text></turbo-frame></Screen>`,
};

async function demoFetch(input: string, init: RequestInit): Promise<Response> {
  const url = new URL(input);
  if (url.pathname === "/orders" && init.method === "POST") {
    return new Response(JSON.stringify({ location: "/orders/42" }), {
      headers: {
        "Content-Type": "application/vnd.turbo-lite.visit+json",
      },
    });
  }
  if (url.pathname === "/items" && init.method === "POST") {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    return new Response(
      '<turbo-stream action="replace" target="status"><template><Text id="status">Saved by Stream</Text></template></turbo-stream>' +
        '<turbo-stream action="append" target="items"><template><Text id="new-item">Towels</Text></template></turbo-stream>',
      { headers: { "Content-Type": "text/vnd.turbo-stream.html" } },
    );
  }
  const body = documents[url.pathname] ?? documents["/details"];
  return new Response(body, { headers: { "Content-Type": "text/html" } });
}

const components = {
  Field,
  FrameControls,
  LinkButton,
  Panel,
  Screen,
  Submit,
  Text,
  Title,
} as unknown as Record<string, ComponentType<Record<string, unknown>>>;

export default function App() {
  const initialUrl = "https://example.test/";
  const [lastError, setLastError] = useState("none");
  const [requestCount, setRequestCount] = useState(0);
  const trackedFetch = useCallback(async (input: string, init: RequestInit) => {
    setRequestCount((current) => current + 1);
    return demoFetch(input, init);
  }, []);
  const handleError = useCallback(
    (error: { code: string }) => setLastError(error.code),
    [],
  );
  const renderer = useMemo(() => createComponentRenderer({ components }), []);
  const errorLabel = `Last error: ${lastError}`;
  const requestLabel = `Requests: ${requestCount}`;

  return (
    <TurboLiteProvider
      baseUrl={initialUrl}
      fetch={trackedFetch}
      onError={handleError}
      renderer={renderer}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.hostBar}>
          <Text
            accessibilityLabel={requestLabel}
            testID={`request-count-${requestCount}`}
          >
            {requestLabel}
          </Text>
        </View>
        <View style={styles.router}>
          <Stack screenOptions={{ headerBackTitle: "Back" }} />
        </View>
        <Text
          accessibilityLabel={errorLabel}
          testID={`last-error-${lastError}`}
        >
          {errorLabel}
        </Text>
      </SafeAreaView>
    </TurboLiteProvider>
  );
}

const styles = StyleSheet.create({
  frameControls: { gap: 6 },
  hostBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  input: {
    borderColor: "#9098a8",
    borderRadius: 8,
    borderWidth: 1,
    marginVertical: 6,
    padding: 10,
  },
  panel: {
    backgroundColor: "#f2f5fa",
    borderRadius: 10,
    gap: 6,
    padding: 12,
  },
  safeArea: {
    backgroundColor: "white",
    flex: 1,
    paddingTop: StatusBar.currentHeight ?? 0,
  },
  router: { flex: 1 },
  screen: { gap: 12, padding: 16 },
  title: { fontSize: 24, fontWeight: "700" },
});
