# Font files

Self-hosted variable fonts referenced by `@font-face` in
`src/styles/base.css`. Not checked into the repo. Until these are present,
the UI falls back to the system sans stack defined in
`src/styles/tokens.css` (`--font-display`, `--font-body`) - nothing breaks,
it just isn't Plus Jakarta Sans / Inter yet.

| File | Family | Source |
|---|---|---|
| `PlusJakartaSans-Variable.woff2` | Plus Jakarta Sans (weights 400-800) | https://fonts.google.com/specimen/Plus+Jakarta+Sans (by Tokotype, Indonesian type foundry - worth the pitch line in PRD §4) |
| `Inter-Variable.woff2` | Inter (weights 400-700) | https://fonts.google.com/specimen/Inter |

## Download and convert

Google Fonts serves static weights by default. To get a single variable
woff2 per family (smallest total payload, matches the `font-weight: 400
800` range declared in `base.css`):

```bash
# Plus Jakarta Sans variable font, from the official GitHub release
curl -L -o public/fonts/PlusJakartaSans-Variable.woff2 \
  "https://github.com/tokotype/PlusJakartaSans/raw/master/fonts/webfonts/PlusJakartaSans%5Bwght%5D.woff2"

# Inter variable font, from the official GitHub release
curl -L -o public/fonts/Inter-Variable.woff2 \
  https://github.com/rsms/inter/raw/master/docs/font-files/InterVariable.woff2
```

If either link has moved, download the "variable font" package from the
family's Google Fonts page and convert the `.ttf` to `.woff2` with a tool
like `fonttools varLib.instancer` or https://cloudconvert.com, keeping the
filename above so `base.css` resolves it without changes.

This is a one-time local download for `npm run dev` / `npm run build` -
CLAUDE.md constraint 2 is about the *shipped app* making no runtime network
calls, which self-hosting these files satisfies once they're in place.
