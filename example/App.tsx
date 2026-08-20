import React, { type ComponentType, useMemo } from "react";
import { Button, Text, TextInput, View } from "react-native";
import {
  createComponentRenderer,
  TurboLiteProvider,
  TurboLiteScreen,
  useTurboLiteField,
  useTurboLiteForm,
  useTurboLiteLink,
} from "../src/index.js";

function LinkButton({ children }: { children?: React.ReactNode }) {
  const { follow, pending } = useTurboLiteLink();
  return (
    <Button disabled={pending} onPress={follow} title={String(children)} />
  );
}

function Field({ name, placeholder }: { name: string; placeholder?: string }) {
  const field = useTurboLiteField(name);
  return (
    <TextInput
      onChangeText={field.setValue}
      placeholder={placeholder}
      value={field.value}
    />
  );
}

function Submit({ label }: { label: string }) {
  const { pending, submit } = useTurboLiteForm();
  return <Button disabled={pending} onPress={submit} title={label} />;
}

const documents: Record<string, string> = {
  "/": `
    <Screen>
      <Title>Turbo Lite cart</Title>
      <a href="/details"><LinkButton>Open details</LinkButton></a>
      <turbo-frame id="summary" src="/summary"><Text>Loading summary…</Text></turbo-frame>
      <form action="/search" method="get">
        <Field name="q" placeholder="Search"/><Submit label="Search"/>
      </form>
      <form action="/items" method="post">
        <Field name="item" placeholder="Laundry item"/><Submit label="Add item"/>
      </form>
      <Status id="status">Ready</Status>
      <List id="items"><Text id="first-item">Shirts</Text></List>
      <FuturePanel><Text>Unknown wrappers keep visible children.</Text></FuturePanel>
    </Screen>`,
  "/details":
    "<Screen><Title>Details document</Title><Text>Host-owned navigation remains native.</Text></Screen>",
  "/search":
    "<Screen><Title>GET form result</Title><Text>Query values are in the request URL.</Text></Screen>",
  "/summary":
    '<Screen><turbo-frame id="summary"><Text>2 items · $18</Text></turbo-frame></Screen>',
};

async function demoFetch(input: string, init: RequestInit): Promise<Response> {
  const url = new URL(input);
  if (url.pathname === "/items" && init.method === "POST") {
    return new Response(
      '<turbo-stream action="replace" target="status"><template><Status id="status">Saved</Status></template></turbo-stream>' +
        '<turbo-stream action="append" target="items"><template><Text id="new-item">Towels</Text></template></turbo-stream>',
      { headers: { "Content-Type": "text/vnd.turbo-stream.html" } },
    );
  }
  return new Response(documents[url.pathname] ?? documents["/details"], {
    headers: { "Content-Type": "text/html" },
  });
}

export default function App() {
  const renderer = useMemo(
    () =>
      createComponentRenderer({
        components: {
          Field,
          LinkButton,
          List: View,
          Screen: View,
          Status: Text,
          Submit,
          Text,
          Title: Text,
        } as unknown as Record<string, ComponentType<Record<string, unknown>>>,
      }),
    [],
  );
  return (
    <TurboLiteProvider
      baseUrl="https://example.test"
      fetch={demoFetch}
      onError={(error) => console.warn(error)}
      renderer={renderer}
    >
      <TurboLiteScreen url="/" />
    </TurboLiteProvider>
  );
}
