# Releases and updates

## Repository setup

The app releases from `opista/gog-achievements`. Its pinned CLI comes from `opista/gog-achievements-cli`.

Both repositories should be public for anonymous builds and installed-app update checks. While the CLI is private, set the app repository secret `CLI_RELEASE_TOKEN` to a token with read-only Contents access to that CLI repository. Do not put a token in the app. A private app repository cannot serve anonymous update checks.

In GitHub Actions settings, allow GitHub Actions to create pull requests. Keep the default workflow token read-only; release jobs declare their own write permissions. Release Please needs no personal token.

If GitHub marks a bot-created release PR as awaiting workflow approval, a maintainer must approve that CI run after reviewing the release metadata diff. This starts checks; it does not merge the PR. The explicitly dispatched CI run is also visible in Actions.

Packages are unsigned. Signing and clean-machine installation checks remain needed for supported Mac and Windows systems. The pinned [CLI v0.4.0](https://github.com/opista/gog-achievements-cli/releases/tag/v0.4.0) includes the [tested GOG login fix](https://github.com/opista/gog-achievements-cli/pull/2).

## Normal release

1. Merge conventional commits into `main`, for example `fix: correct achievement sorting` or `feat: add update notices`.
2. Release Please opens or updates a version pull request. The first version is `0.1.0`. Review its version, lockfile, manifest and changelog. CI also runs on the bot branch.
3. Merge the version pull request when its checks pass. Release Please creates a draft release and version tag. The release workflow resolves that tag to a commit and builds that exact commit.
4. Checks must pass before native packaging. Each package includes the pinned CLI and passes offline CLI checks. Publication requires every expected package and checksum, matching versions, and an unchanged release tag.
5. The workflow attaches the verified files and publishes the draft. A failed build leaves it unpublished.

Each release contains a DMG and ZIP for each Mac architecture, and an EXE installer for each Windows architecture. Each file has a `.sha256` file: six packages and six checksums in total.

| Target          | GitHub runner    | Release files  |
| --------------- | ---------------- | -------------- |
| `macos-arm64`   | `macos-15`       | `.dmg`, `.zip` |
| `macos-x64`     | `macos-15-intel` | `.dmg`, `.zip` |
| `windows-arm64` | `windows-11-arm` | `.exe`         |
| `windows-x64`   | `windows-2025`   | `.exe`         |

CI uploads packages as temporary workflow artifacts. These are separate from published release downloads. Run **CI → Run workflow** with a target to check one native package.

Compilation has a three-minute subprocess limit; native packaging has ten minutes within the workflow's thirty-minute job limit. Slower runners can need more than three minutes to create installers. Failed commands retain their stdout and stderr in the job log, and deadline termination reports the command and its limit.

## Retry a failed release

Fix an external build problem, then run **Release → Run workflow** with the existing draft tag, for example `v0.1.0`. The workflow only accepts draft releases. It rebuilds the tagged commit, verifies all files, and replaces draft assets before publication.

If source code must change, make a new release commit and tag through Release Please. Do not move the existing tag to bypass verification.

## Update checks

The installed app makes one anonymous GitHub API check at startup. The top-right account menu offers **Check for updates…**, even when signed out. The native macOS app menu and Windows Help menu offer the same check. Network errors stay quiet at startup and produce a message when checked manually. A missing or private release is reported as unavailable, not as proof that the app is current.

Only a newer stable version with the exact installer for the running platform and architecture is offered. Drafts and prereleases are excluded. Release metadata, size, version and GitHub URLs are checked before a download link is retained. Download opens that retained link in the browser. There is no background download, automatic install or forced restart.

The queue and history remain in the app's user-data folder when a new version replaces the app. Keep `appId` and product name stable across releases. Update notices wait until CLI work is idle.

## Move to another GitHub organisation

Both repositories are public under `opista`. If either repository moves again, update:

- The app's `repository.url` in `package.json`, which is also the update source.
- CLI repository references in `cli-release.lock.json` and `scripts/cli-artifacts.mjs`; refresh the lock with a verified release.
- README and documentation links, local Git remotes, repository settings and any optional read token access.

Workflow API calls use the current GitHub repository automatically. Update checks follow validated GitHub repository redirects so existing installations can still find releases after a transfer. Keep the old repository path available for redirects. Keep the app ID unchanged.

## Future automatic updates

This release uses browser downloads. Automatic download and installation would be a separate feature with signed packages, an update feed and platform installation tests. It is not required for release notifications.
