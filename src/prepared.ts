import type { ParsedDocument } from "./internal.js";

declare const preparedDocumentBrand: unique symbol;

/**
 * An already fetched and validated document for one native history entry.
 *
 * Keep this value in memory and pass it directly to the destination
 * `TurboLiteScreen`. It is intentionally opaque and is not serializable.
 */
export interface TurboLitePreparedDocument {
  readonly url: string;
  readonly [preparedDocumentBrand]: true;
}

const documents = new WeakMap<TurboLitePreparedDocument, ParsedDocument>();

export function createPreparedDocument(
  url: string,
  parsed: ParsedDocument,
): TurboLitePreparedDocument {
  const document = Object.freeze({ url }) as TurboLitePreparedDocument;
  documents.set(document, parsed);
  return document;
}

export function preparedDocumentContents(
  document: TurboLitePreparedDocument,
): ParsedDocument | undefined {
  return documents.get(document);
}
