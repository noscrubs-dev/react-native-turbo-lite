import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createComponentRenderer,
  type TurboLitePreparedDocument,
  TurboLiteProvider,
  TurboLiteScreen,
  UnknownElementError,
  useTurboLiteField,
  useTurboLiteForm,
  useTurboLiteFrame,
  useTurboLiteLink,
} from "../src/index.js";
import { deferred, response } from "./helpers.js";

function passthrough(type: string): ComponentType<Record<string, unknown>> {
  return function Passthrough({ children }) {
    return createElement(
      "div",
      { "data-native-type": type },
      children as ReactNode,
    );
  };
}

const Screen = passthrough("screen");
const List = passthrough("list");
afterEach(cleanup);
function Text({ accessibilityLabel, children }: Record<string, unknown>) {
  return createElement(
    "span",
    {
      "data-accessibility-label": accessibilityLabel,
      "data-native-type": "text",
    },
    children as ReactNode,
  );
}

describe("React root adapter integration", () => {
  it("renders a screen from only its URL and uses the one root component map", async () => {
    const push = vi.fn();
    const replace = vi.fn();
    const renderer = createComponentRenderer({ components: { Screen, Text } });
    const fetch = vi.fn(async () =>
      response(
        '<Screen><Text accessibilityLabel="title">Laundry</Text></Screen>',
      ),
    );
    render(
      <TurboLiteProvider
        baseUrl="https://app.test"
        fetch={fetch}
        navigation={{ push, replace }}
        renderer={renderer}
      >
        <TurboLiteScreen url="/cart" />
      </TurboLiteProvider>,
    );
    expect(
      (await screen.findByText("Laundry")).getAttribute(
        "data-accessibility-label",
      ),
    ).toBe("title");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("binds a prepared response to one pushed stack entry and preserves Back state", async () => {
    let sourceMounts = 0;
    function StatefulSource() {
      useEffect(() => {
        sourceMounts++;
      }, []);
      return <span>Source state</span>;
    }
    function LinkButton({ children }: { children?: ReactNode }) {
      const link = useTurboLiteLink();
      return (
        <button onClick={link.follow} type="button">
          {children}
        </button>
      );
    }
    const renderer = createComponentRenderer({
      components: {
        LinkButton: LinkButton as ComponentType<Record<string, unknown>>,
        Screen,
        StatefulSource,
        Text,
      },
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          '<Screen><Text>Preferences</Text><StatefulSource/><a href="/checkout"><LinkButton>Checkout</LinkButton></a></Screen>',
        ),
      )
      .mockResolvedValueOnce(
        response("<Screen><Text>Checkout</Text></Screen>"),
      );

    interface Entry {
      key: number;
      preparedDocument: TurboLitePreparedDocument | undefined;
      url: string;
    }
    function StackApp() {
      const nextKey = useRef(1);
      const [entries, setEntries] = useState<Entry[]>([
        {
          key: 0,
          preparedDocument: undefined,
          url: "https://app.test/preferences",
        },
      ]);
      const navigation = useMemo(
        () => ({
          push(url: string, preparedDocument?: TurboLitePreparedDocument) {
            const key = nextKey.current++;
            setEntries((current) => [
              ...current,
              { key, preparedDocument, url },
            ]);
          },
          replace(url: string, preparedDocument?: TurboLitePreparedDocument) {
            const key = nextKey.current++;
            setEntries((current) => [
              ...current.slice(0, -1),
              { key, preparedDocument, url },
            ]);
          },
        }),
        [],
      );
      return (
        <TurboLiteProvider
          baseUrl="https://app.test"
          fetch={fetch}
          navigation={navigation}
          renderer={renderer}
        >
          <button
            disabled={entries.length === 1}
            onClick={() => setEntries((current) => current.slice(0, -1))}
            type="button"
          >
            Back
          </button>
          {entries.map((entry, index) => (
            <div
              data-testid={`entry-${entry.key}`}
              hidden={index !== entries.length - 1}
              key={entry.key}
            >
              <TurboLiteScreen
                {...(entry.preparedDocument === undefined
                  ? {}
                  : { preparedDocument: entry.preparedDocument })}
                url={entry.url}
              />
            </div>
          ))}
        </TurboLiteProvider>
      );
    }

    render(<StackApp />);
    const sourceEntry = screen.getByTestId("entry-0");
    fireEvent.click(await within(sourceEntry).findByText("Checkout"));
    const destinationEntry = await screen.findByTestId("entry-1");
    expect(within(destinationEntry).getByText("Checkout")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sourceMounts).toBe(1);

    fireEvent.click(screen.getByText("Back"));
    await waitFor(() => expect(screen.queryByTestId("entry-1")).toBeNull());
    expect(within(sourceEntry).getByText("Preferences")).toBeTruthy();
    expect(within(sourceEntry).getByText("Source state")).toBeTruthy();
    expect(sourceMounts).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("lets a native Frame boundary preload before it commits lazy content", async () => {
    function FrameControls() {
      const frame = useTurboLiteFrame();
      return (
        <div>
          <span>{frame.state}</span>
          <button onClick={() => void frame.preload()} type="button">
            Preload
          </button>
          <button onClick={() => void frame.load()} type="button">
            Load
          </button>
        </div>
      );
    }
    const renderer = createComponentRenderer({
      components: { FrameControls, Screen, Text },
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          '<Screen><turbo-frame id="panel" src="/panel" loading="lazy"><Text>Placeholder</Text><FrameControls/></turbo-frame></Screen>',
        ),
      )
      .mockResolvedValueOnce(
        response(
          '<Screen><turbo-frame id="panel"><Text>Prepared content</Text></turbo-frame></Screen>',
        ),
      );
    render(
      <TurboLiteProvider
        baseUrl="https://app.test"
        fetch={fetch}
        renderer={renderer}
      >
        <TurboLiteScreen url="/frames" />
      </TurboLiteProvider>,
    );
    fireEvent.click(await screen.findByText("Preload"));
    expect(await screen.findByText("preloaded")).toBeTruthy();
    expect(screen.getByText("Placeholder")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText("Load"));
    expect(await screen.findByText("Prepared content")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("renders unknown parent children and reports a typed path once per revision", async () => {
    const errors: UnknownElementError[] = [];
    const renderer = createComponentRenderer({ components: { Screen, Text } });
    render(
      <TurboLiteProvider
        baseUrl="https://app.test"
        fetch={async () =>
          response(
            "<Screen><FutureCard><Text>Still visible</Text></FutureCard></Screen>",
          )
        }
        onError={(error) => {
          if (error instanceof UnknownElementError) errors.push(error);
        }}
        renderer={renderer}
      >
        <TurboLiteScreen url="/future" />
      </TurboLiteProvider>,
    );
    expect(await screen.findByText("Still visible")).toBeTruthy();
    await waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toMatchObject({
      code: "unknown-element",
      path: "$.children[0]",
      tag: "future-card",
      url: "https://app.test/future",
    });
  });

  it("renders nothing for an unknown leaf and still reports it", async () => {
    const errors: UnknownElementError[] = [];
    const renderer = createComponentRenderer({ components: { Screen, Text } });
    render(
      <TurboLiteProvider
        baseUrl="https://app.test"
        fetch={async () =>
          response("<Screen><Text>Visible</Text><FutureLeaf /></Screen>")
        }
        onError={(error) => {
          if (error instanceof UnknownElementError) errors.push(error);
        }}
        renderer={renderer}
      >
        <TurboLiteScreen url="/future" />
      </TurboLiteProvider>,
    );
    expect(await screen.findByText("Visible")).toBeTruthy();
    await waitFor(() => expect(errors).toHaveLength(1));
    expect(document.body.textContent).toBe("Visible");
    expect(errors[0]?.tag).toBe("future-leaf");
  });

  it("targets the nearest Frame by default and honors _top", async () => {
    function LinkButton({ children }: { children?: ReactNode }) {
      const link = useTurboLiteLink();
      return (
        <button onClick={link.follow} type="button">
          {children}
        </button>
      );
    }
    const renderer = createComponentRenderer({
      components: {
        LinkButton: LinkButton as ComponentType<Record<string, unknown>>,
        Screen,
        Text,
      },
    });
    const calls: RequestInit[] = [];
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init);
      if (calls.length === 1) {
        return response(
          '<Screen><turbo-frame id="panel"><a href="/frame"><LinkButton>Frame link</LinkButton></a><a href="/full" data-turbo-frame="_top"><LinkButton>Full link</LinkButton></a></turbo-frame></Screen>',
        );
      }
      if (calls.length === 2) {
        return response(
          '<Screen><turbo-frame id="panel"><Text>Frame result</Text><a href="/full" data-turbo-frame="_top"><LinkButton>Full link</LinkButton></a></turbo-frame></Screen>',
        );
      }
      return response("<Screen><Text>Full result</Text></Screen>");
    });
    render(
      <TurboLiteProvider
        baseUrl="https://app.test"
        fetch={fetch}
        renderer={renderer}
      >
        <TurboLiteScreen url="/cart" />
      </TurboLiteProvider>,
    );
    fireEvent.click(await screen.findByText("Frame link"));
    expect(await screen.findByText("Frame result")).toBeTruthy();
    expect(new Headers(calls[1]?.headers).get("Turbo-Frame")).toBe("panel");
    fireEvent.click(screen.getByText("Full link"));
    expect(await screen.findByText("Full result")).toBeTruthy();
    expect(new Headers(calls[2]?.headers).get("Turbo-Frame")).toBeNull();
  });

  it("follows markup links and does not remount untouched stateful components", async () => {
    let mounts = 0;
    function Stateful() {
      useEffect(() => {
        mounts++;
      }, []);
      return <div data-native-type="stateful">State</div>;
    }
    function LinkButton({ children }: { children?: ReactNode }) {
      const link = useTurboLiteLink();
      return (
        <button disabled={link.pending} onClick={link.follow} type="button">
          {children}
        </button>
      );
    }
    const renderer = createComponentRenderer({
      components: {
        LinkButton: LinkButton as ComponentType<Record<string, unknown>>,
        List,
        Screen,
        Stateful,
      },
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          '<Screen><Stateful id="stable"/><List id="list">Old</List><a href="/change"><LinkButton>Change</LinkButton></a></Screen>',
        ),
      )
      .mockResolvedValueOnce(
        response(
          '<turbo-stream action="update" target="list"><template><List>New</List></template></turbo-stream>',
          { contentType: "text/vnd.turbo-stream.html" },
        ),
      );
    render(
      <TurboLiteProvider
        baseUrl="https://app.test"
        fetch={fetch}
        renderer={renderer}
      >
        <TurboLiteScreen url="/cart" />
      </TurboLiteProvider>,
    );
    await screen.findByText("Change");
    expect(mounts).toBe(1);
    fireEvent.click(screen.getByText("Change"));
    expect(await screen.findByText("New")).toBeTruthy();
    expect(mounts).toBe(1);
  });

  it("lets native fields provide ordered values through form hooks", async () => {
    function NativeInput({ name }: { name: string }) {
      const field = useTurboLiteField(name);
      return (
        <input
          aria-label={name}
          onChange={(event) => field.setValue(event.currentTarget.value)}
          value={field.value}
        />
      );
    }
    function NativeSubmit() {
      const form = useTurboLiteForm();
      return (
        <button disabled={form.pending} onClick={form.submit} type="button">
          Submit
        </button>
      );
    }
    const renderer = createComponentRenderer({
      components: {
        NativeInput: NativeInput as ComponentType<Record<string, unknown>>,
        NativeSubmit,
        Screen,
        Text,
      },
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          '<Screen><form action="/orders" method="post"><NativeInput name="item"/><NativeInput name="item"/><NativeSubmit/></form></Screen>',
        ),
      )
      .mockResolvedValueOnce(
        response("<Screen><Text>Saved</Text></Screen>", { status: 422 }),
      );
    render(
      <TurboLiteProvider
        baseUrl="https://app.test"
        fetch={fetch}
        renderer={renderer}
      >
        <TurboLiteScreen url="/form" />
      </TurboLiteProvider>,
    );
    const inputs = await screen.findAllByLabelText("item");
    fireEvent.change(inputs[0] as HTMLInputElement, {
      target: { value: "shirt" },
    });
    fireEvent.change(inputs[1] as HTMLInputElement, {
      target: { value: "pants" },
    });
    fireEvent.click(screen.getByText("Submit"));
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1].body).toBe("item=shirt&item=pants");
  });

  it("keeps pending and immutable submission values local to one form", async () => {
    let observedSubmission: ReturnType<typeof useTurboLiteForm>["submission"];
    function NativeInput({ label, name }: { label: string; name: string }) {
      const field = useTurboLiteField(name);
      return (
        <input
          aria-label={label}
          onChange={(event) => field.setValue(event.currentTarget.value)}
          value={field.value}
        />
      );
    }
    function NativeSubmit({ id, label }: { id: string; label: string }) {
      const form = useTurboLiteForm();
      if (id === "a") observedSubmission = form.submission;
      const entries = form.submission?.entries
        .map(([name, value]) => `${name}=${value}`)
        .join("&");
      return (
        <div>
          <button onClick={form.submit} type="button">
            {label}
          </button>
          <span data-testid={`form-${id}`}>
            {form.pending
              ? `${form.submission?.method}:${form.submission?.action}:${entries}`
              : "idle"}
          </span>
        </div>
      );
    }
    function FrameControls() {
      const frame = useTurboLiteFrame();
      return (
        <button onClick={() => void frame.load()} type="button">
          Load panel
        </button>
      );
    }
    const formResponse = deferred<Response>();
    const frameResponse = deferred<Response>();
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/save-a")) return formResponse.promise;
      if (url.endsWith("/panel")) return frameResponse.promise;
      return response(
        '<Screen><form action="/save-a" method="post"><NativeInput name="item" label="Item A"/><NativeSubmit id="a" label="Submit A"/></form><form action="/save-b" method="post"><NativeInput name="item" label="Item B"/><NativeSubmit id="b" label="Submit B"/></form><turbo-frame id="panel" src="/panel" loading="lazy"><Text>Panel placeholder</Text><FrameControls/></turbo-frame><Text id="status">Ready</Text></Screen>',
      );
    });
    const renderer = createComponentRenderer({
      components: {
        FrameControls,
        NativeInput: NativeInput as ComponentType<Record<string, unknown>>,
        NativeSubmit: NativeSubmit as ComponentType<Record<string, unknown>>,
        Screen,
        Text,
      },
    });
    render(
      <TurboLiteProvider
        baseUrl="https://app.test"
        fetch={fetch}
        renderer={renderer}
      >
        <TurboLiteScreen url="/forms" />
      </TurboLiteProvider>,
    );

    const input = (await screen.findByLabelText("Item A")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "shirt" } });
    fireEvent.click(screen.getByText("Submit A"));
    await waitFor(() =>
      expect(screen.getByTestId("form-a").textContent).toBe(
        "post:/save-a:item=shirt",
      ),
    );
    expect(screen.getByTestId("form-b").textContent).toBe("idle");
    expect(Object.isFrozen(observedSubmission)).toBe(true);
    expect(Object.isFrozen(observedSubmission?.entries)).toBe(true);
    expect(Object.isFrozen(observedSubmission?.entries[0])).toBe(true);

    fireEvent.change(input, { target: { value: "pants" } });
    expect(screen.getByTestId("form-a").textContent).toBe(
      "post:/save-a:item=shirt",
    );
    fireEvent.click(screen.getByText("Load panel"));
    expect(screen.getByTestId("form-a").textContent).toBe(
      "post:/save-a:item=shirt",
    );
    expect(screen.getByTestId("form-b").textContent).toBe("idle");

    frameResponse.resolve(
      response(
        '<Screen><turbo-frame id="panel"><Text>Panel loaded</Text></turbo-frame></Screen>',
      ),
    );
    expect(await screen.findByText("Panel loaded")).toBeTruthy();
    expect(screen.getByTestId("form-a").textContent).toBe(
      "post:/save-a:item=shirt",
    );

    formResponse.resolve(
      response(
        '<turbo-stream action="update" target="status"><template><Text>Saved</Text></template></turbo-stream>',
        { contentType: "text/vnd.turbo-stream.html" },
      ),
    );
    expect(await screen.findByText("Saved")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("form-a").textContent).toBe("idle"),
    );
  });

  it("does not let an older cancelled submit clear a newer submission", async () => {
    function NativeInput({ name }: { name: string }) {
      const field = useTurboLiteField(name);
      return (
        <input
          aria-label={name}
          onChange={(event) => field.setValue(event.currentTarget.value)}
          value={field.value}
        />
      );
    }
    function NativeSubmit() {
      const form = useTurboLiteForm();
      return (
        <div>
          <button onClick={form.submit} type="button">
            Submit
          </button>
          <span data-testid="submission-value">
            {form.submission?.entries[0]?.[1] ?? "idle"}
          </span>
        </div>
      );
    }
    const first = deferred<Response>();
    const second = deferred<Response>();
    const errors: string[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          '<Screen><form action="/save" method="post"><NativeInput name="item"/><NativeSubmit/></form></Screen>',
        ),
      )
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const renderer = createComponentRenderer({
      components: {
        NativeInput: NativeInput as ComponentType<Record<string, unknown>>,
        NativeSubmit,
        Screen,
      },
    });
    render(
      <TurboLiteProvider
        baseUrl="https://app.test"
        fetch={fetch}
        onError={(error) => errors.push(error.code)}
        renderer={renderer}
      >
        <TurboLiteScreen url="/form" />
      </TurboLiteProvider>,
    );

    const input = (await screen.findByLabelText("item")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(screen.getByText("Submit"));
    await waitFor(() =>
      expect(screen.getByTestId("submission-value").textContent).toBe("first"),
    );
    fireEvent.change(input, { target: { value: "second" } });
    fireEvent.click(screen.getByText("Submit"));
    await waitFor(() =>
      expect(screen.getByTestId("submission-value").textContent).toBe("second"),
    );

    first.resolve(response("<Screen>stale</Screen>"));
    await Promise.resolve();
    expect(screen.getByTestId("submission-value").textContent).toBe("second");
    second.resolve(response("{}", { contentType: "application/json" }));
    await waitFor(() =>
      expect(screen.getByTestId("submission-value").textContent).toBe("idle"),
    );
    expect(errors).toContain("media-type");
  });

  it("reports unsupported form methods without sending a wrong request", async () => {
    function NativeSubmit() {
      const form = useTurboLiteForm();
      return (
        <button onClick={form.submit} type="button">
          Delete
        </button>
      );
    }
    const renderer = createComponentRenderer({
      components: { NativeSubmit, Screen },
    });
    const errors: string[] = [];
    const fetch = vi.fn(async () =>
      response(
        '<Screen><form action="/items" method="delete"><NativeSubmit/></form></Screen>',
      ),
    );
    render(
      <TurboLiteProvider
        baseUrl="https://app.test"
        fetch={fetch}
        onError={(error) => errors.push(error.message)}
        renderer={renderer}
      >
        <TurboLiteScreen url="/form" />
      </TurboLiteProvider>,
    );
    fireEvent.click(await screen.findByText("Delete"));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(errors).toEqual(["Unsupported Turbo Lite form method: delete"]);
  });
});
