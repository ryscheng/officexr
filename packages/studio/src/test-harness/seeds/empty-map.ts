import { emptyMapDocument, type MapDocumentV2 } from '@officexr/world/scenes';

/** A blank map document for tests that build state through the UI. */
export function emptyMapSeed(name = 'test-map'): MapDocumentV2 {
  return emptyMapDocument(name, name);
}
