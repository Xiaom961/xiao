# Proposal: MOSS‑TTS‑Nano (ONNX) as a first‑class local TTS provider

## Goal

Add **MOSS‑TTS‑Nano (0.1B)** as a **first‑class speech provider** alongside **Kokoro** in AIRI, with:

- **Local, sidecar‑free runtime** (no Python service).
- **WebGPU when available**, with robust **WASM/CPU fallback**.
- **Voice cloning** (reference audio conditioning) as a core capability.
- Integration into AIRI’s existing **unified inference protocol** and its cross‑model **load coordination + memory pressure telemetry** (“unified WebGPU” system).

This document is a consolidated dump of links + architectural notes + open questions to validate before implementation.

## Relevant upstream links (MOSS / Nano / ONNX)

- **MOSS‑TTS Family README (context + deployment options)**:
  - `https://raw.githubusercontent.com/OpenMOSS/MOSS-TTS/refs/heads/main/README.md`
  - (Repo) `https://github.com/OpenMOSS/MOSS-TTS#mosstts`

- **MOSS‑TTS‑Nano (PyTorch model card / original release)**:
  - `https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Nano`

- **MOSS‑TTS‑Nano‑100M‑ONNX (browser‑oriented export; key enabler for “no Python sidecar”)**:
  - `https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX`
  - Highlights (per model card text):
    - Designed for **onnxruntime** and **onnxruntime‑web**
    - Split graphs for **prefill** + **decode-step** + **local decoder** (streaming‑friendly)
    - External weights via shared `.data` files
    - Includes `tts_browser_onnx_meta.json` and `browser_poc_manifest.json`

- **Companion codec: MOSS‑Audio‑Tokenizer‑Nano‑ONNX (required for waveform encode/decode)**:
  - `https://huggingface.co/OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX`

## AIRI implementation references (current “unified WebGPU” stack)

### Unified inference protocol (worker message contract)

- `packages/stage-ui/src/libs/inference/protocol.ts`
  - Standard message types: `load-model`, `run-inference`, `cancel`, `unload-model`
  - Standard responses: `progress`, `model-ready`, `inference-result`, `error`
  - Notes on WebGPU reality: each worker owns its own `GPUDevice` (cannot share across workers).

### Cross‑model coordination (“unified WebGPU thing” in AIRI today)

This is currently **coordination**, not a shared GPU device:

- **Serialized model loads** to avoid bandwidth/VRAM spikes:
  - `packages/stage-ui/src/libs/inference/coordinator.ts`
  - `getLoadQueue()` is used by adapters (Kokoro/Whisper).

- **Cross‑model VRAM bookkeeping + pressure telemetry**:
  - `packages/stage-ui/src/libs/inference/gpu-resource-coordinator.ts`
  - Tracks estimated allocations per model, emits `warning`/`critical`.

- **Device‑loss telemetry + fallback**:
  - `packages/stage-ui/src/libs/inference/protocol.ts` (`classifyError`, `DEVICE_LOSS` patterns)
  - Adapters record device-loss and can **promote subsequent loads to WASM**.

### Kokoro: current reference implementation for local TTS

- Worker:
  - `packages/stage-ui/src/workers/kokoro/worker.ts`
  - Uses `kokoro-js` with dtype/device fallback chains.
  - Implements cancellation as “drop stale results when they arrive”.

- Adapter:
  - `packages/stage-ui/src/libs/inference/adapters/kokoro.ts`
  - Uses:
    - global **LoadQueue**
    - global **GPUResourceCoordinator**
    - **device-loss promotion** to `wasm` after repeated WebGPU loss
  - Encodes PCM → WAV on the main thread (`encodeWav`) after receiving `Float32Array` samples.

### WebGPU detection and VRAM heuristic (used for budgeting)

- `packages/stage-shared/src/webgpu/detect.ts`
  - Uses `gpuu` to detect WebGPU + fp16 support.
  - Estimates VRAM with `adapter.limits.maxBufferSize * 4`, plus an override mechanism.

### Provider registry / speech provider wiring

- `packages/stage-ui/src/stores/providers.ts`
  - Central provider catalog, including speech providers.
  - Kokoro is wired as a local speech option here (via `getKokoroWorker` and Kokoro model metadata).
  - This is where a **new first‑class provider** should be registered (exposed in settings, validated, etc.).

## How Kokoro is exposed as a Speech Provider (concrete wiring)

This is the closest “golden path” reference for adding `moss-nano-local`.

### Provider ID + defaults

In `packages/stage-ui/src/stores/providers.ts`, `kokoro-local` is registered as:

- `id`: `kokoro-local`
- `category`: `speech`
- `tasks`: `['text-to-speech']`
- `defaultOptions()` chooses a default model based on WebGPU availability:
  - `hasWebGPU = !!navigator.gpu`
  - `model = getDefaultKokoroModel(hasWebGPU)`
  - plus `voiceId`

### Provider instance shape: OpenAI-compatible `speech.fetch`

`createProvider()` returns a `SpeechProvider` whose `speech()` returns:

- `baseURL`: `http://kokoro-local/v1/` (sentinel)
- `model`: `kokoro-82m`
- `fetch(input, init)` override which:
  - parses JSON body and expects:
    - `body.input` (text)
    - `body.voice` (voice id/key)
  - ensures a model is loaded based on `config.model` (selected in settings)
  - calls the worker manager:
    - `await workerManager.loadModel(modelDef.quantization, modelDef.platform)`
    - `await workerManager.generate(text, voice)`
  - returns `Response(audioBuffer, { 'Content-Type': 'audio/wav' })`

This means Kokoro is treated as a **local OpenAI-style speech endpoint**, implemented in-process by a custom fetch handler.

### Capabilities exposed for UI + orchestration

`kokoro-local.capabilities` includes:

- `listModels(config)`:
  - returns `kokoroModelsToModelInfo(hasWebGPU, t)`
- `loadModel(config, hooks)`:
  - validates `config.model` is in `KOKORO_MODELS`
  - checks WebGPU requirement if model platform is `webgpu`
  - calls `getKokoroWorker().loadModel(..., { onProgress: hooks?.onProgress })`
- `listVoices(config)`:
  - reloads the model for the chosen `config.model`
  - calls `getKokoroWorker().getVoices()`
  - maps voice metadata into AIRI `VoiceInfo[]`

### Settings UX flow (kokoro-local page)

`packages/stage-pages/src/pages/settings/providers/speech/kokoro-local.vue`:

- Calls `providersStore.fetchModelsForProvider(providerId)` on mount.
- Uses `metadata.capabilities.loadModel(config)` to load the selected model.
- Uses `speechStore.loadVoicesForProvider(providerId)` to populate voice dropdown.
- Watches `model` changes and repeats load + voice refresh.

## Minimum interface for `moss-nano-local` (aligned to Kokoro’s provider contract)

To be “first-class alongside Kokoro” without inventing a parallel provider architecture, implement the same outward shape:

### Provider metadata (in `stores/providers.ts`)

- `id`: `moss-nano-local`
- `category`: `speech`
- `tasks`: `['text-to-speech', 'tts']` (optional to match other providers)
- `deployment`: `local`
- `defaultOptions()` should include at least:
  - `model`: (device-aware default, similar to Kokoro)
  - `voiceId`: optional, but likely replaced by a **voice profile ID**
  - `device`: `'webgpu' | 'wasm' | 'cpu'` (if exposed to UI)

### Provider instance (`SpeechProvider.speech().fetch`)

Implement `fetch()` to support OpenAI-compatible TTS requests:

- Parse request JSON:
  - **required**: `input` (text)
  - **required**: `voice` (we can interpret this as either a built-in “preset voice” or a saved “voice profile” key)
  - **optional**: a “reference audio” field for cloning (this is a design decision; see open questions below)
- Ensure ONNX sessions are loaded for the selected model/device.
- Run generation in a worker and return:
  - `Content-Type: audio/wav` (or `audio/mpeg` if we add an encoder later)

### Capabilities

At minimum, mirror Kokoro’s:

- `listModels(config) => ModelInfo[]`
- `loadModel(config, { onProgress? })`
- `listVoices(config) => VoiceInfo[]`

For voice cloning, `listVoices` probably becomes “list **voice profiles**” (saved references), even if we expose them as `VoiceInfo[]` for compatibility with existing UI.

## Open questions (new, specific to Nano ONNX)

### 1) Where do reference audios live (voice cloning inputs)?

For true zero-shot voice cloning, we need a durable “voice library” of user-provided reference audio.

**Target UX (authoritative):**

- user uploads an audio file
- user gives it a name
- audio is saved locally (IndexedDB) as a Blob + metadata
- user selects provider `moss-nano-local`, selects the ONNX engine/device, and selects a “voice” entry that resolves to the stored audio blob

**Implication:** Nano “voices” should be treated as **user-managed reference assets**, not as base64 payloads passed around at request time, and not as “OpenAI-style” remote request extensions.

### 2) Where does “voice profile” live?

Do **not** mix this effort with Audio Studio.

We need a **separate** data model for Nano cloning voices that is explicitly “reference audio blob + metadata”, likely something like:

- `id`
- `name`
- `createdAt/updatedAt`
- `blob` (or a pointer/key to the blob)
- optional: `langHint`, `notes`, `durationMs`, `sampleRate`, `channels`, `sourceFilename`, `sha256`

Storage should be **IndexedDB** so the worker/provider can resolve by ID without any base64 handoffs.

### 3) Do we need streaming output?

Not for the initial integration.

Even if Nano supports decode-step, AIRI already chunks speech at a higher level (partial sentences / slices), so we can return a full WAV per slice without introducing “partial sentence streaming” complexity.

## Why MOSS‑TTS‑Nano (ONNX) is interesting in AIRI

Compared to Kokoro:

- **Voice cloning**: Nano is explicitly positioned for multilingual voice cloning with reference audio.
- **Streaming-friendly internals**: ONNX export is split into prefill/decode-step graphs, but we do not need to expose streaming at the AIRI UX level initially.
- **Browser compatibility**: model card claims it is designed for **onnxruntime-web** (WebGPU/WASM).

Compared to server/HTTP TTS providers:

- Local privacy + offline capability (subject to weight download/caching).
- Avoids API keys, costs, and latency; integrates into AIRI’s local inference UX.

## Proposed integration shape (high-level)

### 1) New local worker speaking AIRI’s unified protocol

Create `packages/stage-ui/src/workers/moss-nano/worker.ts` that:

- Accepts `load-model` with `{ device: 'webgpu' | 'wasm' | 'cpu' }`.
- Loads ONNX Runtime Web sessions for:
  - global prefill
  - global decode-step (KV cache)
  - local decoder + any local step graphs
  - audio tokenizer encoder/decoder (from `MOSS-Audio-Tokenizer-Nano-ONNX`)
- Emits `progress` during fetch/compile/warmup.
- Implements `cancel` by marking request IDs as cancelled and discarding late results (same pattern as Kokoro).

### 2) New adapter mirroring Kokoro’s resilience/coordination

Create `packages/stage-ui/src/libs/inference/adapters/moss-nano.ts` that:

- Uses `getLoadQueue()` to serialize model loads.
- Uses `getGPUCoordinator()` to track estimated VRAM and touch LRU on inference.
- Records device-loss events and implements **WASM promotion** after repeated failures (like Kokoro/Whisper).
- Returns output audio as PCM → WAV (or directly as WAV if the worker returns encoded audio).

### 3) Register as a first‑class Speech Provider

In `packages/stage-ui/src/stores/providers.ts`:

- Add a new provider definition:
  - category: `speech`
  - tasks: `text-to-speech` / `tts`
  - deployment: `local`
  - capabilities:
    - `listModels` (Nano variants, device/dtype options)
    - `listVoices` (may map to “voice profiles” rather than static voice IDs)
    - explicit **voice cloning capability** surfaced in metadata/UI
- Add settings UI surface similar to Kokoro local provider (choose device, caching, etc.).

## Key technical unknowns / due diligence checklist

These are the main items to analyze before committing to the integration.

### ONNX Runtime Web integration details

- **Does AIRI already ship `onnxruntime-web` explicitly, or only transitively?**
  - Kokoro uses `kokoro-js` which internally uses transformers.js/ORT; Nano would likely need direct `onnxruntime-web` usage for multi-graph orchestration.

- **Execution providers**:
  - Validate WebGPU EP availability across AIRI targets:
    - Stage Web (browser)
    - Stage Tamagotchi (Electron)
  - Confirm WASM fallback works consistently.

### Model asset fetching + caching

- External `.data` weights:
  - Confirm they can be fetched by ORT-web in AIRI’s environment (CORS, range requests, cache headers).
  - Decide caching layer (Cache Storage / IndexedDB / filesystem in Electron).
  - Confirm update strategy + integrity (hashing or ETag).

- Manifest usage:
  - Evaluate Nano’s `browser_poc_manifest.json` and `tts_browser_onnx_meta.json` for guidance.
  - Decide how to represent these in AIRI (hardcoded model IDs vs configurable mirrors).

### Streaming generation UX + API shape

De-scope streaming for now. Nano can generate a full WAV per AIRI speech slice; internal decode-step graphs are an implementation detail.

### Voice cloning capability definition

- Decide how to represent “voice”:
  - Kokoro uses a static `VoiceKey`.
  - Nano voice cloning uses a **reference audio blob** selected from a local voice library (IndexedDB).
  - Treat “voice list” as “user uploaded reference audios”, not “built-in speaker IDs”.

- Reference audio preprocessing:
  - Confirm required sample rate/channels and any normalization.
  - Decide where resampling happens (main thread vs worker vs audio tokenizer graph).

### Performance + memory budgeting

- Add VRAM estimates to `MODEL_VRAM_ESTIMATES` (like Kokoro/Whisper).
- Validate whether Nano is realistically “small enough” for typical WebGPU budgets when combined with other models (Whisper, etc.).
- Confirm device-loss behavior under load and whether promotion threshold needs tuning.

### Licensing / distribution

- Confirm license compatibility and whether AIRI can ship default model IDs or must require user opt-in download.
- Check whether any of the linked Hugging Face repos have additional usage restrictions beyond Apache‑2.0 (MOSS family is Apache‑2.0 per README).

## Decision summary (current)

- **Idea is viable** given `MOSS‑TTS‑Nano‑100M‑ONNX` + `onnxruntime-web` target.
- Biggest risks are **practical integration details** (multi-graph orchestration, asset caching, streaming output, and voice cloning UX), not AIRI’s provider architecture.
- A minimal first milestone should be:
  - “load Nano ONNX in a worker”
  - “generate short non-cloned speech to WAV”
  - “only then add voice cloning + streaming”.

