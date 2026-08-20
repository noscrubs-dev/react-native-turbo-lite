import React, {
  type ComponentType,
  type ReactNode,
  useMemo,
  useState,
} from "react";
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  createComponentRenderer,
  TurboLiteProvider,
  TurboLiteScreen,
  useTurboLiteField,
  useTurboLiteForm,
  useTurboLiteFrame,
  useTurboLiteLink,
} from "react-native-turbo-lite";

function LinkButton({ children }: { children?: ReactNode }) {
  const { follow, pending } = useTurboLiteLink();
  return (
    <Button disabled={pending} onPress={follow} title={String(children)} />
  );
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

function Submit({ label }: { label: string }) {
  const { pending, submit } = useTurboLiteForm();
  return <Button disabled={pending} onPress={submit} title={label} />;
}

function FrameControls() {
  const frame = useTurboLiteFrame();
  return (
    <View style={styles.frameControls}>
      <Text accessibilityLabel="lazy-frame-state">lazy: {frame.state}</Text>
      <Button onPress={() => void frame.preload()} title="Preload lazy Frame" />
      <Button onPress={() => void frame.load()} title="Load lazy Frame" />
    </View>
  );
}

function Screen({ children }: { children?: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
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
      <a href="/details"><LinkButton>Open details</LinkButton></a>
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
        <Field name="q" placeholder="Search query"/><Submit label="Run GET form"/>
      </form>
      <form action="/items" method="post">
        <Field name="item" placeholder="Laundry item"/><Submit label="Run POST Stream"/>
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
  "/eager-summary": `
    <Screen><turbo-frame id="eager-summary"><Text>Eager Frame loaded</Text></turbo-frame></Screen>`,
  "/lazy-summary": `
    <Screen><turbo-frame id="lazy-summary"><Text>Lazy Frame loaded from preload</Text></turbo-frame></Screen>`,
};

async function demoFetch(input: string, init: RequestInit): Promise<Response> {
  const url = new URL(input);
  if (url.pathname === "/items" && init.method === "POST") {
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
  const [history, setHistory] = useState([initialUrl]);
  const [screenUrl, setScreenUrl] = useState(initialUrl);
  const [lastError, setLastError] = useState("none");
  const renderer = useMemo(() => createComponentRenderer({ components }), []);
  const navigation = useMemo(
    () => ({
      push(url: string) {
        setHistory((current) => [...current, url]);
        setScreenUrl(url);
      },
      replace(url: string) {
        setHistory((current) => [...current.slice(0, -1), url]);
        setScreenUrl(url);
      },
    }),
    [],
  );
  const goBack = () => {
    if (history.length <= 1) return;
    const next = history.slice(0, -1);
    setHistory(next);
    setScreenUrl(next.at(-1) ?? initialUrl);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.hostBar}>
        <Text accessibilityLabel="history-depth">
          Native history: {history.length}
        </Text>
        <Button disabled={history.length <= 1} onPress={goBack} title="Back" />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TurboLiteProvider
          baseUrl={initialUrl}
          fetch={demoFetch}
          navigation={navigation}
          onError={(error) => setLastError(error.code)}
          renderer={renderer}
        >
          <TurboLiteScreen url={screenUrl} />
        </TurboLiteProvider>
        <Text accessibilityLabel="last-error">Last error: {lastError}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  frameControls: { gap: 6 },
  hostBar: {
    alignItems: "center",
    borderBottomColor: "#d5d9e2",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 12,
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
  safeArea: { backgroundColor: "white", flex: 1 },
  screen: { gap: 12 },
  scroll: { gap: 16, padding: 16 },
  title: { fontSize: 24, fontWeight: "700" },
});
