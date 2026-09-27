# Landing page and email contract

[VERIFIED, user direction] The user requested React code from OpenDesign project `886c2e41-d9d4-45e0-a67d-148f20cfca61`, a landing update, and a working email flow. The active entry redirects to `falconos-landing.html`. Source root: `/Users/sarthiborkar/Library/Application Support/Open Design/namespaces/release-stable/data/projects/886c2e41-d9d4-45e0-a67d-148f20cfca61`.

[VERIFIED, source] The project has `brand-spec.md`, HTML files and assets. The inspected root has no `DESIGN.md`, README or package manifest. The active HTML uses the treasury story and embeds its fonts. The current Falcon web package uses Vite. React and React DOM are pinned to `19.3.0` for this port.

[INFERRED, implementation] Preserve the active design and its read-only synthetic scenarios in React components. Keep the source project unchanged. The existing Vite app owns runnable code and preview routes. Preserve fonts and licenses, graph inspection, scenario controls, JSON export, motion and reduced-motion behavior. Port the intended scenario logic despite the source's duplicate `const presentation=` syntax error.

[VERIFIED, existing email behavior] `web/functions/api/waitlist.js` stores an address in D1. It has no delivery provider in the earlier implementation. `web/migrations/0001_waitlist.sql` defines registrations and rate limits. Local Vite previously had no waitlist API middleware.

[INFERRED, signup interface] `POST /api/waitlist` accepts `{email,source:"landing"}`. Validate bounded UTF-8 JSON before a database write. The backend returns `status:"registered"|"already_registered"` only after persistence. The React form retains input after errors. A success message must describe registration separately from confirmation email.

[INFERRED, confirmation interface] Optional fixed-provider Resend delivery uses `RESEND_API_KEY` and `WAITLIST_FROM_EMAIL`. A new outbox is enqueued in the same database batch as registration. An outbox ID is the stable provider idempotency key. Claim one job before sending. Retain provider acceptance ID before returning `emailStatus:"accepted"`. Other email states include `not_configured`, `pending`, `failed` and `unknown`. Provider acceptance is not inbox delivery. Ambiguous retries outside the provider's 24-hour idempotency window need review.

[VERIFIED, primary reference checked 2026-09-27] Resend documents a 24-hour retention window for keys sent through the `Idempotency-Key` header. The outbox keeps its request body unchanged during that window. See [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).

[INFERRED, local runtime] A Vite middleware uses Node SQLite only when `FALCON_WAITLIST_DB_PATH` and an explicit local salt are configured. The database path must be absolute. A newly created database receives the full reviewed local migration history. Existing unknown or older schemas fail visibly; startup cannot silently upgrade them. The adapter accepts only local connections. Production continues through the Pages Function and D1 bindings.

[REPORTED, configuration inventory] The email implementer found no matching waitlist/provider variables in the current process and no Wrangler target configuration in the inspected repository paths. Hosted bindings were not inspected. Actual sender configuration and inbox delivery are not determined.

[INFERRED, verification] Use disposable SQLite for full-history and row-preservation checks. Inject provider responses for idempotency, concurrent requests, failed delivery and ambiguous retries. Test the browser form against the local API. No external message or hosted migration is part of these checks.

## Least confident decisions

1. [INFERRED] A synchronous, bounded delivery attempt fits the initial signup flow. A later delivery worker may be needed.
2. [INFERRED] The optional confirmation flow uses Resend because no existing provider was found. The user's provider preference remains undetermined.
