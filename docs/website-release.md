# Website release, 2026-09-27

[VERIFIED, user request] "I want the new website to be live." The target is the existing Cloudflare Pages project `falconos`. Before this release, its current deployment and both public aliases served identical landing and wallet pages. The existing GitHub main commit was `4f8e78c81dede71bc8ef0401df9184a81d05ad38`.

[REPORTED, release agent logs] A clean checkout passed `npm --prefix web ci`, `npm --prefix web run build` and `npm --prefix web test`. Results: `116 modules transformed`; `tests 142`, `pass 142`, `fail 0`. [VERIFIED, root hash comparison] All 39 output files match the previously reviewed local build byte for byte. The root Chrome run against that artifact returned `passed:95`, `total:95`, `exceptions:[]`, `remoteRequests:[]`. Browser checks used synthetic records and blocked external HTTP.

[VERIFIED, source comparison] Existing `web/app`, product, research, dash, Functions, migrations, snapshot script and public data remain identical to the starting main commit. Website builds now use retained source inputs. The snapshot command remains manual. Browser dependencies are declared in `web/package.json`; Vite resolves the Solana package from that package root.

[VERIFIED, scope] The new landing, Control Centre, treasury simulation and mesh viewer are static routes. The mesh viewer requires a separately configured API. This release does not deploy that service or change a database schema. Original OpenDesign files remain unchanged. The site uses the existing signup Function.

[REPORTED, public probe] Before publication, an invalid-email POST returned `503 {"error":"waitlist_unavailable"}`. The preserved Function checks `WAITLIST_DB` and `WAITLIST_IP_SALT` before validating email. [INFERRED] One or both required bindings are absent or falsey. Cloudflare account access is needed to identify the missing setting. No valid public signup or email was sent during the probe.

[VERIFIED, source] The new client accepts the existing handler's `registered` and `already_registered` responses. It claims only registration when no email status exists. Confirmation email and actual wallet round-trip proof remain separate work.

[INFERRED, publication check] After the Git-connected deployment finishes, verify the public landing and dashboard asset hashes. Verify fonts and dashboard view navigation. Record the returned deployment identifier and URL before claiming publication.
