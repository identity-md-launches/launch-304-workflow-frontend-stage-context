# Kudos design system

## Overview

Kudos is a weekly appreciation page for Sepolia wallet users. It uses warm paper, green ink, a dark wallet panel and a serif italic headline phrase. The giving form leads; balances and quota sit alongside. One filled action indicates the next step. These are implementation choices for a new frontend, not a claimed user-approved brand system.

Source: `web/src/styles.css`, `web/src/App.tsx`, `web/index.html`. This document is under `docs/` because root creation is outside the explicit write scope.

## Colors

The CSS root defines:

| Token | Value | Role |
| --- | --- | --- |
| `--paper` | `#f7f6f0` | Page |
| `--surface` | `#fffefa` | Cards, fields, primary-button text |
| `--ink` | `#203b2e` | Main text and dark wallet panel |
| `--muted` | `#58645a` | Hints and secondary copy |
| `--line` | `#d9ded4` | Structural borders |
| `--control-border` | `#758172` | Field and secondary-action boundaries |
| `--accent` | `#254d37` | Primary action, selection outline, flower |
| `--accent-hover` | `#193d29` | Primary hover |
| `--mint` | `#eaf0e5` | Selection, approval note, neutral notices |
| `--yellow` | `#e5ed9b` | Available quota symbols and dark-panel focus |
| `--on-dark` | `#f3f5e9` | Wallet text |
| `--on-dark-muted` | `#c9d5c5` | Wallet secondary text |
| `--error` | `#992f24` | Error text/border |
| `--error-bg` | `#fff0e9` | Error surface |
| `--focus` | `#376ec0` | Focus on light surfaces |

The wallet divider is `#627466`. No gradients, images behind text, theme variants or unused ramps exist. Labels and borders supplement color cues. Measured rendered ratios: body/paper 11.23:1; secondary/card 6.15:1; primary action 9.48:1; wallet secondary 8.00:1; selected count 10.48:1; field focus 5.01:1; wallet focus 9.80:1. Exact computed pairs are in `evidence/interactions.json`.

## Typography

Base: `Arial, Helvetica, sans-serif`, 16px, unitless line-height 1.55, root antialiasing and font synthesis disabled. Hero italic and editorial phrases use `Georgia, 'Times New Roman', serif`. Addresses use `ui-monospace, SFMono-Regular, Consolas, monospace`. These are platform fonts with no downloads; appearance varies by OS.

Hero: `clamp(2.3rem, 4.5vw, 3.65rem)`, weight 500, line-height 1.09, tracking −.055em; serif phrase weight 400, tracking −.05em. Mobile overrides use 2.55rem, then 2.3rem. Section headings use `--title: 1.625rem`, weight 500, line-height 1.2. Wallet/balance titles are 1.125rem. `--body: .9375rem`, `--small: .8125rem`; supplementary uppercase eyebrows are .6875rem/700 with .12em tracking. Inputs stay at 1rem; buttons use weight 600. The quota numeral is 4.5rem/400.

Changing numbers use tabular digits. Headings balance wrapping and prose uses pretty wrapping. Long amounts wrap. Short addresses retain their full value in accessible names, title and explorer destination. Useful text remains selectable.

## Layout

`.shell` is at most 1152px including 32px inline padding. Spacing uses mainly 8, 12, 16, 20, 24 and 32px. Cards have 32px padding; the workspace has a `1.35fr 1fr` grid and 24px gap. The week row precedes it; the leaderboard spans its width. Three brief explanatory columns follow.

At 52rem, shell/card padding becomes 24px, grid gap 18px and columns `1.1fr 1fr`. At 42rem, content stacks, shell padding becomes 20px and hero decoration disappears. At 23rem, shell/card padding becomes 16/20px and header/account labels wrap. Narrow leaderboard widths are 16% rank, 38% recipient, 20% kudos and the remainder for tips; headings break only at words. Controls stay inset, with no sticky or overlay content.

Rendered screenshots were inspected; automated reflow passed at 1280, 800, 390 and 320 CSS pixels. Root text enlargement to 32px passed separately. Browser-native zoom was not tested.

## Elevation & Depth

Flat surfaces, structural borders and one dark panel establish grouping. No shadows, blur or modals. Alerts and transaction messages remain in normal flow. The skip link appears above content only while focused.

## Shapes

Cards/panel use `--radius: 20px`; fields/count choices 8px; buttons 9px; notices/approval note 12px; week chips 24px. The decorative local `Flower` SVG uses eight ellipses and a center circle. Selected count uses a two-pixel outline, heavier weight and mint fill.

## Components

These are implemented patterns in `App.tsx`, not a separate component library:

| Component/pattern | Use and behavior |
| --- | --- |
| `Flower({large})` | Decorative wordmark/hero SVG, hidden from accessibility tree. |
| `AddressLink({address,config})` | Short address; full accessible value; runtime-derived explorer URL. |
| `.button`, `.primary`, `.secondary`, `.full` | Filled next step, outlined supporting action, optional full width; native disabled and visible focus. |
| `.count-option` | Real radio input with fieldset/legend; arrow keys; redundant selection cues. |
| `.amount-input` | Decimal field with KUDO unit; exact precision and field-linked errors. |
| `.approval-note` | Exact approval then separate give; matching plan/allowance required. |
| `.wallet-card`, `.balances` | Quota, account and KUDO state; disconnected values are dashes. |
| `.notice`, `.error`, `.field-error` | Persistent status/errors; polite progress and urgent/inline alerts. |
| `.leaderboard` | Semantic table with loading, empty, failed and complete states plus block provenance. |

Focus uses a 3px outline at 4px offset, yellow on the dark panel. Buttons are normally at least 48px high, with 44px mobile header controls. Unavailable writes explain their prerequisites. The only motion is a 120ms background/scale transition and `.96` press scale under `prefers-reduced-motion: no-preference`. No dialogs, autoplay, entrances, theme transitions or dragging exist.

## Do's and Don'ts

Reuse `.shell`, semantic colors, type roles and native form/button patterns. Keep a single filled next action, show token totals before signing, and preserve exact values and recoverable errors. An additional section should use a heading/card or normal-flow group and be checked at 320/800px with realistic addresses and values.

Do not replace controls with clickable containers, treat short addresses as complete identity, use separators as text colors, add an independent deployment map or remove transaction gates for styling. New routes require static export or hash navigation. Do not introduce themes or motion merely to fill a checklist.

## Attribution

Design guidance adapted from Jakub Krehel's Better Interface (MIT), pinned `267330e1adfc66a718fb65fa6918c1f06d0a689e`: <https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface>. Documentation method adapted from Paul Bakaus's Impeccable (Apache-2.0), pinned `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`: <https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md>. Each upstream retains its own license. The supplied reference was read locally; this document records the final implementation.
