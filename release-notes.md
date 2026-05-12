# AIRI v0.9.1-stable.20260512

## What's New
* **Spine Integration:** Comprehensive Spine support (Phase 1) including extended animation and audio support (via `model0` manifests), bone-based tactile interaction, and independent animation overlays. Special shoutout to **ny** for creating this entire feature.
* **Unified Web Experience:** Massive update to the Web surface, porting all major Tamagotchi features to the web view. This includes full UI parity for the interaction area, redesigned motions tab, and enhanced model positioning.
* **Artistry (Web):** Enabled full ComfyUI support for the Web surface, allowing for autonomous artistry and visual generation directly in the browser view.
* **Core Systems:** Migrated positioning logic for Spine, Live2D, and VRM to a centralized `usePositioningStore`. Ported high-precision position tuning controls to the Tamagotchi renderer.
* **MMD:** Checkpointed new MMD extraction and loading architecture. Big shoutout to **ny** for the foundational work on MMD support.

## Compatibility & Fixes
* **Platform Stability:** Fixed critical white screen crashes on iOS and resolved macOS codesigning errors.
* **Build Optimization:** Resolved a series of build failures including `TGALoader.js` resolution, missing MMD type definitions, and redundant ASAR bloat via aggressive pruning.
* **Chat Reliability:** Implemented system message rolling for improved Gemini compatibility and fixed tool-call bridging regex issues.
* **UI Refinement:** Harmonized wide and portrait views with premium glassmorphic styling and redesigned the mobile portrait rail for better accessibility.
