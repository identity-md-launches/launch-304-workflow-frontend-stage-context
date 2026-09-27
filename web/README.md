# Kudos frontend

One static React/TypeScript page for the deployed KudosEpochs application. Vite exports to repository-root `dist/` with relative base `./`. viem handles reads, simulation, wallet signing and receipts. No backend, indexer, remote fonts, WalletConnect project ID or private credentials are needed.

## Install, build and preview

Node 22 or newer. From repository root:

```sh
npm ci --prefix web
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web run validate
npm --prefix web run preview
```

The build needs installed dependencies and Git commit `55a010a0c735953a1a4b124d586644121ab055f3`. It does not need RPC access or temporary `.imd/reads` inputs. Fresh installation uses the registry; dependencies/caches are not vendored. `npm ci --offline --cache /tmp/kudos-npm-cache --prefix web` passed using the populated worker cache. That cache is not delivered. Build/typecheck work offline once dependencies are installed.

Serve `dist/` over HTTP(S), including a gateway subpath. Browser JSON-fetch restrictions make `file://` unsupported. Publish the committed export directly.

## Single runtime configuration

`config/deployment.json` and `config/network.json` preserve the supplied build inputs. After Vite, `scripts/export.mjs` obtains raw ABI arrays using `git show <sourceCommit>:docs/abi/<Contract>.json`, recursively sorts object keys for canonical JSON, verifies Keccak-256 against each attested `abiHash`, and exports the original ABI bytes.

It writes `dist/imd-deployment.json` with the exact handoff identifiers, contract set, unchanged network object, exact walletAddChain parameters and deployment block. Its SHA-256 inventory covers every other exported file. Rebuild the manifest after any export change.

The app loads **that manifest and its ABI paths at runtime**, through `src/config.ts`. There is no independently compiled chain/address/ABI/RPC map. Startup checks ABI hashes. Each snapshot checks RPC chain ID, nonempty deployed code and `KudosEpochs.token()` against the attested KUDO address. Token reads use this returned binding. Code existence is not independent runtime-bytecode attestation.

## Behavior

- EIP-6963 wallet discovery and injected `window.ethereum` fallback; multiple discovered wallets get a selector. Account/chain/disconnect events invalidate state. Local disconnect does not revoke wallet permissions or token allowance.
- Public RPCs are tried in supplied order, with connected wallet-provider fallback only on the correct chain. Signing stays with the wallet. Unknown chain error 4902, its nested equivalent, or an unknown-chain message triggers the supplied `wallet_addEthereumChain` parameters, then another switch.
- Reads show epoch/reset date, remaining kudos, KUDO balance, app allowance, withdrawable credit, weekly/lifetime received counts and lifetime tips. Week 1 means contract epoch 0. Amounts use onchain decimals and bigint arithmetic.
- Free `give` needs no approval. Every tipped plan explicitly approves exactly `count × tipPerKudo` to KudosEpochs, then separately gives. Input changes invalidate the local approval step. Recipient, count, precision, uint256 bounds and balance are validated.
- `withdraw` collects all credited KUDO to the connected account. Every write refreshes state and simulates before requesting a signature. Account/network changes during preparation block signing. Pending actions lock controls; receipts refresh reads. Rejection/revert messages and explorer links persist. After a timeout, check the linked transaction before retrying because it may still mine. Repriced/replaced receipts are handled.
- The current-week leaderboard comes only from Kudos events. A timestamp binary search finds the first epoch block. Inclusive 5,000-block chunks run four at a time and split failed requests down to at most 100 blocks. A failed range discards the ranking. Logs are deduplicated and grouped by recipient; count determines ranking, address breaks ties, and event tip is already the total. A changed snapshot block hash discards the scan.
- Automatic refresh runs every 30 seconds while idle, without interrupting an existing scan. Manual Refresh restarts it. Reads share one block number and the table exposes event block coverage. This is a latest-block view, not finalized history.

The workflow explicitly requests **no in-page swap**. The page explains that KUDO comes from swapping Sepolia ETH in the launch pool elsewhere. No quote, router or Permit2 call is constructed; the supplied Uniswap configuration remains unchanged. Kudos can be farmed with multiple wallets and are not verified reputation. Tips only move the giver's own KUDO. Sepolia ETH is needed for gas.

## Validation

```sh
# From repository root. Browser binaries are disposable scratch files.
PLAYWRIGHT_BROWSERS_PATH="$PWD/test/scratch/pw-browsers" npm exec --prefix web -- playwright install chromium
PLAYWRIGHT_BROWSERS_PATH="$PWD/test/scratch/pw-browsers" npm --prefix web test
PLAYWRIGHT_BROWSERS_PATH="$PWD/test/scratch/pw-browsers" node web/scripts/browser-live.mjs
npm --prefix web run check:live
npm --prefix web run validate
```

The interaction script owns/closes a foreground HTTP server and Chromium session, serves the production export at `/preview/`, mocks wallet/RPC responses and records evidence in `docs/evidence/`. It never broadcasts. `browser-live.mjs` uses real public reads without a wallet; `live.mjs` records read-only curl calls and exact snapshot blocks. See [validation](../docs/VALIDATION.md) and [design](../docs/DESIGN.md).

Only the authorized `web/`, `dist/`, `docs/` and explicit `web/.gitignore` paths change. The root DESIGN.md request conflicts with that write boundary, so the complete document is in `docs/DESIGN.md`. Deployed source, root configuration, libraries and existing ABI exports are preserved. No submodules, node_modules, caches, dependency archives or browser binaries are committed. Publication, hosting and immutable-site checks belong to the publisher. Worker results are not independent certification.
