# Design Document: Bring Your Own Storage (BYOS) Cloud Sync

**Status:** Confirmed / Implemented

**Goal:** Empower users with privacy-preserving, local-first multi-device database and asset synchronization using standard cloud providers (S3/R2 and Local File System targets) without central server custodians.

---

## 🏛️ Architecture & Philosophy

The BYOS (Bring Your Own Storage) sync engine adheres to strict local-first autonomy:
1. **Serverless Custody:** No proprietary AIRI hosted databases or sync servers. The user owns their cloud storage backend.
2. **Entity-Level Sync:** Rather than syncing a single massive database file (which is prone to write conflict corruption), the sync engine manages individual modular JSON files for each Session, Character Card, and Memory entry.
3. **Optimized Large Asset Sync:** Heavy assets (VRMs, Live2D packages, Spine folders, audio cache, custom backgrounds) are synced selectively and folder-by-folder to the bucket, allowing Mac, Windows, and Web clients to share model and asset libraries without duplicate downloads.

---

## 🛠️ Unified Interceptor Layer: The Outbox Sync Tracker

Rather than modifying individual IndexedDB Dexie schemas or hooking into every database repository pipeline, synchronization tracking is handled transparently at the core storage engine wrapper:

### Global Storage Interceptors
The storage manager ([storage.ts](file:///C:/Users/h4rdc/Documents/Github/airi-rebase-scratch/packages/stage-ui/src/database/storage.ts)) mounts two `unstorage` namespaces:
* `local`: Points to the IndexedDB base `airi-local`.
* `outbox`: Points to the IndexedDB base `airi-sync-queue`.

We monkey-patch `storage.setItem`, `storage.setItemRaw`, and `storage.removeItem` to track mutations:
```typescript
async function enqueueSync(key: string, action: 'upsert' | 'delete') {
  if (storageState.isImportingRemoteData)
    return
  if (!key.startsWith('local:'))
    return
  if (key.startsWith('local:sync-metadata'))
    return // Skip sync tracker metadata

  const keyWithoutPrefix = key.replace('local:', '')
  const now = Date.now()

  // 1. Update local modification timestamp
  if (action === 'upsert') {
    await storage.setItemRaw(`local:sync-metadata/timestamps/${keyWithoutPrefix}`, now)
  }
  else {
    await storage.removeItem(`local:sync-metadata/timestamps/${keyWithoutPrefix}`)
  }

  // 2. Queue operation in the outbox
  await storage.setItemRaw(`outbox:queue/${keyWithoutPrefix}`, {
    key,
    action,
    timestamp: now
  })
}
```

* **Import Bypass:** During sync downloads, `storageState.isImportingRemoteData` is set to `true` to disable outbox enqueuing and prevent infinite sync feedback loops.

---

## 🖥️ UI Integration Flow

The Cloud Sync feature leverages existing **Providers** and **Modules** patterns for integration:

### 1. Settings > Providers
A new tab category **"Cloud"** is added to the Providers view:
* **S3-Compatible Storage Card:** Connects Cloudflare R2, AWS S3, Backblaze B2, or self-hosted MinIO. Inputs: Access Key ID, Secret Access Key, Endpoint URL, Bucket Name, Region.
* **Local File System Card (Desktop only):** Connects a NAS or local directory path.

### 2. Settings > Modules > Cloud Sync
* **Toggle State:** Activates background sync intervals.
* **Settings Panel:** Contains the provider selector, active sync status, a manual **[Sync Now]** trigger, and a list of unresolved conflicts.

---

## 🔄 Reconcile & Merge Strategy

When merging data from two active instances (e.g. Desktop and Web):

### 1. Unified `StorageClient` Interface
Both Local FS and S3 sync run on top of a unified interface:
```typescript
export interface StorageClient {
  validate: () => Promise<{ success: boolean, error?: string }>
  listFiles: () => Promise<{ success: boolean, files?: Array<{ relPath: string, mtime: number, size: number }>, error?: string }>
  readFile: (relPath: string, encoding?: 'utf-8' | 'base64') => Promise<{ success: boolean, content?: string, error?: string }>
  writeFile: (relPath: string, content: string, encoding?: 'utf-8' | 'base64', append?: boolean) => Promise<{ success: boolean, mtime?: number, error?: string }>
  deleteFile: (relPath: string) => Promise<{ success: boolean, error?: string }>
}
```

### 2. S3 Implementation Realities
* **mtime Translation:** Since S3 objects do not support custom file modification time writes, we map the S3 `LastModified` timestamp returned by `ListObjectsV2` as the remote `mtime`.
* **XML Decoding:** To run natively in the browser without Node dependencies, `S3StorageClient` uses the browser-native `DOMParser` to extract key, size, and timestamp values from S3 XML responses.
* **Large File Optimizations:** Instead of converting heavy files to Base64 (which causes CPU and memory bottlenecks), binary data is uploaded as raw `Blob` or `ArrayBuffer` payloads using signed HTTP PUT requests.

### 3. Smart Merges vs Overwrites
* **Standard Keys:** Use Last-Write-Wins (LWW) comparison between the remote `mtime` and the local timestamp.
* **Mergeable Keys:** For cumulative tables like `airi-cards`, `short-term-memory`, `text-journal`, and `echo-chips`, the sync engine downloads the remote JSON, reads the local state, merges the items by ID (using LWW per item), and writes the merged result back to both remote and local databases.

### 4. Safety Heuristics Guard
To prevent accidental deletions or data loss, we run a safety check before applying changes:
* **Contraction Check:** If a sync operation would replace a larger dataset (>10KB) with a much smaller one (<2KB or >5x size reduction), it is blocked.
* **Conflict State:** The engine halts auto-overwrite for that key and registers a sync conflict under `local:sync-metadata/conflicts/<key>`.
* **Resolution Options:** The user can manually resolve the conflict from the UI choosing **Keep Local**, **Keep Remote**, or **Merge**.

---

## 🗃️ Data Inventory & Integration Points

| Category / UI Name | Database / Storage Key | Sync Behavior |
| :--- | :--- | :--- |
| **Chat Sessions** | `local:chat/sessions/*` | Individual JSON files. Standard LWW. |
| **Character Cards** | `local:airi-cards` | JSON representation. Merged key-value map by character ID. |
| **Memory Segments** | `local:memory/short-term/local`, `local:memory/text-journal/local`, `local:memory/echo-chips/local` | JSON arrays. Merged by item ID using LWW. |
| **Director Notes** | `local:director/sessions/*` | Standard LWW. |
| **Providers Config** | `local:providers/*` | Standard LWW. Excludes the current sync configuration settings to prevent loopbacks. |
| **Background Images** | `localforage` (`bg-*`) | Reconciled via metadata JSON + raw PNG images under `assets/backgrounds/`. Deletions tracked via `local:sync-metadata/deleted-backgrounds/*`. |
| **Display Models** | `localforage` (`display-model-*`) | Binary GLB/Zip uploaded under `assets/models/{id}.bin`, with previews and textures saved as sidecar files. Manifested globally via `assets/models/manifest.json`. Deletions tracked via `local:sync-metadata/deleted-models/*`. |
