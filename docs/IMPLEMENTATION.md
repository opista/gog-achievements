# Implementation notes

The workspace follows [A's three-pane layout](design/desktop-workspace.png), with the later UI reviews taking precedence over the original [state concepts](design/WORKFLOW.md). Signed-out users see a blank library and one sign-in action; the queue is hidden. The account menu uses a profile icon and arrow.

The released CLI owns authentication, queue validation and GOG writes. Game and achievement images use trusted GOG image hosts. The CLI currently exposes landscape library thumbnails; portrait metadata lookups would require another request, so artwork remains unchanged under the user's constraint. Demo assets are sample content only, and demo mode never invokes the CLI.

Locked achievements come first, hidden locked achievements next, and unlocked achievements last with newest unlocks first. Descriptions appear below titles. Each eligible row has a direct Add to queue action; hidden details stay concealed until revealed. Game titles use ellipsis and full hover text. Library and achievement reads use local skeletons without a shared loading banner.

The queue groups all saved queues for the signed-in account and remains editable in history. Queued rows show title and description, with calendar and remove controls at the right. Achievement metadata is cached per account and loaded for saved groups without changing the selected game. A compact date dialog supports an explicit date or the current time, preserves seconds, rejects future or invalid times, and requires a chosen offset for repeated local times. The machine zone controls date display and entry; there is no time-zone selector. It refreshes when the window gains focus or becomes visible. Stored timestamps remain UTC instants, so changing the machine zone does not rewrite queue or history dates.

Each group's Apply action runs a dry-run check and opens one final confirmation. The saved snapshot and token bind it to the exact queue, account and game. Confirmed requests are removed under an exclusive queue lock after the immutable report is saved. Failed, unconfirmed and unattempted requests remain. Concurrent edits are preserved, and housekeeping failures retain the confirmed report. Reads can reconcile older confirmed requests only with matching digest-verified snapshots.

History is a flat list of confirmed achievement unlocks with game names and actual unlock dates. Existing unlocks skipped by an attempt are excluded. Failed or unknown outcomes remain visible under Needs attention. Durable operation records and snapshots stay available for recovery; history does not provide rollback or relocking.

Native controls follow the host OS. Mobile layout supports the local browser demo; installers target desktop. Release builds still require validation on all four native targets, signing and notarization. Local Mac package checks do not prove Windows installation or public signing.
