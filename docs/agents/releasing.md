# Releasing

A release is a `chore(release): vX.Y.Z` commit on `main` and a pushed `vX.Y.Z` tag. The tag starts `.github/workflows/release.yml`, which publishes the images and creates the GitHub Release. The CHANGELOG section of that version, without its heading, becomes the release text, so write the section as the release page should read.

## Steps

1. Pick the version from the Conventional Commits since the last tag (`git describe --tags --abbrev=0`): a `BREAKING CHANGE` footer or `!` means major, any `feat` means minor, otherwise patch.
2. Set `version` in both `package.json` and `web/package.json`.
3. Add the section at the top of `CHANGELOG.md` in the format below.
4. Run `bun run check`, commit `chore(release): vX.Y.Z`, and push `main`.
5. Tag and push: `git tag -a vX.Y.Z -m vX.Y.Z && git push origin vX.Y.Z`. Watch the run with `gh run watch`. Done when the Release workflow is green and the release page shows the section.

## Section format

Modelled on the NestJS release notes (https://github.com/nestjs/nest/releases): changes grouped by module, every change linked to its commit.

```markdown
# vX.Y.Z (YYYY-MM-DD)

#### Notable changes

**Upgrade**
* What a self-hoster must do or know: new migrations, breaking changes (prefixed **Breaking:**), new personal data kept – [abc1234](https://github.com/yhagus/routerlm-oss/commit/<full hash>)

**<Feature area>**
* One line per user-visible change, ending in the commits that made it – [abc1234](…), [def5678](…)

<output of: bun scripts/release-notes.ts <previous tag> vX.Y.Z>
```

- **Notable changes** is hand-written prose for operators and API clients. Keep **Upgrade** first and present in every release; give it a "Nothing to do" bullet when nothing applies. Group the rest by feature area, using GLOSSARY.md terms.
- The commit lists below it come from `bun scripts/release-notes.ts <previous tag> vX.Y.Z`: commits since the previous tag grouped by type (Features, Bug fixes, Refactors, Docs, …), then by module (the commit scope), each with its linked short id, ending in the **Full Changelog** compare link. Paste its output unedited; fix a wrong scope or type in the commit history's future commits, not in the notes.
- Run the script before the release commit exists, with `HEAD` as the default ref. It skips merges and `chore(release)` commits.
