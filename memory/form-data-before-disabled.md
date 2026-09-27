# Capture form values before disabling controls

[VERIFIED, treasury browser regression, 2026-09-26] Disabling the setup fieldset before constructing `FormData` omitted the visible inputs. The original order failed with `Total USDC must be an unsigned USDC decimal string with at most six fractional digits.`

[VERIFIED, source and test] `web/treasury/app.mjs` now captures `FormData` before setting the busy state. `web/test/treasury-browser.mjs` checks corrected setup under SPEC V85. The isolated old-order copy failed that same test.

[INFERRED, lesson] Capture values before changing form availability. This matters because a valid visible form can otherwise submit an empty mandate.
