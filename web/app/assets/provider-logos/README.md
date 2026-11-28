Monochrome provider marks from `@lobehub/icons-static-svg` 1.101.0 (MIT,
https://github.com/lobehub/lobe-icons). The fixed `1em` size and inline
style were stripped so `ProviderLogo` sizes them. The marks belong to
their owners.

The set is hand-picked: model labs and inference hosts a Provider is likely
to be, plus the local runtimes (Ollama, vLLM, LM Studio). A file's name is
its logo key, the value a Provider's `logo` holds; `~/lib/providerLogos.ts`
picks up every file here, so adding a mark means dropping in its file. The
picker shows the file's `<title>`, unless that module names it otherwise.

Marks lobe-icons lacks come from the Provider's own site, cut down to the
same shape (one `currentColor` fill, no styles or comments):

- `tokenharbor.svg` is tokenharbor.ai's `/logo.svg` with a viewBox cropped
  to the mark.
- `tokenrouter-io.svg` is www.tokenrouter.io's `/favicon.svg`.
- `tokenrouter.svg` is redrawn from www.tokenrouter.com's only mark, a PNG
  (`/logo-without-title.png`), at its measured proportions.
- `bitdeer.svg` is the mark alone from the horizontal logo in
  www.bitdeer.ai's bundle (`/_next/static/media/logo.*.svg`), with a
  viewBox cropped to it.
- `experiential.svg` is www.experientiallabs.ai's `/icon.svg` without its
  background square.
- `orcarouter.svg` is traced from the blue of www.orcarouter.ai's only
  mark, a PNG (`/orca-logo-classic.png`).
