# AIRI Rosetta Stone

Concept-to-file-path index for rapid context retrieval. Use this to find where anything lives — UI, data, providers, modules, audio, memory, or the integration plumbing between them.

---

## 1. Application Entry & Wiring

| Concept | Path | Notes |
| :--- | :--- | :--- |
| **DI composition root** | `apps/stage-tamagotchi/src/main/index.ts` | Where services are injected via `injeca`. Start here to trace how a service gets wired. |
| **Eventa IPC contract** | `apps/stage-tamagotchi/src/shared/eventa.ts` | All typed IPC/RPC event definitions between main and renderer. |
| **Window managers** | `apps/stage-tamagotchi/src/main/windows/` | One dir per window (main, stage, chat, caption, widgets, etc.) |
| **Renderer bootstrap** | `apps/stage-tamagotchi/src/renderer/` | Vue app entry, router, layouts |
| **Web app entry** | `apps/stage-web/src/` | Analogous bootstrap for the web target |

---

## 2. Core UI & Surfaces

| Concept | Path |
| :--- | :--- |
| **Control Strip (Main Window)** | `apps/stage-tamagotchi/src/main/windows/main/index.ts` (Electron) | `packages/stage-ui/src/components/scenarios/layout/ControlStrip.vue` (UI) |
| **Actor Stage (Floating Island)** | `apps/stage-tamagotchi/src/main/windows/stage/index.ts` (Electron) | `packages/stage-ui/src/components/scenes/Stage.vue` (UI) |
| **Chatbox Window** | `apps/stage-tamagotchi/src/main/windows/chat/index.ts` (Electron) | `apps/stage-tamagotchi/src/renderer/pages/chat.vue` (UI) | `apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue` (Host) |
| **Control Island (Original)** | `apps/stage-tamagotchi/src/renderer/components/stage-islands/controls-island/index.vue` |
| **Gemini Control Island** | `.../controls-island/gemini-controls.vue` |
| **Whisperbox (Input)** | `packages/stage-ui/src/components/scenarios/chat/WhisperDock.vue` |
| **Resource Island** | `apps/stage-tamagotchi/src/renderer/components/stage-islands/resource-status-island/index.vue` |
| **VRM Character** | `packages/stage-ui-three/src/components/Model/VRMModel.vue` |
| **Live2D Character** | `packages/stage-ui-live2d/src/components/scenes/live2d/Canvas.vue` |
| **Gemini Panel** | `apps/stage-tamagotchi/src/renderer/pages/notice/gemini.vue` (UI) | `packages/stage-ui/src/stores/modules/live-session.ts` (Bidi WebSocket) |
| **System Tray** | `apps/stage-tamagotchi/src/main/tray/index.ts` |
| **Caption Overlay** | `apps/stage-tamagotchi/src/renderer/pages/caption.vue` (UI) | `apps/stage-tamagotchi/src/main/windows/caption/` (Manager) |
| **Widgets Host** | `apps/stage-tamagotchi/src/renderer/pages/widgets.vue` | `apps/stage-tamagotchi/src/main/windows/widgets/index.ts` (Manager) |

---

## 3. Settings & Editing

| Concept | Path |
| :--- | :--- |
| **AIRI Card Editor** | `packages/stage-pages/src/pages/settings/airi-card/index.vue` |
| — Identity Tab | `.../tabs/CardCreationTabIdentity.vue` |
| — Behavior Tab | `.../tabs/CardCreationTabBehavior.vue` |
| — Generation Tab | `.../tabs/CardCreationTabGeneration.vue` |
| — Acting Tab | `.../tabs/CardCreationTabActing.vue` |
| — Artistry Tab | `.../tabs/CardCreationTabArtistry.vue` |
| — Modules Tab | `.../tabs/CardCreationTabModules.vue` |
| — Proactivity Tab | `.../tabs/CardCreationTabProactivity.vue` |
| **Vision Settings** | `packages/stage-pages/src/pages/settings/modules/vision.vue` | `visionStore` |
| **Module Settings Pages** | `packages/stage-pages/src/pages/settings/modules/` |
| **Provider Config Pages** | `packages/stage-pages/src/pages/settings/providers/` |
| **Docs Viewer Sidebar** | `apps/stage-tamagotchi/src/renderer/constants/docs-sidebar.ts` |
| **Docs Viewer Router** | `apps/stage-tamagotchi/src/renderer/pages/settings/docs/[...path].vue` |

---

## 4. Chatbox Elements

| Concept | Path |
| :--- | :--- |
| **Chat History (Host)** | `packages/stage-ui/src/components/scenarios/chat/history.vue` |
| **Assistant Bubble** | `.../chat/assistant-item.vue` |
| **User Bubble** | `packages/stage-ui/src/components/scenarios/chat/user-item.vue` |
| **Bubble Actions Menu** | `packages/stage-ui/src/components/scenarios/chat/components/action-menu/index.vue` |
| **Bubble Render Parts** | `.../chat/response-part.vue` (Text) | `.../chat/tool-call-block.vue` (Tools) |
| **Journal Strip (Chips)** | `apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue` |
| **Mood / Vibe Indicator** | `apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue` |
| **Toolbar Strip** | `apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue` |
| **Bubble Styling (ACT)** | Extracted from performance tokens in `ChatArea.vue` |

---

## 5. Data Layer & Persistence

The canonical reference for every storage key, type, and sync behavior is **[`docs/data-catalog.md`](./data-catalog.md)**. Below are the key entry points.

### Architecture
- **Unified storage layer**: `packages/stage-ui/src/database/storage.ts` — `unstorage` with two IndexedDB mounts (`local:` for data, `outbox:` for sync queue). All writes automatically enqueue sync operations.
- **Database repos**: `packages/stage-ui/src/database/repos/` — one file per domain (characters, chat sessions, text journal, short-term memory, lifetime memory, provisioning sessions, echo chips, director notes, providers).

### Key Namespaces (quick reference)
| Namespace | Stores | Sync Behavior |
| :--- | :--- | :--- |
| `local:airi-cards` | All character cards | Merged per-card by timestamp |
| `local:chat/sessions/{id}` | Full chat records | Merged messages + conflict detection |
| `local:chat/index/{userId}` | Session index (organized by character) | Merged per-session |
| `local:memory/text-journal/{userId}` | Long-term memory entries | Merged by ID |
| `local:memory/short-term/{userId}` | Daily summary blocks | Merged by ID |
| `local:memory/lifetime/{characterId}` | Eternal thread artifacts | Full LWW |
| `local:memory/echo-chips/{userId}` | Semantic bursts | Merged by ID |
| `local:director/sessions/{id}` | Director notes | Full LWW, conflict-protected |
| `local:characters` | Community character catalog | Full LWW |
| `local:providers` | Provider configurations | Full LWW |
| `local:sync-metadata/*` | Internal sync tracking | Skipped by sync |

### Binary Assets (localforage — separate IndexedDB)
| Asset | Key Pattern | Store File |
| :--- | :--- | :--- |
| Background images | `bg-{nanoid}` | `packages/stage-ui/src/stores/background.ts` |
| Display models (VRM/Live2D/Spine/MMD) | `display-model-{nanoid}` | `packages/stage-ui/src/stores/display-models.ts` |
| Stickers | `sticker-data-{id}` | `packages/stage-ui/src/stores/stickers.ts` |
| Custom VRM animations | `custom-vrma-animation-{id}` | `packages/stage-ui-three/src/stores/custom-vrm-animations.ts` |

### Sync Engine
- **Orchestrator**: `packages/stage-ui/src/stores/sync-engine.ts` — `StorageClient` interface, merge logic, reconciliation for backgrounds and models.
- **Storage backends**: `ElectronFSClient` (local filesystem) and `S3StorageClient` (S3-compatible, including R2).

---

## 6. Provider System

The provider architecture lets TTS, LLM, STT, vision, and image generation backends be registered as interchangeable "providers."

### Core Files
| Concept | Path |
| :--- | :--- |
| **Provider registry** | `packages/stage-ui/src/stores/providers.ts` — central catalog where every provider is registered via `defineProvider()`. |
| **Provider type definitions** | `packages/stage-ui/src/stores/providers/types.ts` — `ProviderMetadata`, `ModelInfo`, `VoiceInfo`, `VoiceProfile`, `SpeechCapabilitiesInfo`, `ProviderRuntimeState`. |
| **Provider store** | `packages/stage-ui/src/database/repos/providers.repo.ts` — persists provider configs as `local:providers`. |

### Provider Contract
Every provider implements this shape (defined in `providers.ts`):
```typescript
interface ProviderMetadata {
  id: string
  category: 'chat' | 'embed' | 'speech' | 'transcription' | 'vision'
  tasks: string[]
  deployment: 'local' | 'cloud'
  defaultOptions: () => Record<string, unknown>
  createProvider: (config) => Provider | Promise<Provider>
  capabilities: {
    listModels?: (config) => Promise<ModelInfo[]>
    listVoices?: (config) => Promise<VoiceInfo[]>
    loadModel?: (config, hooks?) => Promise<void>
    getSpeechCapabilities?: (config) => Promise<SpeechCapabilitiesInfo | null>
    supportsSSML?: boolean
    supportsPitch?: boolean
  }
  validators: {
    validateProviderConfig: (config) => Promise<ProviderValidationResult>
  }
}
```

### Inference Protocol (Local Models)
- **Protocol contract**: `packages/stage-ui/src/libs/inference/protocol.ts` — message types (`load-model`, `run-inference`, `cancel`, `unload-model`) and responses (`progress`, `model-ready`, `inference-result`, `error`).
- **Coordinator**: `packages/stage-ui/src/libs/inference/coordinator.ts` — serialized model loads via `getLoadQueue()`.
- **GPU Resource Coordinator**: `packages/stage-ui/src/libs/inference/gpu-resource-coordinator.ts` — VRAM bookkeeping, pressure telemetry, device-loss fallback.
- **WebGPU detection**: `packages/stage-shared/src/webgpu/detect.ts`.

### Local TTS Reference (Kokoro)
- **Worker**: `packages/stage-ui/src/workers/kokoro/worker.ts`
- **Adapter**: `packages/stage-ui/src/libs/inference/adapters/kokoro.ts` — uses load queue, GPU coordinator, device-loss promotion.
- **Provider page**: `packages/stage-pages/src/pages/settings/providers/speech/kokoro-local.vue`

---

## 7. Module System

AIRI's "modules" are feature domains stored in `packages/stage-ui/src/stores/modules/`. Each module is a Pinia store exposed as a configurable capability on the AIRI card (`extensions.airi.modules.{name}`).

| Module | Store File | Settings Page | Config Key |
| :--- | :--- | :--- | :--- |
| **Consciousness (LLM)** | `stores/modules/consciousness.ts` | Provider selection | `extensions.airi.modules.consciousness` |
| **Speech (TTS)** | `stores/modules/speech.ts` | `modules/speech.vue` | `extensions.airi.modules.speech` |
| **Hearing (STT)** | `stores/modules/hearing.ts` | `modules/hearing.vue` | `extensions.airi.modules.hearing` |
| **Vision (VLM)** | `stores/modules/vision.ts` | `modules/vision.vue` | `extensions.airi.modules.vision` |
| **Live2D** | — (configured in card editor) | — | `extensions.airi.modules.live2d` |
| **VRM** | — (configured in card editor) | — | `extensions.airi.modules.vrm` |
| **Discord** | `stores/modules/discord.ts` | `modules/messaging-discord.vue` | `extensions.airi.modules.discord` |
| **Twitter** | `stores/modules/twitter.ts` | — | — |
| **Artistry (Image Gen)** | `stores/modules/artistry.ts` | Provider selection | `extensions.airi.artistry` |
| **Artistry Autonomous** | `stores/modules/artistry-autonomous.ts` | — | — |
| **Live Session (Gemini)** | `stores/modules/live-session.ts` | — | — |
| **Gaming: Minecraft** | `stores/modules/gaming-minecraft.ts` | — | — |
| **Gaming: Factorio** | `stores/modules/gaming-factorio.ts` | — | — |

### Module Wiring Pattern
Each module typically follows:
1. A **Pinia store** in `stores/modules/` with `useLocalStorage`-backed settings
2. A **provider adapter** in the provider system
3. A **settings page** in `packages/stage-pages/src/pages/settings/modules/`
4. A slot in `extensions.airi.modules.{name}` inside the AIRI card type

---

## 8. Audio Pipeline

### TTS Flow
```
LLM output text → VoiceProfile (effects + UST transforms) → SpeechProvider.speech().fetch() → Worker inference → PCM → WAV → Playback
```

### Key Files
| Concept | Path |
| :--- | :--- |
| **Speech provider selection** | `packages/stage-ui/src/stores/modules/speech.ts` — active provider, model, voice, pitch, rate, SSML, language |
| **Voice profiles** | `settings/speech/voice-profiles` (localStorage) — `VoiceProfile[]` with effects (pitch, rate, volume, equalizer, ASMR, radio, robot, reverb, spatial) and UST (universal speech transformer) config |
| **UST processing** | Packaged within the provider fetch flow — strips asterisks, mutes narrative brackets, replaces tildes, strips emojis before text reaches TTS |
| **Audio Studio** | [`feat-audio-studio.md`](./feat-audio-studio.md) — full spec for the voice profile management UI |
| **Kokoro worker** | `packages/stage-ui/src/workers/kokoro/worker.ts` — reference local TTS implementation |
| **Speech runtime** | `packages/stage-ui/src/stores/speech-runtime.ts` — wraps `createSpeechPipelineRuntime()` |
| **Audio context** | `packages/stage-ui/src/stores/audio.ts` — `audio-context` and `character-speaking` stores |
| **Audio input devices** | `packages/stage-ui/src/stores/settings/audio-device.ts` |
| **Audio Studio UST proposal** | `docs/proposal-higgs-audio-v3-tts-integration.md` |
| **MOSS-TTS-Nano proposal** | `docs/proposal-moss-tts-nano-provider-unified-webgpu.md` |

---

## 9. Memory Systems

### Long-Term Memory (Text Journal)
- **Store**: `packages/stage-ui/src/stores/memory-text-journal.ts`
- **Repo**: `packages/stage-ui/src/database/repos/text-journal.repo.ts` — `local:memory/text-journal/{userId}`
- **Tool integration**: `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/text-journal.ts` — exposes `create` and `search` actions to the LLM
- **Search index**: `packages/stage-ui/src/libs/search/layered-memory.ts` — `Transformers.js` / Orama / Voy, stored in separate `airi-search-index` IndexedDB

### Short-Term Memory (Daily Summaries)
- **Store**: `packages/stage-ui/src/stores/memory-short-term.ts`
- **Repo**: `packages/stage-ui/src/database/repos/short-term-memory.repo.ts` — `local:memory/short-term/{userId}`
- **Settings**: `packages/stage-pages/src/pages/settings/modules/memory-short-term.vue`
- **Config**: `extensions.airi.shortTermMemory` — `windowSize` (default 3) and `tokenBudgetPerDay` (default 1000)

### Lifetime Memory (Eternal Thread)
- **Store**: `packages/stage-ui/src/stores/memory-lifetime.ts`
- **Repo**: `packages/stage-ui/src/database/repos/lifetime-memory.repo.ts`
- **Provisioning session repo**: `packages/stage-ui/src/database/repos/provisioning-session.repo.ts`
- **Pipeline**: `collectSourceDocs()` → chunking → base synthesis → Pass 1 (dedupe) → Pass 2 (caveman refinement)
- **Modals**: `packages/stage-pages/src/pages/settings/modules/components/LifetimeProvisioningModal.vue` | `LifetimeHistoryModal.vue`

### Echo Chips
- **Store**: `packages/stage-ui/src/stores/echo-chips.ts`
- **Repo**: `packages/stage-ui/src/database/repos/echo-chips.repo.ts` — `local:memory/echo-chips/{userId}`

### Director Notes
- **Repo**: `packages/stage-ui/src/database/repos/director-notes.repo.ts` — `local:director/sessions/{sessionId}`
- **Autonomous execution**: `packages/stage-ui/src/stores/modules/artistry-autonomous.ts`

### Proactivity / Heartbeats
- **Store**: `packages/stage-ui/src/stores/proactivity.ts` — idle heartbeat loop, sensor compilation, registered tool resolution

---

## 10. Engine & Subsystems

| Concept | Path |
| :--- | :--- |
| **ACT Pipeline (Parser)** | `packages/stage-ui/src/composables/use-llm-marker-parser.ts` |
| **ACT Pipeline (Execution)** | `packages/stage-ui-three/src/services/expression.ts` |
| **Artistry / ComfyUI** | `apps/stage-tamagotchi/src/main/services/airi/widgets/providers/comfyui.ts` |
| **Artistry Bridge** | `apps/stage-tamagotchi/src/main/services/airi/widgets/artistry-bridge.ts` |
| **Scene / Background Layer** | `packages/stage-ui/src/components/scenes/Stage.vue` (Layer) | `packages/stage-pages/src/pages/settings/scene/index.vue` (UI) |
| **Background Picker Dialog** | `packages/stage-ui/src/components/scenarios/dialogs/stage-background-picker/StageBackgroundPicker.vue` |
| **Image Journal Store** | `packages/stage-ui/src/stores/background.ts` |
| **Stage Style / Gallery** | `packages/stage-pages/src/pages/settings/scene/index.vue` |
| **Model Position / Lights** | `packages/stage-ui/src/components/scenarios/settings/model-settings/vrm.vue` |
| **Control Island State** | `packages/stage-ui/src/stores/settings/controls-island.ts` (Shared) | `apps/stage-tamagotchi/src/renderer/stores/controls-island.ts` (Renderer) |
| **VRM Animations** | `packages/stage-ui-three/src/assets/vrm/animations/index.ts` (Assets) | `packages/stage-ui-three/src/stores/model-store.ts` (State) |
| **Custom VRM Animations** | `packages/stage-ui-three/src/stores/custom-vrm-animations.ts` |
| **Character Artistry DNA** | `packages/stage-ui/src/constants/prompts/character-defaults.ts` |
| **STT / Microphone** | `apps/stage-tamagotchi/src/renderer/pages/index.vue` (Tamagotchi) | `apps/stage-web/src/pages/index.vue` (Web) |
| **Gemini Live (Bidi WebSocket)** | `packages/stage-ui/src/stores/modules/live-session.ts` |
| **LLM Meta-Tools** | `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/` |
| **Multi-Step Tool Gating** | `packages/stage-ui/src/stores/llm.ts` — `maxSteps: 10` |

---

## 11. Discord Integration

| Concept | Path |
| :--- | :--- |
| **Service (main process)** | `apps/stage-tamagotchi/src/main/services/airi/discord/index.ts` |
| **Slash command definitions** | `packages/stage-ui/src/stores/modules/discord.ts` (`COMMANDS_VERSION: 4`) |
| **Settings store** | `packages/stage-ui/src/stores/modules/discord.ts` |
| **Settings page** | `packages/stage-pages/src/pages/settings/modules/messaging-discord.vue` |
| **Vision plumbing** | Intercepts Discord attachments → `chatOrchestrator.ingest` as base64 |
| **Full spec** | [`feat-discord-revamp.md`](./feat-discord-revamp.md) |
| **Architecture doc** | `docs/content/en/docs/advanced/architecture/design-discord-bot-integration.md` |

---

## 12. MCP Architecture

| Concept | Path |
| :--- | :--- |
| **Config file** | `%AppData%/airi/mcp.json` (Electron `userData`) |
| **Electron service manager** | `apps/stage-tamagotchi/src/main/services/airi/mcp-servers/index.ts` — stdio connection, lifecycle, tool listing/delegation |
| **IPC Eventa contracts** | `electronMcpListTools`, `electronMcpCallTool` in `apps/stage-tamagotchi/src/shared/eventa.ts` |
| **Renderer bridge** | `packages/stage-ui/src/stores/mcp-tool-bridge.ts` — exposes `listTools()`, `callTool()`, `getRuntimeStatus()` cross-window via `window.__AIRI_MCP_BRIDGE__` |
| **Builtin meta-tools** | `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/mcp.ts` — `mcp_list_tools`, `mcp_call_tool` |
| **Settings** | `packages/stage-ui/src/stores/mcp.ts` — server command, args, connected state |
| **Google Search Grounding (Gemini)** | `packages/stage-ui/src/stores/modules/live-session.ts` — conditioned on `isGroundingEnabled` |

---

## 13. Key Directories

| Directory | Role |
| :--- | :--- |
| `packages/stage-ui` | Core business logic, components, Pinia stores, database layer, inference |
| `packages/stage-ui/src/stores/modules/` | All feature modules (consciousness, speech, hearing, vision, discord, artistry, etc.) |
| `packages/stage-ui/src/stores/providers/` | Provider adapter helpers |
| `packages/stage-ui/src/database/` | `storage.ts` + `repos/` (persistence layer) |
| `packages/stage-ui/src/libs/inference/` | Protocol, coordinator, GPU resource tracking, per-model adapters |
| `packages/stage-ui/src/workers/` | Web Worker implementations (kokoro, whisper, etc.) |
| `packages/stage-ui-three` | Three.js 3D rendering, VRM, expressions |
| `packages/stage-ui-live2d` | Live2D rendering |
| `packages/stage-pages` | Shared settings pages, card editor, module pages |
| `packages/stage-shared` | Constants (`emotions.ts`, `events.ts`), utilities (`text.ts`) |
| `packages/stage-layouts` | Layout components shared across apps |
| `packages/ui` | Primitive components built on reka-ui |
| `packages/i18n` | Central translations |
| `apps/stage-tamagotchi` | Electron app (main + renderer) |
| `apps/stage-web` | Web app |
| `docs/` | Proposal docs, reference sheets, how-to guides |
| `docs/content/en/docs/` | In-app manual content (vitepress) |

---

## 14. Nicknames Index

| Nickname | Resolves To |
| :--- | :--- |
| **"chatbox"** | `ChatArea.vue` / `InteractiveArea.vue` / `renderer/pages/chat.vue` |
| **"control strip" / "the strip"** | `ControlStrip.vue` / `ControlStripHost.vue` |
| **"the island" / "original island" / "og island"** | `controls-island/index.vue` |
| **"the floating widget" / "the standalone window" / "the tamagotchi"** | `Stage.vue` (Actor Stage Window) |
| **"the rich journal"** | `design-prospective-rich-journal.md` |
| **"dreaming"** | Memory consolidation via proactive idle tasks |
| **"vibe indicator"** | Emotional dashboard in the chatbox |
| **"pencil artistry"** | `CardCreationTabArtistry.vue` |
| **"the staging_widgets thing"** | `apps/stage-tamagotchi/src/renderer/stores/tools/builtin/widgets.ts` |
| **"the backends"** | `packages/stage-ui/src/stores/providers.ts` |
| **"the brain"** | `packages/stage-ui/src/stores/modules/` |
| **"chat bubble context menu"** | `action-menu/index.vue` |
| **"bubble layer" / "user bubble layer"** | `user-item.vue` |
| **"edit mode"** | Inline editing inside `user-item.vue` |

---

## 15. Lessons Learned

### Ingestion & Input Pipeline

- **Main vs. Secondary Windows**: The Main Window is the Control Strip (serving `/` or `#` route, where `isMainWindow` is `true`). Secondary windows (Chatbox `#/chat`, Actor Stage `#/actor`) are not the main window.
- **Fire-and-Forget Pitfall**: Input textareas in secondary windows call `chatStore.ingest`, which historically posted to the main window over `BroadcastChannel('airi-chat-input-bridge')`. If the main window was deadlocked or HMR-reloaded, the message was swallowed.
- **Verification Loop**: Each `ingest` generates a `clientMessageId`, returns a promise with a 5-second timeout watching for `session-updated` broadcasts. On timeout, the UI restores draft text and shows a toast.
- **Unicode Healing**: `healMozibake` in `packages/stage-shared/src/text.ts` repairs mis-decoded UTF-8 byte streams. Iterate by code point (`for (const char of text)`) not by index — supplementary plane characters (emojis, ZWJs) split into invalid surrogates under indexed access.

### Toast Notifications & Event Bridging

1. Renderer invokes `electronShowToast` (`defineInvokeEventa` in `shared/eventa.ts`).
2. Main process (`apps/stage-tamagotchi/src/main/index.ts`) handles it, targets the visible Chatbox (fallback: Actor Stage → Control Strip), and emits `electronShowToastEvent`.
3. Target window's `App.vue` listens and calls `toast()` from `vue-sonner`.
4. **Eventa Context Pitfall**: `targetWin.webContents.send('eventa:event:electron:show-toast', payload)` bypasses Eventa's serializer. Correct dispatch:
   ```typescript
   const { context, dispose } = createContext(ipcMain, targetWin)
   context.emit(electronShowToastEvent, payload)
   dispose()
   ```

### Autonomous Artistry & Director Notes Sync

- **Flow**: LLM turn triggers `runArtistTask` → Director LLM grades visual interest (1-100) → saves `DirectorNote` via `recordDirectorDecision()` → `history.vue` reactively merges notes with chat messages, sorted by `createdAt`, rendered by `DirectorNoteBubble.vue`.
- **Cross-Window Sync**: Pinia stores are per-window. Writing to IndexedDB from one window doesn't update in-memory state in others. Fix: broadcast modifications over `BroadcastChannel('airi:director-notes-sync')` — each store instance listens, filters by active `sessionId`, and updates locally.
