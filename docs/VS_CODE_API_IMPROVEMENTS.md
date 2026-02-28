# VS Code API Improvement List

Audit basis:
- https://code.visualstudio.com/api/get-started/your-first-extension
- https://code.visualstudio.com/api/get-started/extension-anatomy
- https://code.visualstudio.com/api/references/extension-manifest
- https://code.visualstudio.com/api/references/activation-events
- https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- https://code.visualstudio.com/api/extension-guides/webview

## Applied in this pass

1. Simplified activation events for VS Code 1.90+.
- Kept only: `onStartupFinished`, `onView:audioEdaSidebar`, `onCustomEditor:audioEda.editor`.
- Removed redundant `onCommand:*` entries since contributed commands auto-activate in modern VS Code versions.

2. Added release changelog.
- Added `CHANGELOG.md` to improve release documentation and Marketplace maintainability.

3. Packaging metadata and license checks are now clean.
- `repository`, `bugs`, `homepage`, `publisher`, and `LICENSE` are present.
- `vsce package` runs successfully.

## Recommended next improvements (prioritized)

1. Add Marketplace icon (`package.json.icon`) using a 128x128 PNG.
- Impact: better listing quality and trust on Marketplace.

2. Add extension host integration tests.
- Use `@vscode/test-electron` to test command registration, custom editor open/reopen flow, and state persistence in a real Extension Development Host.
- Current tests are strong for core logic, but not extension-host behavior.

3. Add CI publish-readiness workflow.
- Run `npm run compile`, `npm test`, and `npm run package` on push/PR.
- Prevents regressions in packageability.

4. Narrow Explorer context menu visibility.
- Show `Open Workspace For Audio File` only for supported audio extensions in `explorer/context` `when` clause.
- Reduces command noise on non-audio files.

5. Add explicit workspace trust behavior notes.
- If toolbox commands are blocked/unavailable in untrusted workspaces, show clear UI guidance.

6. Add performance telemetry hooks (optional + privacy-safe).
- Track only local timing/error counters for heavy transforms to guide optimizations.
- Keep data local unless user explicitly opts in.

7. Add a concise contribution-point cheat sheet.
- Document where to add commands/menus/settings and corresponding runtime registrations.
- Keeps extension anatomy maintainable as feature surface grows.

## Notes

- Keeping `onStartupFinished` is intentional because auto-open-on-audio-focus requires listeners to be active early.
- This is a tradeoff between startup activation and UX automation.
