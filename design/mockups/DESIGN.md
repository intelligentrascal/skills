---
version: 1
name: grilling-ui · Paper & Pill
description: >-
  A quiet document interface for grilling sessions. The page is warm paper, text is near-black,
  there is one action blue for links, focus and selection, and one near-black pill for the single
  primary action. Five pastel tints each mean one question state. The agent's visual is the only
  thing that gets a shadow. Blends Apple's restraint (SF type, hairlines, material bars, one accent)
  with Craft's document feel (warm canvas, serif display with tight tracking, soft radii, pastel blocks).
source: design/mockups/theme-studio.css   # canonical; this file documents it

colors:
  paper: "#fbf8f4"        # page canvas
  paper-2: "#f4efe9"      # grouped fill, hover wash, segmented track
  surface: "#fffefc"      # cards, sheets, panes
  material: "rgb(251 248 244 / 0.82)"     # sticky bars + backdrop blur(20px) saturate(180%)
  material-hi: "rgb(255 254 252 / 0.86)"  # sticky headers inside white panes
  hairline: "#e8e2da"     # dividers, card borders
  hairline-2: "#d6cec4"   # inputs, secondary buttons, hover borders
  ink: "#1d1c1a"          # 16.1:1 on paper
  ink-2: "#57534d"        # 7.2:1, secondary copy
  ink-3: "#6b665f"        # >= 4.6:1 on paper, paper-2, surface, stone: meta text
  on-ink: "#fbf8f4"
  blue: "#0066cc"         # the one accent: links, focus ring, current item, selected card (5.3:1)
  blue-press: "#00529f"
  pill: "#1d1c1a"         # the one primary surface
  pill-hover: "#34322e"
  pill-press: "#0e0d0c"
  butter: "#fcefc2"       # open / needs you / a region of the visual
  butter-ink: "#6a4f00"
  butter-wash: "#fdf7e2"
  peach: "#fde5d6"        # reopened / out of date
  peach-ink: "#8f3f16"
  peri: "#e4e9fb"         # staged: yours, not sent yet
  peri-ink: "#2d43a0"
  peri-wash: "#f2f5fd"
  peri-line: "#b3c0ef"
  mint: "#e2f2e5"         # decided
  mint-ink: "#276238"
  stone: "#eeeae4"        # deferred, neutral chip
  stone-ink: "#57534d"
  ochre: "#8a5a12"        # the outline the visual draws on hovered regions (fixed by the linkage listener)

typography:
  display: 'ui-serif, "New York", Charter, "Iowan Old Style", Georgia, serif'  # Safari: New York; Chrome: Charter
  ui: '-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", sans-serif'   # SF Pro on Apple platforms
  mono: 'ui-monospace, "SF Mono", Menlo, monospace'                            # file paths only
  scale:
    doc-title:  { family: display, size: 44px, weight: 400, lineHeight: 1.06, tracking: -0.022em }  # Brief h1 (32px < 760)
    title1:     { family: display, size: 40px, weight: 400, lineHeight: 1.08, tracking: -0.022em }  # empty-state head
    section:    { family: display, size: 30px, weight: 400, lineHeight: 1.2,  tracking: -0.022em }
    title2:     { family: display, size: 24px, weight: 400, tracking: -0.022em }                   # rail head
    subsection: { family: display, size: 22px, weight: 400, tracking: -0.012em }
    title3:     { family: display, size: 20px, weight: 400, lineHeight: 1.25, tracking: -0.012em } # question title
    lead:       { family: ui, size: 17px, weight: 400, lineHeight: 1.5 }
    callout:    { family: ui, size: 16px, weight: 400, lineHeight: 1.55 }  # Brief prose lines
    body:       { family: ui, size: 15px, weight: 400, lineHeight: 1.47, tracking: -0.006em }
    sub:        { family: ui, size: 14px }
    footnote:   { family: ui, size: 13px }   # controls, bars
    caption:    { family: ui, size: 12px, weight: 500-600 }  # chips, qids (tabular-nums)

spacing: { base: 4px, sp-1: 4px, sp-2: 8px, sp-3: 12px, sp-4: 16px, sp-5: 20px, sp-6: 24px, sp-8: 32px, sp-10: 40px, sp-12: 48px, sp-16: 64px }
rounded: { chip: 6px, row: 10px, tile: 12px, card: 18px, sheet: 22px, pill: 999px }
elevation:
  flat: none                       # everything by default
  hairline: "1px solid {colors.hairline}"
  material: "backdrop-filter: saturate(180%) blur(20px) over {colors.material}"
  product: "0 12px 32px -10px rgb(29 28 26 / 0.18)"   # ONLY the visual (iframe / figure)
motion:
  ease-out: "cubic-bezier(0.16, 1, 0.3, 1)"
  ease-in-out: "cubic-bezier(0.65, 0, 0.35, 1)"   # status pulse only
  press: 100ms   # scale(0.98) on buttons
  hover: 160ms   # colour / border only
  enter: 260ms   # toast
  focus: 0ms     # rings never animate

components:
  button-primary:   { bg: pill, text: on-ink, radius: pill, padding: "8px 18-20px", weight: 600 }   # one per view: Send
  button-secondary: { bg: surface, text: ink, border: "1px hairline-2", radius: pill, padding: "6px 14px" }
  button-ghost:     { bg: transparent, text: ink-2, hover: paper-2 }
  option-row:       { bg: surface, border: "1px hairline", radius: tile, padding: "8-10px 12-14px", key: "22px round well" }
  option-recommended: { border: "1px dashed peri-ink", bg: peri-wash, label: "Recommended" }
  option-staged:    { border: "1px solid peri-ink", bg: peri, key: "filled peri-ink, surface letter", label: "Staged" }
  option-chosen:    { border: mint-ink, bg: mint, key: "filled mint-ink" }
  question-card:    { bg: surface, border: "1px hairline", radius: card, padding: "20px 24px (Brief) / 16px 20px (Studio)" }
  state-chip:       { font: "caption 600, sentence case", radius: chip, lineHeight: 20px }
  textarea:         { bg: surface, border: "1px hairline-2", radius: tile, focus: "border blue + 3px blue halo, instant" }
  bar:              { bg: material, border: "1px hairline", height: "56-60px" }
  segmented:        { track: paper-2, thumb: "surface + 1px hairline-2 ring", radius: pill }
  toggle:           { track: "30x18 hairline-2 → pill", knob: surface }
  toast:            { bg: pill, text: on-ink, radius: pill }
  visual-frame:     { bg: surface, border: "1px hairline", radius: sheet, shadow: product }
---

# grilling-ui · Paper & Pill

The design system for the Brief and Studio layouts, and the one to reuse when the real page is built (plan milestone 7). The canonical values are in `theme-studio.css`. It loads after `skills/grilling-ui/page/tokens.css` and points that file's old variable names at this palette.

## Overview

A grill is a long working document: many questions have been settled, a few are open, and there is one agent-drawn visual. So the interface should read like a document and act like a tool:

- **Paper, not white.** The page is warm paper (`paper`). Cards and panes are one step lighter (`surface`). Depth comes from surface steps and 1px hairlines, not shadows.
- **One accent, one pill.** Action blue marks what you can follow or what has focus: links, focus rings, the current contents item and the selected card. The near-black pill appears once per view, on the action that ends a turn: **Send**. Nothing else is saturated.
- **Tints mean states.** Each of the five pastels names one question state, and the same tint means the same state everywhere: rail counts, chips, option rows, the composer target chip and the summary pills.
- **The visual is the product.** It is the only element with a shadow. It rests on the page the way Apple product photos rest on their tiles. Its hover outline is ochre, and every "In visual" mark in the page repeats that ochre so the two are clearly linked.

## Colour

| Tint | Surface / ink | Means | Where |
|---|---|---|---|
| butter | `#fcefc2` / `#6a4f00` | open: needs you. Also: a region of the visual | "Open" chip, rail counts, "N waiting · next" pill, current-round count, `visual` composer chip, linked-question chips when lit, visual-feedback bubbles, card flash after a region click |
| peach | `#fde5d6` / `#8f3f16` | reopened, or out of date | "Reopened" chip, stale-visual banner, the strikethrough on "Was" |
| periwinkle | `#e4e9fb` / `#2d43a0` | staged: chosen here, not sent | staged option, staged chip, staged bubbles (dashed), staged count in the send bar, rail dot. The recommendation is the dashed, washed version of this tint (`peri-wash`), because it is effectively staged in advance |
| mint | `#e2f2e5` / `#276238` | decided | settled count, ✓ marks, chosen option, `answer` composer chip |
| stone | `#eeeae4` / `#57534d` | deferred, neutral | deferred count, "Rec updated", `thread` composer chip, the disabled pill |

Rules:
- Every text pair is at least **4.5:1**. `ink-3` is the lightest text colour and is at least 4.6:1 on `paper`, `paper-2`, `surface` and `stone`. Checked with tastemaker `check_contrast.py`, and with a browser sweep of every rendered text node at 1440 and 320 px, including staged states.
- Templates contain no raw colour values. Everything goes through `var(--…)`.
- Blue never fills a surface. The only filled surface is the pill.
- No gradients, no pure `#000` or `#fff`, no coloured glows.

## Typography

- **Display is serif:** `ui-serif`/New York in Safari, Charter in Chrome. Always weight 400 and upright, with tight tracking (`-0.022em` at 28 px and above, `-0.012em` below). Use it for document headings, question titles, "Conversation" and "Agreed so far".
- **UI is SF** (`-apple-system`): 15 px body, 16–17 px for Brief prose and leads, 13 px for controls, 12 px for chips. Apple tracking is `-0.006em`. Weights are 400 / 500 / 600. There is no italic anywhere.
- **Question ids** (`Q15`) use SF caption at weight 500 with tabular figures. They are not monospace.
- **Mono** is for file paths only (`→ docs/design.md`, in a `paper-2` chip).
- **Labels are sentence case**: "Open", "Staged", "Round 9 · current". There are no uppercase eyebrows or tracked caps.

## Layout

**Brief.** Three columns at 1100 px and wider: a 200 px contents rail (Apple sidebar: 10 px-radius rows, butter counts, a mint ✓ when a section is clear, blue for the current section), a 68ch document, and a sticky figure. Below 1100 px the figure sits above the document and the rail is hidden. Below 760 px everything stacks with 16 px gutters. Sections are separated by a hairline rule and 64 px of space. Settled questions are single prose lines on the paper. Open and reopened questions are white 18 px cards on the same column, and are the only boxed things in the document. The header and send bar are translucent material bars.

**Studio.** The visual pane (3fr, about 60%) sits on paper, and the conversation rail (2fr) is a white pane with a hairline border. The rail head has a 24 px serif "Conversation" and round buttons as 26 px circles, with the current round filled by the pill. Round headers are sticky material strips. Cards are hairline 18 px. Thread messages are bubbles: the agent's in grey on the left, yours in white with a hairline on the right, visual feedback in butter, staged ones in dashed periwinkle. The composer is an 18 px well with a coloured target chip and the Send pill. Below 760 px the visual (60vh) sits above the rail, the header scrolls away, and the composer stays sticky on material.

Spacing is on a 4 pt scale. Control internals use 2 px steps (Apple-style sub-grid, for example 6/10/14 px).

## States and interaction

- Every control has these states: default, hover (only on `hover: hover` devices), focus-visible (2 px blue outline with 2 px offset, instant), active (`scale(.98)`, 100 ms), disabled (stone fill, `ink-3` text), pressed/selected (blue border, no side stripe), staged (periwinkle) and pending (dashed).
- Border width never changes between states. Selected cards get a blue ring, and a card reached by clicking a region of the visual flashes a butter ring.
- Motion uses three primitives only: colour/border hover (160 ms ease-out), button press (100 ms) and toast rise (260 ms). The status dot pulse is the one loop. `prefers-reduced-motion` removes the transforms.
- Success is silent. The toast only confirms things you can't see, such as "Sent N actions as one event" or "Visualize sent".

## Do / don't

- Do use a tint only for its state. Don't add a sixth pastel for decoration.
- Do keep one pill per view. Accept A is an outlined pill (ink border) and Stage is secondary.
- Don't use side-stripe borders, card-in-card nesting, uppercase eyebrows, italic headings, or shadows on anything except the visual.
- Don't restyle the visual's own content. The agent writes it, and its `data-q` outline colour comes from the verbatim linkage listener. The page adapts to it.

## Provenance and deviations

- Studied DNA: `apple-DESIGN.md` (VoltAgent/awesome-design-md) and the Craft summary from shadcn.io/design/craft, both fetched 2026-09-25. Taken from them: warm canvas, serif display with negative tracking, near-black pill CTA, 18–24 px radii, pastel state blocks (Craft); SF type ladder and tracking, single action blue, hairlines, material bars, one product shadow (Apple). Deliberately left out: Apple's full-bleed dark marketing tiles and 12/10 px nav and legal text, and Craft's decorative use of pastels.
- System fonts only, which the brief requires. Hallmark's ban on system UI faces is overridden here because SF *is* the reference face. The pairing with a serif display keeps the page from being a one-font system page.
- `tokens.css` is still loaded for its reduced-motion rules and keyframes. Its colours are replaced, not edited.
- The fake browser bar and the rust button seen inside the visual belong to the agent-drawn prototype in `data.js`, not to this system.
