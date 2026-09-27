# Frontend validation and Better Interface review

## Scope

Implementation and validation complete for the authorized frontend scope; Git commit is blocked by read-only repository metadata: one page, production export, runtime deployment manifest/ABIs, wallet reads and primary app actions, event leaderboard and validation evidence. No swap is included because the approved workflow excludes it. No real transaction was signed or broadcast.

The requested root DESIGN.md conflicts with the higher-priority write boundary. Its complete content is in `docs/DESIGN.md`. Only authorized `web/`, `dist/`, `docs/` and the explicit `web/.gitignore` allowance change; deployed source and protected root configuration are preserved. The ignore file excludes nested dependency/cache output. No publication or redeployment occurred.

The supplied browser MCP returned `Transport closed`. Local Playwright Chromium instead inspected the production export. Each script owns and closes a foreground server/browser; browser binaries live in disposable `test/scratch/`, outside the submission.

## Checks run on 2026-09-27

| Command/check | Result |
| --- | --- |
| `npm ci --offline --cache /tmp/kudos-npm-cache --prefix web` | Passed with populated worker cache; 42 packages audited, no reported vulnerabilities. Fresh install needs registry access. |
| `npm --prefix web run typecheck` | Passed. |
| `npm --prefix web run build` | Passed. Vite relative-base export then pinned ABI verification/manifest generation. Nonfatal >500KB JS chunk warning; whole export about 560KB. |
| `npm --prefix web run validate` | Passed exact handoff, network, wallet parameters, pinned ABI bytes/Keccak, complete SHA-256 inventory, paths/count/sizes and dependency exclusions. `evidence/export-validation.json`. |
| `PLAYWRIGHT_BROWSERS_PATH="$PWD/test/scratch/pw-browsers" npm --prefix web test` | 16 grouped browser interaction checks passed at `/preview/`. Mocked wallet/RPC; `evidence/interactions.json`. |
| `npm --prefix web run check:live` | Live Sepolia block 11791398, chain 11155111, token/app code 1722/2333 bytes, correct token binding, KUDO/18 decimals, epoch 0. `evidence/live-read.json`. |
| `PLAYWRIGHT_BROWSERS_PATH="$PWD/test/scratch/pw-browsers" node web/scripts/browser-live.mjs` | Unmocked Chromium RPC read succeeded. Epoch-0 events covered blocks 11791335–11791425. No console/resource failures. `evidence/browser-live.json`. |

The interaction groups cover disconnected/missing wallet; exact add/switch-chain parameters; free give without approval; count × tip arithmetic; approval then payment; withdrawal/zero credit; invalid/self/zero recipient, count, precision, overflow and balance; wallet rejection and simulation failure; account changes during preparation/provider events; event aggregation/deduplication/full range and failed-scan handling; missing code/wrong RPC/token mismatch; plan changes and epoch rollover; keyboard-only connect/approve/give/withdraw; ABI tampering; reflow, accessibility and reduced motion.

Screenshots were viewed. `desktop-live.png` captures real public-chain reads; other screenshots use synthetic accounts/balances/events solely as UI fixtures. Final desktop, 390px and 320px views and both focus screenshots were inspected. This evidence does not claim mocked activity happened onchain.

## Six-domain coverage

| Domain | Checked | Limitations |
| --- | --- | --- |
| Accessibility | Native names/roles/labels, error association/focus, stable status region, keyboard-only primary flow, native radio arrows, visible light/dark focus, reduced motion. Axe WCAG 2 A/AA and 2.1 AA: zero violations at 1280/800/390/320px. | No screen-reader, physical-device or forced-colors browser session; not full WCAG certification. |
| Layout | DOM order, desktop columns/mobile stack, address/amount wrapping, inset controls, 320px reflow and 800px intermediate layout; no horizontal overflow. | Native 200% zoom not verified. Root text enlargement to 32px checked separately. English/light mode only; RTL/localization not verified. |
| Writing | Action labels match calls; total tip/approval explained; kudos versus KUDO, gas, sybil limits and recovery explained; empty state points to giving. | No user study/localization. |
| Typography | System stacks, descending hierarchy, 16px input text, tabular numbers, full-address alternative, rendered wrapping and table header correction. | Font rendering varies by platform; no custom fonts. |
| Colors | Measured actual computed foreground/background pairs: body 11.23:1, muted/card 6.15:1, primary 9.48:1, wallet secondary 8.00:1, selection 10.48:1, field focus 5.01:1, wallet focus 9.80:1. | Listed pairs only; no dark theme, gradients or image-backed text exist. |
| UI | Normal/focus/selected/disabled/pending/success/error/empty behavior; hover rules reviewed; primary emphasis follows approval; 120ms press feedback disabled by reduced motion. | Slow-motion animation-panel session not performed. Modal/theme/drag/autoplay checks not applicable. |

## Findings and fixes

| Severity / domain | Source | Finding, fix and recheck |
| --- | --- | --- |
| Medium / layout + type | `web/src/styles.css:975` | Initial 320px table split Rank/Kudos mid-word. Rebalanced narrow columns, wrap at words, hide decorative table arrow. Final 320/390 screenshots show whole headings and no overflow. |
| Medium / accessibility | `web/src/App.tsx:297` | Initial tip/count errors focused recipient. Focus and aria-invalid now target the relevant field. Invalid-input and full keyboard tests passed. |
| Medium / accessibility + color | `web/src/styles.css:995` | Shared blue focus unsuitable for dark wallet panel. Added yellow focus; measured 9.80:1 and inspected wallet-focus screenshot. |
| Medium / reliability | `web/src/App.tsx:164` | Source review found automatic refresh could repeatedly cancel slow scans. Added in-progress guard while preserving manual restart. Regression passed; production long-range load remains untested. |
| Low / accessibility | `web/src/App.tsx:521` | Refresh glyph appeared in accessible name. Hidden decorative glyph; exact Refresh name and keyboard tests passed. |

No known unresolved blocker remains in the authorized frontend scope. Root design-document placement is the explicit scope deviation above.

## Limits

No real extension signing, mined payments/withdrawals, swaps, replacement/receipt-timeout branches, deep reorgs, finalized history or large/rate-limited event loads were validated with real funds. Mocks establish frontend sequencing, not chain execution. The unmocked browser used public reads without a wallet. Safari, Firefox, hardware wallets and multiple installed extensions were not tested. WalletConnect is unconfigured because no project ID was supplied. There is deliberately no swap/quote to test.

Runtime checks verify nonempty code and token binding, not independent deployed-runtime equivalence. ABI hashes bind to the loaded manifest; immutable-site/handoff attestation checks belong to the control plane. RPCs are trusted to return correct/complete data; a silently incomplete successful response cannot be detected by a frontend alone.

No Foundry checks were rerun because contracts did not change. IPFS pinning, publication and immutable/named-entrypoint validation are subsequent publisher work. These are worker self-checks with no independent authority.

## Git delivery limitation

`git add -- web dist docs` failed with `Unable to create .git/index.lock: Read-only file system`. No files were staged or committed. All source, lockfile, export and evidence are present in the allowed working-tree paths for the publisher to capture. There is no permission escalation available; the protected metadata was not changed. A committed submission bundle cannot be generated here. `evidence/delivery.json` records the file-scope and byte-size check instead; that byte tally is not claimed to be an actual Git bundle measurement.
