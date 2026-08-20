import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createElement, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createComponentRenderer,
  TurboLiteProvider,
  TurboLiteScreen,
  UnknownElementError,
  useTurboLiteField,
  useTurboLiteForm,
  useTurboLiteLink,
} from "../src/index.js";
import { response } from "./helpers.js";

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
