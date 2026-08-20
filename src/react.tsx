import {
  createContext,
  Fragment,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { TurboLiteError, UnknownElementError } from "./errors.js";
import { elementChildren, type InternalNode, isElement } from "./internal.js";
import { TurboLiteRuntime } from "./runtime.js";
import { normalizeTagName } from "./tags.js";
import type {
  FormEntry,
  TurboLiteErrorHandler,
  TurboLiteFrameController,
  TurboLiteProviderProps,
  TurboLiteRenderer,
  TurboLiteScreenProps,
} from "./types.js";

interface ProviderValue {
  baseUrl?: string;
  fetch: NonNullable<TurboLiteProviderProps["fetch"]>;
  limits?: TurboLiteProviderProps["limits"];
  navigation?: TurboLiteProviderProps["navigation"];
  onError?: TurboLiteErrorHandler;
  renderer: TurboLiteRenderer;
}

const ProviderContext = createContext<ProviderValue | undefined>(undefined);
const RuntimeContext = createContext<TurboLiteRuntime | undefined>(undefined);
const FrameContext = createContext<string | undefined>(undefined);

interface LinkValue {
  follow(): void;
  pending: boolean;
}

const LinkContext = createContext<LinkValue | undefined>(undefined);

class FormFields {
  readonly #fields = new Map<symbol, FormEntry>();

  register(name: string, value: string): symbol {
    const token = Symbol(name);
    this.#fields.set(token, [name, value]);
    return token;
  }

  update(token: symbol, name: string, value: string): void {
    this.#fields.set(token, [name, value]);
  }

  unregister(token: symbol): void {
    this.#fields.delete(token);
  }

  entries(): FormEntry[] {
    return [...this.#fields.values()];
  }
}

interface FormValue {
  fields: FormFields;
  pending: boolean;
  submit(): void;
}

const FormContext = createContext<FormValue | undefined>(undefined);

export function TurboLiteProvider({
  baseUrl,
  children,
  fetch: fetchAdapter,
  limits,
  navigation,
  onError,
  renderer,
}: TurboLiteProviderProps): ReactNode {
  const value = useMemo<ProviderValue>(() => {
    const runtimeFetch =
      fetchAdapter ??
      ((input: string, init: RequestInit) => globalThis.fetch(input, init));
    return {
      fetch: runtimeFetch,
      renderer,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(limits === undefined ? {} : { limits }),
      ...(navigation === undefined ? {} : { navigation }),
      ...(onError === undefined ? {} : { onError }),
    };
  }, [baseUrl, fetchAdapter, limits, navigation, onError, renderer]);
  return (
    <ProviderContext.Provider value={value}>
      {children}
    </ProviderContext.Provider>
  );
}

function useProvider(): ProviderValue {
  const value = useContext(ProviderContext);
  if (value === undefined) {
    throw new Error("Turbo Lite hooks and screens require TurboLiteProvider");
  }
  return value;
}

export function useTurboLiteRuntime(): TurboLiteRuntime {
  const runtime = useContext(RuntimeContext);
  if (runtime === undefined) {
    throw new Error("useTurboLiteRuntime requires TurboLiteScreen");
  }
  return runtime;
}

export function useTurboLiteFrame(): TurboLiteFrameController {
  const runtime = useContext(RuntimeContext);
  const frameId = useContext(FrameContext);
  if (runtime === undefined || frameId === undefined) {
    throw new Error("useTurboLiteFrame requires a <turbo-frame> ancestor");
  }
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const frame = snapshot.frames[frameId];
  if (frame === undefined) {
    throw new Error(`Turbo Lite Frame #${frameId} is no longer active`);
  }
  const load = useCallback(
    () => runtime.loadFrame(frameId),
    [frameId, runtime],
  );
  const preload = useCallback(
    () => runtime.preloadFrame(frameId),
    [frameId, runtime],
  );
  return { ...frame, load, preload };
}

export function TurboLiteScreen({ url }: TurboLiteScreenProps): ReactNode {
  const config = useProvider();
  const runtime = useMemo(
    () =>
      new TurboLiteRuntime({
        fetch: config.fetch,
        ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
        ...(config.limits === undefined ? {} : { limits: config.limits }),
        ...(config.navigation === undefined
          ? {}
          : { navigation: config.navigation }),
        ...(config.onError === undefined ? {} : { onError: config.onError }),
      }),
    [config],
  );
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );

  useEffect(() => {
    void runtime.visit(url, { history: "none" });
  }, [runtime, url]);
  useEffect(() => () => runtime.dispose(), [runtime]);

  return (
    <RuntimeContext.Provider value={runtime}>
      {snapshot.tree === undefined ? null : (
        <RenderNode
          node={snapshot.tree as InternalNode}
          path="$"
          renderer={config.renderer}
          report={config.onError}
          revision={snapshot.revision}
          runtime={runtime}
          url={snapshot.url || url}
        />
      )}
    </RuntimeContext.Provider>
  );
}

interface RenderProps {
  node: InternalNode;
  path: string;
  renderer: TurboLiteRenderer;
  report: TurboLiteErrorHandler | undefined;
  revision: number;
  runtime: TurboLiteRuntime;
  url: string;
}

function RenderNode(props: RenderProps): ReactNode {
  const { node } = props;
  if (!isElement(node)) return node;
  const tag = normalizeTagName(node.type);
  const children = elementChildren(node).map((child, index) => (
    <Fragment key={isElement(child) ? child.key : `${node.key}:text:${index}`}>
      <RenderNode
        {...props}
        node={child}
        path={`${props.path}.children[${index}]`}
      />
    </Fragment>
  ));

  switch (tag) {
    case "#fragment":
      return children;
    case "turbo-frame": {
      const id = node.props.id;
      return (
        <FrameContext.Provider value={typeof id === "string" ? id : undefined}>
          {children}
        </FrameContext.Provider>
      );
    }
    case "a":
      return (
        <LinkBoundary node={node} runtime={props.runtime}>
          {children}
        </LinkBoundary>
      );
    case "form":
      return (
        <FormBoundary
          node={node}
          report={props.report}
          runtime={props.runtime}
          url={props.url}
        >
          {children}
        </FormBoundary>
      );
    case "template":
    case "turbo-stream":
      return null;
  }

  if (!props.renderer.hasElement(tag)) {
    return (
      <UnknownBoundary
        nodeKey={node.key}
        path={props.path}
        report={props.report}
        revision={props.revision}
        tag={tag}
        url={props.url}
      >
        {children}
      </UnknownBoundary>
    );
  }
  return props.renderer.render(node, {
    children,
    key: node.key,
    path: props.path,
    url: props.url,
  });
}

function UnknownBoundary({
  children,
  nodeKey,
  path,
  report,
  revision,
  tag,
  url,
}: {
  children: ReactNode;
  nodeKey: string;
  path: string;
  report: TurboLiteErrorHandler | undefined;
  revision: number;
  tag: string;
  url: string;
}): ReactNode {
  useEffect(() => {
    report?.(new UnknownElementError(tag, path, url));
  }, [nodeKey, path, report, revision, tag, url]);
  return children;
}

function targetedFrame(
  explicit: unknown,
  nearest: string | undefined,
): string | undefined {
  if (explicit === "_top") return undefined;
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  return nearest;
}

function LinkBoundary({
  children,
  node,
  runtime,
}: {
  children: ReactNode;
  node: Extract<InternalNode, object>;
  runtime: TurboLiteRuntime;
}): ReactNode {
  const nearestFrame = useContext(FrameContext);
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const href = typeof node.props.href === "string" ? node.props.href : "";
  const frame = targetedFrame(
    node.props.target ?? node.props["data-turbo-frame"],
    nearestFrame,
  );
  const follow = useCallback(() => {
    if (href.length === 0) return;
    void runtime.visit(href, frame === undefined ? {} : { frame });
  }, [frame, href, runtime]);
  const value = useMemo(
    () => ({ follow, pending: snapshot.pending }),
    [follow, snapshot.pending],
  );
  return <LinkContext.Provider value={value}>{children}</LinkContext.Provider>;
}

export function useTurboLiteLink(): LinkValue {
  const value = useContext(LinkContext);
  if (value === undefined)
    throw new Error("useTurboLiteLink requires an <a> ancestor");
  return value;
}

function FormBoundary({
  children,
  node,
  report,
  runtime,
  url,
}: {
  children: ReactNode;
  node: Extract<InternalNode, object>;
  report: TurboLiteErrorHandler | undefined;
  runtime: TurboLiteRuntime;
  url: string;
}): ReactNode {
  const nearestFrame = useContext(FrameContext);
  const [fields] = useState(() => new FormFields());
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const action = typeof node.props.action === "string" ? node.props.action : "";
  const rawMethod =
    typeof node.props.method === "string"
      ? node.props.method.toLowerCase()
      : "get";
  const method = rawMethod === "post" ? "post" : "get";
  const enctype =
    typeof node.props.enctype === "string"
      ? node.props.enctype.toLowerCase()
      : undefined;
  const frame = targetedFrame(
    node.props.target ?? node.props["data-turbo-frame"],
    nearestFrame,
  );
  const submit = useCallback(() => {
    if (rawMethod !== "get" && rawMethod !== "post") {
      report?.(
        new TurboLiteError(
          "http",
          `Unsupported Turbo Lite form method: ${rawMethod}`,
          { url },
        ),
      );
      return;
    }
    if (
      enctype !== undefined &&
      enctype !== "application/x-www-form-urlencoded"
    ) {
      report?.(
        new TurboLiteError(
          "http",
          `Unsupported Turbo Lite form encoding: ${enctype}`,
          { url },
        ),
      );
      return;
    }
    void runtime.submit({
      action,
      entries: fields.entries(),
      method,
      ...(frame === undefined ? {} : { frame }),
    });
  }, [action, enctype, fields, frame, method, rawMethod, report, runtime, url]);
  const value = useMemo(
    () => ({ fields, pending: snapshot.pending, submit }),
    [fields, snapshot.pending, submit],
  );
  return <FormContext.Provider value={value}>{children}</FormContext.Provider>;
}

export function useTurboLiteField(
  name: string,
  initialValue = "",
): { setValue(value: string | number | boolean): void; value: string } {
  const form = useContext(FormContext);
  if (form === undefined) {
    throw new Error("useTurboLiteField requires a <form> ancestor");
  }
  const [value, setState] = useState(String(initialValue));
  const token = useRef<symbol | undefined>(undefined);
  useEffect(() => {
    const registered = form.fields.register(name, value);
    token.current = registered;
    return () => form.fields.unregister(registered);
  }, [form.fields, name]);
  useEffect(() => {
    if (token.current !== undefined)
      form.fields.update(token.current, name, value);
  }, [form.fields, name, value]);
  const setValue = useCallback((next: string | number | boolean) => {
    setState(String(next));
  }, []);
  return { setValue, value };
}

export function useTurboLiteForm(): Pick<FormValue, "pending" | "submit"> {
  const value = useContext(FormContext);
  if (value === undefined)
    throw new Error("useTurboLiteForm requires a <form> ancestor");
  return { pending: value.pending, submit: value.submit };
}
