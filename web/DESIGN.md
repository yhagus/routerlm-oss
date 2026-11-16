---
name: RouterLM
description: Provider-neutral LLM routing gateway control plane for platform teams.
colors:
  ink: "#1d1d1f"
  ink-secondary: "#424245"
  muted: "#6e6e73"
  paper: "#f5f5f7"
  panel: "#ffffff"
  panel-secondary: "#fafafc"
  line: "#e3e3e8"
  line-soft: "#ededf0"
  chip: "#f2f2f7"
  faint: "#76767b"
  accent-success: "#248a3d"
  accent-warning: "#b25000"
  accent-danger: "#ff3b30"
  glass: "rgba(255, 255, 255, 0.62)"
  track: "#e8e8ed"
  bar-fill: "#aeaeb2"
typography:
  body:
    fontFamily: "Plus Jakarta Sans Variable, Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  reading:
    fontFamily: "Plus Jakarta Sans Variable, Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  meta:
    fontFamily: "Plus Jakarta Sans Variable, Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
  title:
    fontFamily: "Plus Jakarta Sans Variable, Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  metric:
    fontFamily: "Plus Jakarta Sans Variable, Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 650
    lineHeight: 1
    letterSpacing: "-0.04em"
  label:
    fontFamily: "Plus Jakarta Sans Variable, Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.12em"
  # Docs reading ramp (/docs/**, /id/docs/**): the same faces, compact reading
  # sizes. JetBrains Mono for code and literal values only.
  docs-title:
    fontFamily: "Plus Jakarta Sans Variable, Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.035em"
  docs-section:
    fontFamily: "Plus Jakarta Sans Variable, Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  docs-section-compact:
    fontFamily: "Plus Jakarta Sans Variable, Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  docs-subsection:
    fontFamily: "Plus Jakarta Sans Variable, Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  docs-lede:
    fontFamily: "Plus Jakarta Sans Variable, Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  docs-lede-compact:
    fontFamily: "Plus Jakarta Sans Variable, Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  docs-body:
    fontFamily: "Plus Jakarta Sans Variable, Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  docs-table:
    fontFamily: "Plus Jakarta Sans Variable, Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  docs-value:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.35
  docs-code:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  xs: "6px"
  sm: "8px"
  md: "10px"
  box-sm: "12px"
  box: "14px"
  lg: "18px"
  xl: "22px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "21px"
  xxl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "38px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "38px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "18px 21px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 11px"
    height: "34px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "9px 10px"
    height: "36px"
  model-bar:
    backgroundColor: "{colors.panel-secondary}"
    textColor: "{colors.ink}"
    padding: "12px 14px 12px 16px"
  route-list-item:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "11px 14px"
  route-list-item-blocked:
    backgroundColor: "{colors.panel-secondary}"
    textColor: "{colors.ink}"
  segmented:
    backgroundColor: "{colors.track}"
    rounded: "{rounded.sm}"
    padding: "2px"
  segmented-option:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.body}"
    padding: "0 12px"
    height: "26px"
  segmented-option-active:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
  sheet:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "20px"
    width: "380px"
  docs-title-cells:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.docs-value}"
    padding: "10px 18px"
  docs-figure:
    backgroundColor: "{colors.panel-secondary}"
    textColor: "{colors.ink}"
    typography: "{typography.docs-code}"
    rounded: "{rounded.box-sm}"
    padding: "12px 14px"
  docs-figure-header:
    backgroundColor: "{colors.panel-secondary}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.body}"
    padding: "5px 6px"
    height: "38px"
  docs-table:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.docs-table}"
    rounded: "{rounded.box-sm}"
    padding: "11px 14px"
  docs-table-head:
    backgroundColor: "{colors.panel-secondary}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    padding: "8px 12px"
  docs-sheet:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "26px 36px 22px"
    width: "980px"
  docs-pager-link:
    backgroundColor: "{colors.panel-secondary}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.box-sm}"
    padding: "11px 14px 12px"
  docs-search-dialog:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    width: "620px"
---

# Design System: RouterLM

## Overview

**Creative North Star: "The Quiet Control Plane"**

RouterLM presents operational complexity through a calm, familiar macOS-inspired workspace. The interface is compact and information-dense, but its neutral canvas, restrained type scale, and carefully separated surfaces keep routing and provider health legible during production work.

The visual language uses light and dark tonal layers, floating glass navigation, crisp white panels, and small system-color signals for health. Motion is brief and functional: controls respond with subtle color or scale changes, and transient feedback rises in a small glass toast.

**Key Characteristics:**
- Neutral light and dark themes with shared semantic roles.
- Floating sidebar and top bar with blur reserved for chrome and transient feedback.
- Compact data tables and metric bands with tabular numerals.
- Green, amber, and red reserved for operational state.
- The public client docs share every token and shape; only their reading ramp and page structure are their own (see Docs Surface).

## Colors

The palette is predominantly Apple-style neutral gray, with one semantic accent family for operational state. Dark mode maps the same roles to near-black and graphite surfaces.

### Primary
- **Graphite Ink** (`#1d1d1f`): Primary text, active navigation, and the readable foreground of light surfaces.

### Secondary
- **Operational Green** (`#248a3d`): Healthy, resolved, and improving states.
- **Operational Amber** (`#b25000`): Degraded, warning, and attention states.

### Tertiary
- **System Red** (`#ff3b30`): Destructive or failed states when they are introduced.

### Neutral
- **Paper Gray** (`#f5f5f7`): Application canvas.
- **Panel White** (`#ffffff`): Primary cards, controls, and table bodies.
- **Secondary Panel** (`#fafafc`): Lead metric surfaces and quiet table headers.
- **Secondary Ink** (`#424245`): Supporting data and navigation labels.
- **Muted Gray** (`#6e6e73`): Metadata, labels, and secondary controls.
- **Hairline** (`#e3e3e8`): Structural borders and separators.
- **Soft Hairline** (`line-soft`): Separators inside a panel: Model bar base, Route list rows, the receipt rule.
- **Chip Gray** (`chip`): Chips, the user's message bubble, and the muted fill vendored components call `secondary` / `muted`.
- **Faint Gray** (`faint`): The quietest meta text: Route order numbers, composer hint, empty Model bar parameters.

**The State-Only Accent Rule.** Use green, amber, and red to communicate gateway state. Do not use them as decorative branding or arbitrary emphasis.

## Typography

**Display Font:** Plus Jakarta Sans Variable (with Plus Jakarta Sans and system sans fallbacks)
**Body Font:** Plus Jakarta Sans Variable (with Plus Jakarta Sans and system sans fallbacks)
**Label/Mono Font:** Plus Jakarta Sans with tabular numerals for measurements

**Character:** The type system is compact, neutral, and highly readable at dashboard scale. Weight and spacing create hierarchy; there is no separate display face.

### Hierarchy
- **Metric** (650, 31–32px, 1): High-value counts and totals; use negative tracking around `-0.04em`.
- **Title** (650, 15px, 1.25): Panel and section headings.
- **Reading** (400, 13px, 1.55): Prose people read rather than scan: conversation messages, the streamed Markdown answer, the composer input, and the page subtitle.
- **Body** (400, 12px, 1.4): Descriptions, table values, and controls.
- **Meta** (400, 11px, 1.4): Secondary facts beside data: Route meta lines, session totals, the composer hint, empty-state notes in a toolbar.
- **Label** (700, 9–10px, 1.2): Uppercase table headers and metric labels with positive tracking.

**The Reading-Size Rule.** Conversation text reads at 13px; data, controls and receipts stay at 12px, and meta at 11px. Code inside an answer drops back to 12px. Below 760px the composer input rises to 16px so mobile browsers don't zoom on focus.

**The Numeric-Clarity Rule.** Apply tabular numerals to requests, latency, usage, percentages, and other values users compare vertically.

## Layout

The application uses a fixed floating sidebar (`240px`, inset `10px`) beside a flexible main content area. The main content reserves space for the sidebar and uses a top bar plus a centered page wrap with a maximum width near `1440px`. Dashboard content is organized as a two-column grid: a wide operational surface and a narrower summary surface, collapsing to one column at tablet widths.

Spacing follows a compact 4/8px rhythm with common insets of `18–22px`. Tables use horizontal overflow on narrow screens; the sidebar becomes an off-canvas mobile drawer with a scrim below `760px`.

Work surfaces that need the whole window (the Playground) use a bench layout: a full-height chat panel (header bar, scrolling log, pinned composer) beside a sticky `300px` settings rail. Below `1100px` the rail leaves the page and its contents open in a sheet from a button in the bar: a side sheet inset `10px` from the right edge from `760px` up, a bottom sheet (full width, at most `88dvh`, safe-area padded) below `760px`. On mobile the page heading shrinks to one row and the Model bar wraps to two rows so the composer stays on screen.

## Elevation & Depth

Depth comes from tonal layering and soft ambient shadows rather than hard outlines. Panels use a hairline border plus a low, diffuse shadow; the sidebar and toast use stronger floating shadows and backdrop blur because content can pass behind them.

### Shadow Vocabulary
- **Panel ambient** (`0 1px 2px rgba(0, 0, 0, 0.03), 0 6px 20px rgba(0, 0, 0, 0.04)`): Default cards and metric bands.
- **Floating chrome** (`0 1px 1px rgba(0, 0, 0, 0.04), 0 12px 32px rgba(0, 0, 0, 0.08)`): Sidebar and elevated navigation surfaces.
- **Toast pop** (`0 12px 32px rgba(0, 0, 0, 0.14)`): Transient feedback only.
- **Sheets** take the floating chrome shadow, because they sit above the page.
- **Segmented thumb** (`0 1px 2px rgba(0, 0, 0, 0.08)`): Lifts the selected option off its track; nothing else.

**The Layered-Surface Rule.** Keep resting content surfaces flat and let tonal contrast, one-pixel separators, and soft ambient shadows establish hierarchy.

## Shapes

The form language is gently rounded but controlled. Panels and section shells use `18px` corners, the floating sidebar uses `22px`, and compact controls use `8–10px`. Pills are reserved for status tags and never used as the default shape for large controls. Borders are one-pixel neutral hairlines.

The family also holds three in-between steps, each with a fixed job: `6px` for small tags and literals (chips such as the Docs tag and page counter, `kbd` shortcuts, inline code), `12px` for list and table boxes (data tables in the docs, the Route list), and `14px` for content boxes that sit inside a page (code figures, pager cards, the composer field). Vendored Tailwind components read the same family through their radius scale (`6 / 8 / 10 / 14 / 18px`). The user's message bubble takes `14px` with its bottom-right corner tightened to `4px` toward the composer side. Sheets and dialogs keep the `18px` panel radius; the bottom sheet rounds only its top corners.

## Components

### Buttons
- **Shape:** Compact rounded rectangles (`8px`; primary action `10px`) at `38px` height.
- **Primary:** White or graphite tonal surface with readable foreground, medium weight, and a restrained one-pixel outline.
- **Hover / Focus:** Shift surface and foreground through neutral theme tokens; focus uses a `3px` outline with `2px` offset.
- **Quiet:** Transparent, low-emphasis action with the same height and icon-plus-label spacing.

### Chips
- **Style:** Small pill status tags use semantic green or amber text over a matching low-contrast surface.
- **State:** Chips communicate state or category; they are not used for primary navigation.

### Cards / Containers
- **Corner Style:** `18px` panel radius, `1px` soft border.
- **Background:** White panel over paper-gray canvas; dark mode swaps to graphite surfaces.
- **Shadow Strategy:** Panel ambient shadow at rest, with stronger floating shadow only for chrome.
- **Internal Padding:** Common panel heading and content inset is `18–21px`.

### Inputs / Fields
- **Style:** Compact transparent or panel-filled controls with a one-pixel neutral border, `8px` radius, and inline Lucide icon.
- **Focus:** High-contrast theme-aware outline (`3px`, `2px` offset) without layout shift.
- **Error / Disabled:** Use semantic state colors and preserve the same dimensions.

### Navigation
- **Style:** Fixed, floating glass source list with `28px` blur and `22px` radius. Items are compact, left-aligned, and icon-led.
- **States:** Active items use a stronger neutral fill; hover uses a lighter neutral tint. Mobile navigation becomes a drawer.

### Data Tables
- **Style:** Uppercase, tracked headers; one-pixel row separators; tabular values; horizontal scrolling below the layout breakpoint.
- **Behavior:** Row hover is a subtle neutral wash. Empty states explain the condition and provide a clear recovery action.

### Model Bar
- **Style:** Full-width bar across the top of the chat panel on the secondary panel surface, with a soft hairline beneath. Left to right: Model picker, active-parameter chips (or a faint 11px "defaults" note), session totals, then Code and Settings tools pushed right.
- **Totals:** A compact `30px` outlined box on panel white, 11px tabular figures separated by faint middots; hover strengthens border and ink and opens the full breakdown.
- **Mobile:** Tools collapse to `38px` icon buttons and parameters and totals wrap to a second row.

### Route List
- **Style:** An ordered list in one soft-hairline box (`12px` radius) with row separators. Each row: faint tabular order number, small provider mark (`28px`), upstream model id in 650 weight with an 11px meta line, then capability chips on the right.
- **Blocked rows:** A Route that cannot serve sits on the secondary panel surface with its mark and text at 55% opacity, and its reason in a warning status badge at full strength. This is the only place the Route chain uses state colour.

### Receipt
- **Style:** A ruled footer under each answer: a soft hairline above, `12px` top padding, no box, no fill, no shadow. First line: the serving Route in a chip, provider and account on the right. Second line: facts as uppercase tracked labels over 12px tabular values, `22px` apart; a three-column grid below `760px`.

**The Ruled-Receipt Rule.** Under an answer, separate with a hairline, never a card; the answer stays the subject.

### Segmented Control
- **Style:** Options sit on a track-gray tray (`8px` radius, `2px` inset); each option is `26px` high, `6px` radius, 12px secondary ink. The pressed option turns panel white, ink, 600 weight, with the segmented thumb shadow. Use for two-to-four mutually exclusive views (request as curl or TypeScript).

### Sheets
- **Style:** A panel-white surface with a glass hairline border, `18px` radius, `20px` padding, floating chrome shadow; header with title and close, a full-width Done button at the foot. Side sheets enter with a `24px` slide (`0.32s`, `cubic-bezier(0.16, 1, 0.3, 1)`), bottom sheets with a `32px` rise; exit is a quick `0.18s` ease-in. No motion with reduced motion.

### Vendored Components (shadcn-vue, AI Elements)
- **Colour:** They take their colours from the RouterLM tokens through the Tailwind theme bridge: background, card and popover are panel white; primary is ink; secondary and muted are chip gray; accent is the control hover tint; border and input are the hairline; ring is the focus colour. Dark mode follows the same theme switch as the rest of the app.
- **Restyling:** Adjust them with Tailwind classes on their `class` prop, referencing the tokens (`var(--panel-2)`, `var(--line-soft)`). Third-party roots that read shadcn variable names get those names mapped locally on their own root.

**The Token-Bridge Rule.** Vendored components inherit DESIGN.md tokens; they never bring their own palette, and shadcn's global `--primary` / `--muted` variables stay undefined because those names already mean something else here.

## Do's and Don'ts

### Do:
- **Do** preserve the neutral-first canvas and reserve semantic color for gateway state.
- **Do** use Plus Jakarta Sans and tabular numerals for operational data.
- **Do** keep panels in the `18px` radius family and controls in the `8–10px` family; use `6px`, `12px` and `14px` only for the jobs recorded in Shapes.
- **Do** keep glass and blur limited to surfaces that float above content.
- **Do** provide keyboard-visible focus and responsive mobile drawer behavior.
- **Do** set conversation text at 13px and keep data, receipts and controls at 12px.
- **Do** restyle vendored shadcn-vue and AI Elements components with Tailwind classes on their `class` prop.

### Don't:
- **Don't** introduce gradients, decorative patterns, or arbitrary bright accents.
- **Don't** use pills for large buttons, cards, or navigation containers.
- **Don't** turn every metric into a separate floating card; preserve the band and panel compositions.
- **Don't** use monospace as a generic technical costume; reserve tabular numerals for measured data.
- **Don't** use green, amber, or red for branding or emphasis unrelated to operational state.
- **Don't** target vendored components with dashboard stylesheet rules, or define shadcn's colour variables globally.
- **Don't** box a receipt or other answer footnote in a card; rule it off with a hairline.

## Docs Surface

**Scope.** The public client docs (`/docs/**`, `/id/docs/**`), rendered by the docs layout with a stylesheet (`docs.css`, classes prefixed `ds-`) that loads only there. **Same theme, its own structure.** The docs share every token, the type faces and the shape family in this file: no palette of their own, colours, shadows, focus and z-order read from the dashboard's root, the same light and dark switch, and the shared brand, icon button, segmented control and primary button used as they are. Their layout is deliberately not the dashboard's: the docs are a separate public surface for client developers, so they use no floating glass sidebar, no glass top bar and no panel grid. This section records what is specific to the docs.

**The Same-Theme, Own-Structure Rule.** Docs take every token and shape from this file and never the dashboard's shell. Dashboard pages never take the docs shell.

### Shell
- **Header:** Full width, sticky, `56px`, solid paper with a `1px` hairline beneath (no glass). Its content lines up with the body's edges (at most `1320px`). Left: the brand (16px, `26px` mark), a "Docs" chip (`6px`, chip gray, 11px 600), then "Client API" and the page counter (03/09) in 12px faint after a hairline divider. Centre: the search field (`34px`, `8px`, up to `420px`; ⌘K / Ctrl K in a chip). Right: language as the segmented control, the theme icon button, Sign in or Dashboard as the primary button at `32px`.
- **Contents:** A flat column on the paper canvas (`220px`, `196px` below `1100px`), sticky under the header: no panel, no glass, no border. A faint uppercase label, then pages at 13px in `30px` rows (`8px` radius) with faint tabular numbers 01–09; hover is the control hover fill. The current page lifts like a segmented thumb: panel white, soft hairline, `0 1px 2px` shadow, ink 600. Its numbered sections hang from a `1px` hairline guide at 12px muted; the one being read turns ink 600.
- **Sheet:** Each page sits on one white sheet beside the contents: `18px`, soft hairline, panel ambient shadow, `26px 36px` inset (`22px 26px` below `1100px`), at most `980px`. Everything inside is recessed, never another raised card.
- **Phones (below `760px`):** The header keeps the contents button, the brand and the search icon. The contents open as a drawer: an `18px` panel-white sheet inset `10px`, floating chrome shadow, a "Contents" title and close button, with language, theme and account at its foot; rows grow to `44px`. The sheet runs edge to edge with no radius, border or shadow, inset `20px 16px`.

### Reading Type
Compact: the reader should see the endpoint, the first request figure and the next section without scrolling far.
- **Title** (`docs-title`): 28px 700, `-0.035em`, balanced wrap; 24px on phones. Description 13px muted at `70ch`.
- **Lede** (`docs-lede`): 16px, 1.55, secondary ink; 15px on phones.
- **Section** (`docs-section`): Numbered h2, 20px 700, under a soft hairline, `30px` above and `18px` padding (18px and `26px` on phones).
- **Subsection** (`docs-subsection`): Numbered h3, 15px 650, `20px` above.
- **Body** (`docs-body`): 15px, 1.6, paragraphs `12px` apart. Links are ink with a `1px` underline in the focus-border colour that turns to ink on hover. Inline code is mono at `0.84em` in a `6px` secondary-panel box with a soft hairline.
- **Table** (`docs-table`, 13px), **Value** (`docs-value`, mono 13px 600), **Code** (`docs-code`, mono 12.5px, 1.6).
- **Labels** (contents label, cell terms, figure captions, table heads, pager directions) use the dashboard's uppercase tracked label.

**The Reading-Measure Rule.** Prose, lede and lists read at `72ch`; only the title block, code figures and tables take the sheet's full width.

**The Literal-Mono Rule.** JetBrains Mono sets code figures, inline code and the title block's literal values (endpoint, page, revision); never labels, headings or prose.

**The Numbered Sheet Rule.** Sections carry page.section numbers and subsections page.section.subsection, set before the heading in faint tabular numerals; figures are captioned FIG. with the two-digit page and the figure count (FIG. 03-1). Every number comes from CSS counters reset per page, so they always match the contents.

### Title Block
- **Style:** The heading and description, then one ruled row of data cells between soft hairlines (no panel): a label term over a mono value per cell (`10px 18px`, the first flush left), cells divided by soft hairlines, and a Copy page button (`32px`, `8px`, hairline) at the right end.
- **Narrow:** Under a `700px` main column the endpoint takes a whole row and the rest share the next; on phones Copy grows to `40px`.
- **Error:** A 15px 650 message and an underlined recovery link replace the heading on the sheet.

### Code Figure
- **Style:** A recessed `12px` box on the sheet: soft hairline, secondary panel fill, no shadow, `12px` above and `18px` below. Header (`38px`): the segmented control for curl / TypeScript (`24px` options), or a single 12px 600 label, with a quiet Copy button (`26px`, `6px`) pushed right. Code at `12px 14px`. A caption row (FIG. 03-1 · label) in faint label type under a soft hairline.

### Table
- **Style:** A `12px` box with a soft hairline on the sheet. Head row on the secondary panel surface in label type (`8px 12px`); body rows 13px divided by soft hairlines, row hover wash, tabular numerals; first column ink and unwrapped. Wide tables scroll inside the box (`34rem` minimum).
- **Phones:** Each row becomes a record; every cell prints its column head above it in label type. With three or more columns, the first two cells head the record on one line (400 · invalid_request).

### Pager
- **Style:** At the foot of the sheet, `32px` below the last section: previous and next as two recessed `12px` boxes (soft hairline, secondary panel fill, no shadow, `10px` apart), each a label direction over a 14px 650 title with a faint tabular page number; hover strengthens the border and washes with row hover. A faint 11px imprint line closes the sheet. On phones the boxes stack.

### Search
- **Style:** A native modal dialog shaped like a sheet: `620px`, `18px`, glass hairline border, floating chrome shadow, over a 25% black backdrop (50% in dark) with `2px` blur. A `44px` field (`10px`, focus ring on focus-within), then results grouped by page (numbered, 600) with section rows indented beneath; matches in highlight marks.
- **States:** The highlighted row takes the nav active fill; a failed search reports in danger ink.

### Section Heading Anchor
- **Style:** A `24px`, `6px` muted link icon after the heading, shown on hover or focus (always on touch screens), with the control hover fill.
