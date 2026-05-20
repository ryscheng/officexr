import { emptyMapDocument, type MapDocumentV1 } from '@officexr/world/scenes';

/** A blank map document for tests that build state through the UI. */
export function emptyMapSeed(name = 'test-map'): MapDocumentV1 {
  return emptyMapDocument(name, name);
}
