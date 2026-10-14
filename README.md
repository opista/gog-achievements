# GOG Achievements

An Electron app for macOS and Windows that restores GOG achievements you have already earned. It bundles [CLI v0.3.0](https://github.com/metacurb/gog-achievements-cli/releases/tag/v0.3.0).

Sign in, choose a game and add locked achievements to the queue. Use the calendar button to edit a date or set the current time, then apply one game group at a time. The app checks the group before final confirmation. Existing unlocks keep their dates.

The queue stays visible across games and on the history page. History lists confirmed unlocks with game names and unlock dates, with uncertain results shown separately. All dates are shown and edited in your machine’s local time. Stored timestamps keep their original UTC instants.

The app keeps an operation record for recovery behind the unlock history list. It cannot undo an unlock, relock an achievement or change an existing unlock date. Queue edits are local until you confirm Apply.

Requires macOS 13.5 or later, or Windows 10/11, on ARM64 or x64. These requirements combine the [bundled CLI runtime](https://github.com/metacurb/gog-achievements-cli/blob/v0.3.0/README.md) and [Electron 44](https://releases.electronjs.org/release/v44.0.0).

## Run locally

Use Node 24.19.0, recorded in [.node-version](.node-version).

```sh
npm ci
npm run cli:download
npm run dev
```

The CLI repository is currently private. Source builds need a GitHub login with access, through `GH_TOKEN`, `GITHUB_TOKEN`, or an existing `gh` login. Installed app packages already contain the verified CLI and do not download it at startup.

Windows sign-in also requires [Microsoft's WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/). The CLI reports native prerequisites; credentials remain in macOS Keychain or Windows DPAPI. If a new Mac helper cannot read the saved login, choose **Sign in to GOG** and allow Keychain access locally when asked.

## Browser preview

```sh
npm run dev:web
```

Open [the demo](http://localhost:5173/?demo=1). It uses sample data and simulated results. It never invokes the real CLI. Choose complete, partial, uncertain, empty or read-error scenarios in its header. For visual checks, add `&theme=light` or `&theme=dark`. Desktop appearance follows the system theme.

A browser without `?demo=1` shows that the desktop bridge is unavailable.

## Check and build

```sh
npm run check
npm run test:e2e
npm run build -- --target=macos-arm64
npm run package -- --target=macos-arm64
```

Targets: `macos-arm64`, `macos-x64`, `windows-arm64`, `windows-x64`. Run each target on a matching native host. Build compiles the app; package also produces Mac DMG/ZIP files or a Windows installer and SHA-256 files.

```sh
npm run cli:smoke -- --target=macos-arm64
node scripts/verify-package.mjs --target=macos-arm64 --directory 'dist/mac-arm64/GOG Achievements.app'
```

Tests use fake CLI responses and sample accounts. Browser tests run the demo flow on a separate temporary server. Offline smoke checks read help and a fixture queue. Neither makes achievement writes.

Local Mac builds are not Developer ID signed or notarized. Public distribution needs signing and clean-machine validation. Windows native behaviour and packages need Windows verification.

## CI and source layout

[CI](.github/workflows/ci.yml) checks formatting, lint, types, tests and compilation on all four native targets. [Manual packages](.github/workflows/package.yml) need a `CLI_RELEASE_TOKEN` secret with read access to the private CLI repository. No workflow publishes a release. Release automation can be connected when the app's GitHub repository exists.

| Area            | Responsibility                                                                 |
| --------------- | ------------------------------------------------------------------------------ |
| `src/shared/`   | CLI data contracts, IPC validation and shared demo backend                     |
| `src/main/`     | Fixed CLI commands, drafts, reviewed snapshots, operation records and recovery |
| `src/preload/`  | Narrow typed desktop bridge                                                    |
| `src/renderer/` | Workspace, dates, review and report screens                                    |
| `scripts/`      | Verified CLI download, native packaging, checksums and offline smoke           |
| `tests/`        | Backend, renderer, date and archive/packaging behaviour                        |

Read the [plan](PLAN.md), [screen design](docs/design/WORKFLOW.md), [implementation notes](docs/IMPLEMENTATION.md) and [CLI release lock](cli-release.lock.json).
