Monochrome provider marks from `@lobehub/icons-static-svg` 1.101.0 (MIT,
https://github.com/lobehub/lobe-icons). The fixed `1em` size and inline
style were stripped so `ProviderLogo` sizes them. The marks belong to
their owners.

The set is hand-picked: model labs and inference hosts a Provider is likely
to be, plus the local runtimes (Ollama, vLLM, LM Studio). A file's name is
its logo key, the value a Provider's `logo` holds; `~/lib/providerLogos.ts`
picks up every file here, so adding a mark means dropping in its file. The
picker shows the file's `<title>`, unless that module names it otherwise.
