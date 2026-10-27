// Must stay the first import of main.tsx and import only `@officexr/world/app`: the renderer
// modules preload models as they evaluate, so the base has to be set before they load.
import { setAssetBaseUrl } from '@officexr/world/app';

setAssetBaseUrl(window.__OFFICEXR_CONFIG__?.OFFICEXR_ASSET_BASE_URL ?? null);
