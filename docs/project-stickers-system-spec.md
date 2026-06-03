# Sticker System Specification: The Anchor Pivot & Compromise

This document details the design, architecture, and interaction models for the companion **Stickers System**. It incorporates historical context, the layout compromise, and modern aesthetic guidelines.

---

## 1. Historical Context & The Window Constraint
Originally, the stickers system was designed to allow characters to spawn standalone desktop windows anywhere on the screen (the "Futz Factor" desktop widgets) to interact with the user's workspace.

However, desktop widget support ran into OS-level window stability constraints, multi-window boundary layout issues, and desktop clutter.

---

## 2. The Refurbish Pivot: Anchored Pseudo-Stickers
Rather than spawning separate OS windows, we pivot to **anchored pseudo-stickers** rendering as absolute-positioned DOM elements within existing application containers.

### Anchor Targets
Stickers can be spawned dynamically in three primary zones:
1. **The Actor Stage Window**: Pinned directly over the character's background scene viewport, reacting dynamically to expressions and poses.
2. **The Control Strip / Island**: Anchored around the perimeter of the control panel, sliding out from behind it or sticking to its glassmorphic frame.
3. **The Chat Interface**: Placed along the margins of chat bubbles or on the border of the input field.

---

## 3. Heuristics & Core Specifications

### A. Spawning Physics & Micro-Animations
To make the interface feel alive, stickers must have spring-like physics and slight human-like imperfections:
* **Initial Scale Spring**: Spawn animation scales from `0` to `1.1` in `200ms` before settling at `1.0` to feel tactile.
* **Rotation Jitter**: Automatically apply a random rotation skew between `3°` and `8°` (clockwise or counterclockwise) so they feel manually slapped onto the UI.
* **Ambient Float**: Apply a gentle CSS translate loop (e.g. `translateY(-3px)` to `translateY(3px)` over `4s`) to mimic lifting corners.

### B. Interactive Hover Effects
* **Holographic Tilt**: On cursor hover, apply CSS 3D transforms (`rotateX` / `rotateY`) matching the pointer location, accompanied by a subtle holographic reflection sheen overlay.
* **Grab Indicator**: Cursor changes to `grab`/`grabbing` on interactable stickers, allowing users to peel or drag them slightly.

### C. Lifecycle Management
* **Auto-Pruning (Ephemeral)**: By default, character-placed stickers are ephemeral, carrying an `expiresAt` timestamp. A background interval in [stickers.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/stickers.ts) automatically filters them out after 5–15 seconds.
* **Manual Sweep**: Clicking a sticker or dragging it off its bounding box plays a fade-out peel animation and calls `removePlacement()`.
* **Cap Limits**: Bounded containers (like the Control Strip) limit active sticker counts to prevent view obstruction, automatically peeling the oldest instance once the cap is exceeded.

---

## 4. Store Architecture References

The store logic resides in [stickers.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/stickers.ts):
* `libraryMetadata`: Persists uploaded stickers in IndexedDB keyed under `sticker-data-${id}`.
* `activePlacements`: Tracks current active placements on screen including positions, scale, rotation, and expirations.
* `spawnSticker()`: Spawns instances, applying random rotation jitter.
