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
rounded:
  sm: "8px"
  md: "10px"
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

**The State-Only Accent Rule.** Use green, amber, and red to communicate gateway state. Do not use them as decorative branding or arbitrary emphasis.

## Typography

**Display Font:** Plus Jakarta Sans Variable (with Plus Jakarta Sans and system sans fallbacks)
**Body Font:** Plus Jakarta Sans Variable (with Plus Jakarta Sans and system sans fallbacks)
**Label/Mono Font:** Plus Jakarta Sans with tabular numerals for measurements

**Character:** The type system is compact, neutral, and highly readable at dashboard scale. Weight and spacing create hierarchy; there is no separate display face.

### Hierarchy
- **Metric** (650, 31–32px, 1): High-value counts and totals; use negative tracking around `-0.04em`.
- **Title** (650, 15px, 1.25): Panel and section headings.
- **Body** (400, 11–12px, 1.4): Descriptions, table values, and controls.
- **Label** (700, 9–10px, 1.2): Uppercase table headers and metric labels with positive tracking.

**The Numeric-Clarity Rule.** Apply tabular numerals to requests, latency, usage, percentages, and other values users compare vertically.

## Layout

The application uses a fixed floating sidebar (`240px`, inset `10px`) beside a flexible main content area. The main content reserves space for the sidebar and uses a top bar plus a centered page wrap with a maximum width near `1440px`. Dashboard content is organized as a two-column grid: a wide operational surface and a narrower summary surface, collapsing to one column at tablet widths.

Spacing follows a compact 4/8px rhythm with common insets of `18–22px`. Tables use horizontal overflow on narrow screens; the sidebar becomes an off-canvas mobile drawer with a scrim below `760px`.

## Elevation & Depth

Depth comes from tonal layering and soft ambient shadows rather than hard outlines. Panels use a hairline border plus a low, diffuse shadow; the sidebar and toast use stronger floating shadows and backdrop blur because content can pass behind them.

### Shadow Vocabulary
- **Panel ambient** (`0 1px 2px rgba(0, 0, 0, 0.03), 0 6px 20px rgba(0, 0, 0, 0.04)`): Default cards and metric bands.
- **Floating chrome** (`0 1px 1px rgba(0, 0, 0, 0.04), 0 12px 32px rgba(0, 0, 0, 0.08)`): Sidebar and elevated navigation surfaces.
- **Toast pop** (`0 12px 32px rgba(0, 0, 0, 0.14)`): Transient feedback only.

**The Layered-Surface Rule.** Keep resting content surfaces flat and let tonal contrast, one-pixel separators, and soft ambient shadows establish hierarchy.

## Shapes

The form language is gently rounded but controlled. Panels and section shells use `18px` corners, the floating sidebar uses `22px`, and compact controls use `8–10px`. Pills are reserved for status tags and never used as the default shape for large controls. Borders are one-pixel neutral hairlines.

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

## Do's and Don'ts

### Do:
- **Do** preserve the neutral-first canvas and reserve semantic color for gateway state.
- **Do** use Plus Jakarta Sans and tabular numerals for operational data.
- **Do** keep panels in the `18px` radius family and controls in the `8–10px` family.
- **Do** keep glass and blur limited to surfaces that float above content.
- **Do** provide keyboard-visible focus and responsive mobile drawer behavior.

### Don't:
- **Don't** introduce gradients, decorative patterns, or arbitrary bright accents.
- **Don't** use pills for large buttons, cards, or navigation containers.
- **Don't** turn every metric into a separate floating card; preserve the band and panel compositions.
- **Don't** use monospace as a generic technical costume; reserve tabular numerals for measured data.
- **Don't** use green, amber, or red for branding or emphasis unrelated to operational state.
