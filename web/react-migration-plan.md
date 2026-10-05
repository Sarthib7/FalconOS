# Frontend migration plan

[VERIFIED, sources: `README.md`, `vite.config.js`] Historical plan. The current site has React/Vite landing and dashboard routes. See [current source layout](README.md#source-layout).

## Decision

[DECIDED, user instruction, 2026-09-17] Migrate the web surface to React first. Keep Vite as the build tool during the first migration. Revisit Next.js after the React migration proves the route, data, and deployment boundaries.

This pull request records the plan. It does not migrate runtime code.

## Current baseline

[VERIFIED, repository read, 2026-09-17] The web package uses Vite without React or Next.js dependencies. Evidence: `web/package.json:6-16` lists `vite` scripts and the Vite dev dependency.

[VERIFIED, repository read, 2026-09-17] Vite builds two HTML entry points. Evidence: `web/vite.config.js:4-16` names `web/index.html` and `web/dash/index.html` as `main` and `dash` inputs.

[VERIFIED, repository read, 2026-09-17] The landing page and dashboard are large self-contained HTML files with inline styles and scripts. Evidence: `web/index.html` has 2,146 lines and `web/dash/index.html` is an HTML entry point with inline CSS and page behavior.

[VERIFIED, repository read, 2026-09-17] The dashboard is a read-only market snapshot. Evidence: `web/dash/index.html:6` describes the page as a CoinGecko snapshot with no orders, custody, or execution.

[VERIFIED, live fetch, 2026-09-17] Production serves the landing page at `https://falconos.markets/` and the dashboard at `https://falconos.markets/dash/`. Both routes returned the expected FalconOS pages during this session.

## Why migrate

[INFERRED] Inline HTML works for the current static preview, but it makes route-level reuse, typed data flow, and focused component tests harder. React should improve those boundaries without changing the current product claims or deployment target.

## Migration stages

### 1. Freeze the current contract

- Preserve the current routes: `/` and `/dash/`.
- Preserve the current read-only and advisory-only boundaries.
- Preserve canonical metadata, favicon, dark theme, and direct-route behavior.
- Capture the current dashboard snapshot shape as a typed application boundary.

### 2. Add React inside the existing Vite site

- Add the smallest React and TypeScript dependency set.
- Keep the existing Vite multi-page build unless route conversion proves simpler.
- Create one React entry for the landing page and one for the dashboard.
- Move route-specific markup into local components. Do not create a shared design system before reuse exists.
- Move page behavior into typed modules. Keep static snapshot loading separate from presentation.

### 3. Migrate the landing page

- Convert the existing sections in place.
- Keep the Alpine Vector-inspired light-mode direction and the current dark Liquid Metal implementation until a separate design decision changes them.
- Preserve visible distinction between `FALCON` and `OS` in the wordmark.
- Preserve keyboard behavior, focus states, reduced-motion behavior, and semantic headings.

### 4. Migrate the dashboard

- Convert dashboard panels, instrument selection, time-frame controls, and freshness states into React components.
- Keep market values sourced from the committed snapshot during this phase.
- Keep stale, missing-data, and execution-disabled states explicit.
- Do not add wallet connection, signing, order submission, custody, or pooled capital.

### 5. Verify deployment parity

- Run the web build and existing web tests.
- Test direct navigation to both routes from a production-like static server.
- Compare key text, metadata, route behavior, and dashboard state against the current site.
- Deploy only through the existing user-managed Cloudflare Pages workflow.

## Next.js decision gate

[INFERRED] Consider Next.js only after the React/Vite migration if one of these needs becomes real:

- server-rendered or server-generated page content,
- framework-managed application routing beyond the current two static entries,
- server-side data access that should not run in the browser,
- a deployment move that benefits from Next.js runtime behavior.

Do not add Next.js only to replace HTML components. React inside Vite covers the current static product with less deployment change.

## Acceptance criteria for the implementation PR

- `/` and `/dash/` retain their current public routes.
- The build produces both routes for the existing Cloudflare Pages configuration.
- Existing advisory, custody, signing, execution, and data-source claims remain accurate.
- The dashboard renders snapshot data and visible freshness state without a wallet or order path.
- Existing web tests pass, with tests added only for observable migration behavior.
- The production-like static preview matches the current route and metadata contract.

## Out of scope

- Adding live trading, wallet connection, signing, custody, pooled capital, or order submission.
- Adding a backend API or persistent waitlist.
- Changing Cloudflare ownership or deployment settings.

## Least confident decisions

1. Keeping Vite multi-page mode during the first React slice. The choice minimizes deployment change, but the implementation may show that a single React entry is simpler.
2. Deferring Next.js. This remains correct only while the web surface stays static and advisory-only.
