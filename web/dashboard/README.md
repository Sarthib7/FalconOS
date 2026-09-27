# Control Centre

[VERIFIED, source: `web/dashboard/`] React port of the active OpenDesign Control Centre. Views: Overview, Decisions, Knowledge and Connections. It preserves the source assets and synthetic sample records.

[REPORTED, clean release checks] From the repository root:

```bash
npm --prefix web ci
npm --prefix web run build
npm --prefix web test
```

[INFERRED, local commands] Start development or preview with:

```bash
npm --prefix web run dev -- --host 127.0.0.1 --port 4183
npm --prefix web run preview -- --host 127.0.0.1 --port 4183
```

[INFERRED, usage] Use one server on port 4183 at a time. Open `http://127.0.0.1:4183/dashboard/`. Inspect an example or create a saved simulation. Record evidence before a cycle. The simulation uses browser storage and cannot move wallet funds.

[VERIFIED, boundary] Knowledge samples are retained fixtures. Connections links to the separate mesh viewer and terminal. This static release does not host the mesh API. Local Vite does not run the hosted signup Function. See the [release record](../../docs/website-release.md).

[VERIFIED, browser harness] `npm --prefix web run test:dashboard:browser` starts temporary Chrome profiles and blocks external HTTP. It compares the original OpenDesign files with the build. Set `FALCON_DASHBOARD_SOURCE` to the original project directory when it differs from the default local path.
