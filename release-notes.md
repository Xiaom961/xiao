# Release Notes: AIRI v0.9.4-stable.20260529

Welcome to **AIRI v0.9.4-stable.20260529**! This patch release delivers critical fixes to our VRM model driver system to restore lipsyncing across Electron process boundaries, introduces trigger-based memory compaction, brings UI/UX enhancements to the Control Strip, and stabilizes multi-window layouts on macOS/Windows.

## 🚀 Key Highlights

### 🎭 VRM Lipsync & Emotion Restoration (Critical Fix)
* **Cross-Process Lipsyncing**: Resolved the Electron window process boundary serialization barrier. The standalone actor window now hooks directly into the centrally broadcasted `mouthOpenSize` float to drive the VRM `'aa'` (mouth open) expression, restoring high-fidelity speech synchronization.
* **Procedural Expression Flusher**: Restored `activeVrm.expressionManager.update()` in the core update loop, resolving the regression where manual expression sliders, blinks, and ACT emotions were calculated but never rendered to the 3D meshes.

### 🧠 Trigger-Based Memory Compaction & Stats
* **Background Archival Compaction**: Implemented a trigger-based memory history compaction subsystem with background archival forking, protecting user context size from bloating while preserving long-term conversational memory.
* **Token Usage Metrics**: Added an abbreviated lifetime token counter in the chatbox toolbar alongside a comprehensive Usage Stats panel in the Control Customizer.

### 🖥️ Control Strip & Desktop Stabilization
* **Snapping & Bound Correction**: Compacted the Control Strip layouts and corrected edge-snapping coordinates.
* **Startup Position Fix**: Resolved the startup race condition that caused the Control Strip window to reset to the center of the screen on startup.
* **macOS Contention Guard**: Disabled maximizing the Actor Stage window to prevent macOS space contention and window hiding side effects.

### 🎵 local Kokoro TTS & Voice Customization
* **Voice Switch Popover**: Rolled out a clean UI popover in the Control Strip for switching local TTS voices.
* **Kokoro TTS Fixes**: Applied local Kokoro speech engine stability corrections and resolved underlying build errors.
* **MOSS TTS Specs**: Added structural specs for the upcoming MOSS local voice cloning integration.
