# Design Document: Bring Your Own Storage (BYOS) Cloud Sync

**Status:** Proposed / Draft
**Goal:** Empower users with privacy-preserving, local-first multi-device database and asset synchronization using standard cloud providers (S3/R2, Dropbox, Google Drive, and Local File System targets) without central server custodians.

---

## 🏛️ Architecture & Philosophy

The BYOS (Bring Your Own Storage) sync engine adheres to strict local-first autonomy:
1. **Serverless Custody:** No proprietary AIRI hosted databases or sync servers. The user owns their cloud storage backend.
2. **Entity-Level Sync:** Rather than syncing a single massive database file (which is prone to write conflict corruption), the sync engine manages individual modular JSON files for each Session, Character Card, and Memory entry.
3. **Optimized Large Asset Sync:** Heavy assets (VRMs, Live2D packages, Spine folders, audio cache) are synced selectively and folder-by-folder to the bucket, allowing Mac and Windows instances to share model libraries without duplicate downloads.

---

## 🛠️ Database Schema Extensions: The "Dirty" Sync Tracker

To make synchronization fast and light, we will extend the local IndexedDB schemas with transitional tracking attributes:

```typescript
interface SyncableEntity {
  id: string
  updatedAt: number // Epoch timestamp of last modification
  syncStatus: 'synced' | 'dirty' | 'pending'
  deleted?: boolean // Soft delete marker to propagate deletions to the cloud
}
```

### Outbox Pattern (Transactional Hooks)
We will hook into the IndexedDB repository write pipelines (`chat-sessions.repo.ts`, `characters.repo.ts`):
* Whenever an update occurs locally, the entity's `updatedAt` is updated, and `syncStatus` is set to `'dirty'`.
* During a sync pass, the engine only queries and packages entities marked `'dirty'`.
* Once successfully written to the remote bucket, their status transitions back to `'synced'`.

---

## 🖥️ UI Integration Flow (System Integration)

To preserve the visual continuity of the settings application, the Cloud Sync feature leverages the existing **Providers** and **Modules** design patterns:

### 1. Settings > Providers (Infrastructure Integration)
A new tab category **"Cloud"** or **"Storage"** is added to the Providers view alongside "Chat", "Speech", "Transcription", "Artistry", and "Vision".
* Configured using standard card elements:
  * **S3-Compatible Storage Card:** Connects Cloudflare R2, AWS S3, Backblaze B2, or self-hosted MinIO. Input fields: Access Key ID, Secret Access Key, Endpoint URL, Bucket Name, Region.
  * **Dropbox Card / Google Drive Card:** Triggers an Electron OAuth secure popup window to authenticate the user and retrieve refresh/access tokens.
  * **Local / FS Target Card:** Connects a NAS, mounted local drive, or synced folder path. Input fields: Directory Path.

### 2. Settings > Modules > Cloud Sync (Control Center Integration)
A new module card titled **"Cloud Sync"** is added to the modules list (under Settings > Modules).
* **Toggle State:** Activates background sync intervals or save triggers.
* **Module Settings Detail View:**
  * **Active Provider Dropdown:** Select which configured Cloud Storage provider to use.
  * **Sync Toggles (Rules):**
    * `[x]` Sync Database & Chats (JSON files)
    * `[x]` Sync Character Cards
    * `[x]` Sync Memory & Vector Database
    * `[ ]` Sync Heavy 3D Models & Assets (Live2D, Spine, VRM)
  * **Conflict Strategy:** Last-Write-Wins (LWW) selection.
  * **Status & Execution:** Shows last sync timestamp, files matched/updated, and a manual **[Sync Now]** button.

### 3. Settings > Data (Backup Integration)
Add a shortcut button or configuration flag within the existing **Auto-Backup & Manual Backup** card to easily link users to the **Settings > Modules > Cloud Sync** panel, or directly trigger a cloud mirror backup.

---

## 🔄 Reconcile & Merge Strategy (Multi-Device LWW)

When merging data from two active instances (e.g., Mac and Windows) connected to the same bucket:

1. **Scan phase:**
   - Fetch remote file manifests containing paths and remote timestamps.
   - Match them against local IndexedDB metadata.
2. **Conflict Resolution:**
   - **Remote-Only:** The entity is missing locally (e.g., chat started on Windows, now loaded on Mac). Download JSON and write to local IndexedDB.
   - **Local-Only:** The entity exists locally but not in the bucket. Upload JSON.
   - **Mismatched Timestamps (Conflict):**
     * Apply **Last-Write-Wins (LWW)** using `updatedAt` comparisons.
     * The node with the newer timestamp overrides the older node. Since sessions are self-contained chat log arrays, this prevents complex row-level merging and guarantees database integrity.
3. **Soft-Delete Sync:**
   - If an entity is deleted locally, it is marked as `deleted: true`.
   - The sync engine propagates the deletion to the remote bucket and then deletes the local record from IndexedDB.

---

## 🗃️ Data Inventory & Integration Points

This section outlines all database stores, vector indexes, and media files, mapping their exact persistence mechanisms, repos, and sync integration points.

### 1. The Database Repositories (Modular IndexedDB Tables)
These repositories handle the structured application state and chat history. They are located under `packages/stage-ui/src/database/repos/` and persist via Dexie/IndexedDB:

| Category / UI Name | Repository File / Export | Local Storage Engine | Sync Hook / Detection Point |
| :--- | :--- | :--- | :--- |
| **Chat Sessions** | [chat-sessions.repo.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/database/repos/chat-sessions.repo.ts) | IndexedDB (`chatSessionsRepo`) | Write pipelines in `chat-sessions.repo.ts` (`saveSession`, `deleteSession`) |
| **Character Cards** | [characters.repo.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/database/repos/characters.repo.ts) | IndexedDB (`charactersRepo`) | `saveCard` / `deleteCard` in `characters.repo.ts` |
| **Director Notes** | [director-notes.repo.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/database/repos/director-notes.repo.ts) | IndexedDB (`directorNotesRepo`) | `saveNotes` / `deleteNotes` in `director-notes.repo.ts` |
| **Providers Config** | [providers.repo.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/database/repos/providers.repo.ts) | IndexedDB (`providersRepo`) | `saveProvider` / `deleteProvider` in `providers.repo.ts` |

### 2. The Four Memory Segments
Each of the memory components configured in **Settings > Memory** is managed by a distinct repository and Pinia store:

| Segment / UI Name | Repository / Export | Pinia Store File | Sync Hook / Detection Point |
| :--- | :--- | :--- | :--- |
| **The Active Pulse (STMM)** | [short-term-memory.repo.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/database/repos/short-term-memory.repo.ts) | [memory-short-term.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/memory-short-term.ts) | `saveBlock` / `deleteBlock` in `short-term-memory.repo.ts` |
| **The Echoes (Dream Chips)** | [echo-chips.repo.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/database/repos/echo-chips.repo.ts) | [echo-chips.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/echo-chips.ts) | `saveChips` / `deleteChips` in `echo-chips.repo.ts` |
| **The Sentinel's Journal (LTMM)** | [text-journal.repo.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/database/repos/text-journal.repo.ts) | [memory-text-journal.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/memory-text-journal.ts) | `persist` pipeline in `memory-text-journal.ts` |
| **The Eternal Thread (Lifetime)** | [lifetime-memory.repo.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/database/repos/lifetime-memory.repo.ts) | [memory-lifetime.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/memory-lifetime.ts) | `saveMemory` / `deleteMemory` in `lifetime-memory.repo.ts` |

### 3. The Search & Vector Index (Semantic Layer)
* **Orama Status:** Orama is **not** actively used for runtime vector indexing.
* **Retriever Engine:** The app uses a custom Web Worker-based retriever ([search.worker.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/libs/workers/search/search.worker.ts)) utilizing `@huggingface/transformers` (`Xenova/bge-small-en-v1.5`) for local sentence embeddings and a local BM25 + cosine similarity hybrid scorer.
* **Storage Location:** Stored in IndexedDB via `unstorage` with the `indexedDbDriver` base name `'airi-search-index'`, under key `'snapshot'`.
* **Sync Strategy:**
  - Rather than syncing the computed binary index snapshot (which is automatically rebuilt in the background on load from raw memory), the sync engine relies on syncing the underlying raw STMM, LTMM, and session databases.
  - When raw databases are restored/synced, `layeredMemory.indexDocuments()` is automatically triggered on launch, rebuilding the local vector search index on-the-fly.

### 4. Heavy Media & generated assets (Image Journal)
The `image_journal` tool generates high-resolution images, selfies, and background captures which can quickly bloat storage.
* **Storage Location:** Localforage (IndexedDB key-value store) with key prefix `bg-`, storing the raw image binary `Blob` object along with metadata.
* **Management Store:** [background.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/background.ts) (`useBackgroundStore`).
* **Sync Strategy:**
  - Binary blobs are heavy and are uploaded as raw image files to the bucket under `/assets/backgrounds/` named `{id}.png`.
  - **Detection Point:** Hook `onBackgroundAdded` and `removeBackground` in `background.ts` to queue file uploads/deletions.

### 5. Character Cards Schema & Parsing (AiriCard Audit)
* **Storage Location:** LocalStorage under the key `'airi-cards'`.
* **Serialization Structure:** Serialized as a serialized array of key-value pairs (`[string, AiriCard][]`) using JSON.
* **Resilience Audit (Self-Healing):**
  - The store ([airi-card.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/modules/airi-card.ts)) implements a highly defensive initialization pipeline.
  - When cards are loaded, they are parsed and compiled via `newAiriCard()` which validates the schema against `AiriCardSchema` (via Valibot).
  - The extensions block is resolved via `resolveAiriExtension()`, which merges existing properties with complete default configurations for modules (consciousness, speech, VRM, Live2D, displayModelId, activeBackgroundId), heartbeats, dreamState, shortTermMemory, artistry, acting, and agents.
  - **Verdict:** Safe from schema drift. If a sync imports a card missing new settings properties, the parsing pipeline automatically heals it and appends default state fallback structures without throwing runtime crashes.

### 6. Sync-Heavy 3D Models & Assets (Model Catalog)
Custom models are imported by the user and stored locally as binary files. The catalog supports four distinct formats managed by [display-models.ts](file:///Users/richardpinedo/Projects.nosync/airi/airi_dasilva333/packages/stage-ui/src/stores/display-models.ts) (`useDisplayModelsStore`):

| Model Format | Format enum values | Local Storage Engine | Storage Details |
| :--- | :--- | :--- | :--- |
| **Live2D** | `live2d-zip`, `live2d-directory` | localforage (`display-model-`) | Custom zip compilation, model manifests, and parameter sets |
| **Spine** | `spine-zip` | localforage (`display-model-`) | Skeleton binary files, atlases, and textures |
| **VRM** | `vrm` | localforage (`display-model-`) | GLB binary avatar file containing blendshapes |
| **MMD** | `pmx-zip`, `pmx-directory`, `pmd` | localforage (`display-model-`) | PMX/PMD models + textures stored separately under `${id}-textures` |

* **Detection Point:** `addDisplayModel`, `addDisplayModelWithTextures`, and `removeDisplayModel` in `display-models.ts` are the integration points.
* **Sync Strategy:**
  - Standard backups do not include these catalog items because of their extreme size (several gigabytes per model library).
  - The BYOS Sync Engine will sync the model binaries as file streams directly to the bucket under `/assets/models/{id}.zip` (or `/assets/models/{id}/` folder structure).
  - A small metadata index mapping user-imported model IDs to their display names and hashes will be synced to `/assets/models/manifest.json`.


