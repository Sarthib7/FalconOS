# FalconOS asset credits

VERIFIED: This React landing uses assets from the active OpenDesign file, `falconos-landing.html`.
Its Alpine symbol retains the paths `M30 194L171 39L129 151Z` and `M138 195L218 70L190 195Z`.

VERIFIED: The four `.ttf` files were extracted from that file's embedded font data without changing the bytes.
`manifest.json` records their byte lengths and SHA-256 hashes.
`web/test/landing.test.mjs` checks the copied files against those values.
These checks cover the copied files. They do not establish the source files' earlier history.

VERIFIED: `FONT-LICENSE.txt` retains the source's full Geist SIL Open Font License, version 1.1.

CORRECTION: The first copy of this credits file described PNG banners and photograph credits from the source brand board.
Those assets are absent from this port. Its manifest covers fonts only.
That copied text was not evidence that this port verified the brand board exports.
