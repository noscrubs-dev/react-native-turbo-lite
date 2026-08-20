export type TurboLiteErrorCode =
  | "duplicate-id"
  | "frame-missing"
  | "http"
  | "media-type"
  | "network"
  | "parse"
  | "safety-limit"
  | "stream"
  | "tag-collision"
  | "unknown-element";

export class TurboLiteError extends Error {
  readonly code: TurboLiteErrorCode;
  readonly url?: string;

  constructor(
    code: TurboLiteErrorCode,
    message: string,
    options: { cause?: unknown; url?: string | undefined } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "TurboLiteError";
    this.code = code;
    if (options.url !== undefined) this.url = options.url;
  }
}

export class ParseError extends TurboLiteError {
  constructor(
    message: string,
    options: { cause?: unknown; url?: string | undefined } = {},
  ) {
    super("parse", message, options);
    this.name = "ParseError";
  }
}

export class SafetyLimitError extends TurboLiteError {
  readonly limit: string;

  constructor(limit: string, message: string, url?: string) {
    super("safety-limit", message, url === undefined ? {} : { url });
    this.name = "SafetyLimitError";
    this.limit = limit;
  }
}

export class DuplicateIdError extends TurboLiteError {
  readonly id: string;

  constructor(id: string, url?: string) {
    super(
      "duplicate-id",
      `Duplicate active id \"${id}\" would make exact-target updates ambiguous`,
      url === undefined ? {} : { url },
    );
    this.name = "DuplicateIdError";
    this.id = id;
  }
}

export class FrameMissingError extends TurboLiteError {
  readonly frame: string;

  constructor(frame: string, url?: string) {
    super(
      "frame-missing",
      `Response did not contain the requested turbo-frame#${frame}`,
      url === undefined ? {} : { url },
    );
    this.name = "FrameMissingError";
    this.frame = frame;
  }
}

export class StreamError extends TurboLiteError {
  readonly action?: string;
  readonly target?: string;

  constructor(
    message: string,
    options: {
      action?: string | undefined;
      cause?: unknown;
      target?: string | undefined;
      url?: string | undefined;
    } = {},
  ) {
    super("stream", message, options);
    this.name = "StreamError";
    if (options.action !== undefined) this.action = options.action;
    if (options.target !== undefined) this.target = options.target;
  }
}

export class UnknownElementError extends TurboLiteError {
  readonly tag: string;
  readonly path: string;

  constructor(tag: string, path: string, url: string) {
    super("unknown-element", `Unknown native element <${tag}> at ${path}`, {
      url,
    });
    this.name = "UnknownElementError";
    this.tag = tag;
    this.path = path;
  }
}

export class TagCollisionError extends TurboLiteError {
  constructor(first: string, second: string, normalized: string) {
    super(
      "tag-collision",
      `Component names \"${first}\" and \"${second}\" both normalize to \"${normalized}\"`,
    );
    this.name = "TagCollisionError";
  }
}
