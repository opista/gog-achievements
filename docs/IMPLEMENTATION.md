# Implementation notes

Use [A's desktop workspace](design/desktop-workspace.png) and the [state concepts](design/WORKFLOW.md) as the UI reference. The layout is three panes with one modal date editor and one final confirmation.

Operation history records requested dates, confirmed results and uncertain outcomes. It supports inspection after a failure or interruption. It does not provide rollback, relocking or editing an existing unlock date.

The browser preview uses explicit demo mode. Its sample data and simulated apply results never invoke the CLI. The installed Electron app uses the pinned released CLI.

Real game covers and achievement images use the CLI's image fields and trusted GOG hosts. Generated demo art supports visual review. Missing production artwork has a clear icon fallback.

Native window controls follow the host OS; the renderer does not draw the Windows title-bar controls from the concepts. The account menu, report-history access and demo indicator are necessary UI additions. Mobile browser layout supports local preview; installers target desktop.

Release builds need validation on all four native targets. Local development smoke tests do not prove public signing, notarization or Windows installation.

The reviewed workspace uses compact game rows with full-title tooltips, a clear-search action, inline achievement descriptions, and a single skeleton status during initial game reads. Covers use the GOG CDN's thumbnail variant. Visible locked achievements come first, hidden locked achievements next, and unlocked achievements last with newest unlocks first. Existing unlocks have no selection control.

The released CLI exposes account IDs but no account name or email. The header shows GOG account; its menu retains the ID.

After each apply, confirmed items are removed from the mutable draft under an exclusive queue lock. Failed, unconfirmed and unattempted items remain. The saved report and immutable snapshot retain the complete attempt. Concurrent draft additions or changes are preserved; housekeeping failures keep the confirmed report and show a warning.

On queue reads, saved terminal reports can also clear confirmed requests left by earlier app versions. This requires a matching, digest-verified snapshot. Newer edits or unresolved attempts remain; missing evidence and busy locks leave the readable draft available.
