import lat from './assets/fonts/noto-lat.ttf?url'
import latx from './assets/fonts/noto-latx.ttf?url'
import deva from './assets/fonts/noto-deva.ttf?url'
import tam from './assets/fonts/noto-tam.ttf?url'
import type { FontName } from './searchable'
// Noto Sans (SIL Open Font License, see assets/fonts/OFL-LICENSE.txt), converted to plain TrueType so it can be embedded. Served from this site.
const URLS: Record<FontName, string> = { lat, latx, deva, tam }
export const loadFontBrowser = async (n: FontName) => new Uint8Array(await (await fetch(URLS[n])).arrayBuffer())
