# goal.falconos.markets

The site serves the investor deck from `public/index.html`. The source deck and its local assets live in `docs/pitches/`.

Sync the published copy after editing the source deck:

```bash
node web/goal/sync-deck.mjs
```

Deploy the `falconos-goal` Cloudflare Worker to `goal.falconos.markets`:

```bash
cd web/goal && npx wrangler@latest deploy
```
