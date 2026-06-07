import localforage from 'localforage'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { useBroadcastChannel } from '@vueuse/core'
import { AwsClient } from 'aws4fetch'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { toast } from 'vue-sonner'

import { storage, storageState } from '../database/storage'

export interface StorageClient {
  validate: () => Promise<{ success: boolean, error?: string }>
  listFiles: () => Promise<{ success: boolean, files?: Array<{ relPath: string, mtime: number, size: number }>, error?: string }>
  readFile: (relPath: string, encoding?: 'utf-8' | 'base64') => Promise<{ success: boolean, content?: string, error?: string }>
  writeFile: (relPath: string, content: string, encoding?: 'utf-8' | 'base64', append?: boolean) => Promise<{ success: boolean, mtime?: number, error?: string }>
  deleteFile: (relPath: string) => Promise<{ success: boolean, error?: string }>
}

export class ElectronFSClient implements StorageClient {
  private fsBackupPath: string
  private electron: any

  constructor(fsBackupPath: string) {
    this.fsBackupPath = fsBackupPath
    this.electron = (window as any).electron
  }

  private hasElectron(): boolean {
    return Boolean(this.electron?.ipcRenderer)
  }

  async validate(): Promise<{ success: boolean, error?: string }> {
    if (!this.hasElectron()) {
      return { success: false, error: 'File system access is only available in the desktop application.' }
    }
    return await this.electron.ipcRenderer.invoke('byos-fs:validate-path', { path: this.fsBackupPath })
  }

  async listFiles(): Promise<{ success: boolean, files?: Array<{ relPath: string, mtime: number, size: number }>, error?: string }> {
    if (!this.hasElectron()) {
      return { success: false, error: 'File system access is only available in the desktop application.' }
    }
    return await this.electron.ipcRenderer.invoke('byos-fs:list-files', { dir: this.fsBackupPath })
  }

  async readFile(relPath: string, encoding?: 'utf-8' | 'base64'): Promise<{ success: boolean, content?: string, error?: string }> {
    if (!this.hasElectron()) {
      return { success: false, error: 'File system access is only available in the desktop application.' }
    }
    return await this.electron.ipcRenderer.invoke('byos-fs:read-file', { dir: this.fsBackupPath, relPath, encoding })
  }

  async writeFile(relPath: string, content: string, encoding?: 'utf-8' | 'base64', append?: boolean): Promise<{ success: boolean, mtime?: number, error?: string }> {
    if (!this.hasElectron()) {
      return { success: false, error: 'File system access is only available in the desktop application.' }
    }
    return await this.electron.ipcRenderer.invoke('byos-fs:write-file', { dir: this.fsBackupPath, relPath, content, encoding, append })
  }

  async deleteFile(relPath: string): Promise<{ success: boolean, error?: string }> {
    if (!this.hasElectron()) {
      return { success: false, error: 'File system access is only available in the desktop application.' }
    }
    return await this.electron.ipcRenderer.invoke('byos-fs:delete-file', { dir: this.fsBackupPath, relPath })
  }
}

export class S3StorageClient implements StorageClient {
  private endpoint: string
  private bucket: string
  private region: string
  private client: AwsClient

  constructor(endpoint: string, bucket: string, region: string, accessKeyId: string, secretAccessKey: string) {
    this.endpoint = endpoint
    this.bucket = bucket
    this.region = region || 'us-east-1'
    this.client = new AwsClient({
      accessKeyId,
      secretAccessKey,
      region: this.region,
    })
  }

  private getS3Url(relPath: string): string {
    const cleanEndpoint = this.endpoint.replace(/\/+$/, '')
    const cleanPath = relPath.startsWith('/') ? relPath : `/${relPath}`
    if (cleanEndpoint.includes('amazonaws.com')) {
      return `https://${this.bucket}.s3.${this.region}.amazonaws.com${cleanPath}`
    }
    return `${cleanEndpoint}/${this.bucket}${cleanPath}`
  }

  async validate(): Promise<{ success: boolean, error?: string }> {
    try {
      const url = this.getS3Url('.byos-write-test')
      const putRes = await this.client.fetch(url, { method: 'PUT', body: 'test' })
      if (!putRes.ok) {
        return { success: false, error: `S3 PUT failed: ${putRes.status} ${putRes.statusText}` }
      }
      await this.client.fetch(url, { method: 'DELETE' })
      return { success: true }
    }
    catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  }

  async listFiles(): Promise<{ success: boolean, files?: Array<{ relPath: string, mtime: number, size: number }>, error?: string }> {
    try {
      let continuationToken: string | null = null
      const files: Array<{ relPath: string, mtime: number, size: number }> = []
      do {
        let url = `${this.getS3Url('')}?list-type=2`
        if (continuationToken) {
          url += `&continuation-token=${encodeURIComponent(continuationToken)}`
        }
        const res = await this.client.fetch(url)
        if (!res.ok) {
          return { success: false, error: `ListObjectsV2 failed: ${res.status} ${res.statusText}` }
        }
        const xmlText = await res.text()
        const xmlDoc = new DOMParser().parseFromString(xmlText, 'text/xml')
        const contents = xmlDoc.getElementsByTagName('Contents')
        for (let i = 0; i < contents.length; i++) {
          const node = contents[i]
          const key = node.getElementsByTagName('Key')[0]?.textContent || ''
          const lastModified = node.getElementsByTagName('LastModified')[0]?.textContent || ''
          const size = Number(node.getElementsByTagName('Size')[0]?.textContent || '0')
          if (key) {
            files.push({
              relPath: key,
              mtime: new Date(lastModified).getTime(),
              size,
            })
          }
        }
        const isTruncated = xmlDoc.getElementsByTagName('IsTruncated')[0]?.textContent === 'true'
        continuationToken = isTruncated ? (xmlDoc.getElementsByTagName('NextContinuationToken')[0]?.textContent || null) : null
      } while (continuationToken)

      return { success: true, files }
    }
    catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  }

  async readFile(relPath: string, encoding?: 'utf-8' | 'base64'): Promise<{ success: boolean, content?: string, error?: string }> {
    try {
      const url = this.getS3Url(relPath)
      const res = await this.client.fetch(url)
      if (res.status === 404) {
        return { success: false, error: 'ENOENT' }
      }
      if (!res.ok) {
        return { success: false, error: `S3 GET failed: ${res.status} ${res.statusText}` }
      }

      if (encoding === 'base64') {
        const blob = await res.blob()
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => {
            const result = reader.result as string
            const b64 = result.split(',')[1]
            resolve(b64)
          }
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
        return { success: true, content: base64 }
      }
      else {
        const text = await res.text()
        return { success: true, content: text }
      }
    }
    catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  }

  async writeFile(relPath: string, content: string, encoding?: 'utf-8' | 'base64', append?: boolean): Promise<{ success: boolean, mtime?: number, error?: string }> {
    try {
      const url = this.getS3Url(relPath)
      let body: Blob | string = content
      let contentType = 'application/json'

      if (encoding === 'base64') {
        const binRes = await fetch(`data:application/octet-stream;base64,${content}`)
        body = await binRes.blob()
        contentType = relPath.endsWith('.png') ? 'image/png' : 'application/octet-stream'
      }

      if (append) {
        let existingContent = ''
        const readRes = await this.readFile(relPath)
        if (readRes.success && readRes.content) {
          existingContent = readRes.content
        }
        body = existingContent + content
      }

      const res = await this.client.fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body,
      })
      if (!res.ok) {
        return { success: false, error: `S3 PUT failed: ${res.status} ${res.statusText}` }
      }
      return { success: true, mtime: Date.now() }
    }
    catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  }

  async deleteFile(relPath: string): Promise<{ success: boolean, error?: string }> {
    try {
      const url = this.getS3Url(relPath)
      const res = await this.client.fetch(url, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) {
        return { success: false, error: `S3 DELETE failed: ${res.status} ${res.statusText}` }
      }
      return { success: true }
    }
    catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  }
}

async function parallelLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
) {
  const promises: Promise<void>[] = []
  const executing = new Set<Promise<void>>()
  for (const item of items) {
    const p = fn(item).finally(() => {
      executing.delete(p)
    })
    promises.push(p)
    executing.add(p)
    if (executing.size >= limit) {
      await Promise.race(executing)
    }
  }
  await Promise.all(promises)
}

export const useSyncEngineStore = defineStore('sync-engine', () => {
  // Sync Configuration State
  const syncEnabled = useLocalStorageManualReset<boolean>('settings/sync/enabled', false)
  const syncInterval = useLocalStorageManualReset<number>('settings/sync/interval', 30) // in minutes
  const conflictStrategy = useLocalStorageManualReset<'lww'>('settings/sync/conflict-strategy', 'lww')
  const activeProvider = useLocalStorageManualReset<string>('settings/sync/active-provider', 'local-fs')
  const fsBackupPath = useLocalStorageManualReset<string>('settings/sync/fs-path', '')

  // S3 Configuration State
  const s3Endpoint = useLocalStorageManualReset<string>('settings/sync/s3-endpoint', '')
  const s3Bucket = useLocalStorageManualReset<string>('settings/sync/s3-bucket', '')
  const s3Region = useLocalStorageManualReset<string>('settings/sync/s3-region', 'us-east-1')
  const s3AccessKeyId = useLocalStorageManualReset<string>('settings/sync/s3-access-key-id', '')
  const s3SecretAccessKey = useLocalStorageManualReset<string>('settings/sync/s3-secret-access-key', '')

  // Runtime State
  const isSyncing = ref(false)
  const lastSyncTime = ref<number>(Number(localStorage.getItem('settings/sync/last-time') || '0'))
  const syncError = ref('')

  // Check and initialize default OS path if empty
  if (!fsBackupPath.value) {
    const userAgent = navigator.userAgent.toLowerCase()
    if (userAgent.includes('win')) {
      fsBackupPath.value = 'C:\\AIRI-Backup-Share'
    }
    else if (userAgent.includes('linux')) {
      fsBackupPath.value = '/mnt/AIRI-Backup-Share'
    }
    else {
      fsBackupPath.value = '/Volumes/AIRI-Backup-Share'
    }
  }

  // Helper to get active client
  function getActiveClient(): StorageClient {
    if (activeProvider.value === 's3') {
      return new S3StorageClient(
        s3Endpoint.value,
        s3Bucket.value,
        s3Region.value,
        s3AccessKeyId.value,
        s3SecretAccessKey.value,
      )
    }
    return new ElectronFSClient(fsBackupPath.value)
  }

  // Helper to call Electron IPC
  const electron = (window as any).electron

  function hasElectron(): boolean {
    return Boolean(electron?.ipcRenderer)
  }

  async function validateConnection(provider?: string): Promise<{ success: boolean, error?: string }> {
    const targetProvider = provider || activeProvider.value
    let client: StorageClient
    if (targetProvider === 's3') {
      client = new S3StorageClient(
        s3Endpoint.value,
        s3Bucket.value,
        s3Region.value,
        s3AccessKeyId.value,
        s3SecretAccessKey.value,
      )
    }
    else {
      client = new ElectronFSClient(fsBackupPath.value)
    }
    return await client.validate()
  }

  async function validatePath(path: string): Promise<{ success: boolean, error?: string }> {
    const client = new ElectronFSClient(path)
    return await client.validate()
  }

  // Normalize keys returned by storage.getKeys to their canonical slash-separated form
  function normalizeStorageKey(fullKey: string): string | null {
    if (fullKey.startsWith('local:airi-local:')) {
      const relative = fullKey.substring('local:airi-local:'.length)
      return `local:${relative.replace(/:/g, '/')}`
    }
    if (fullKey.startsWith('local:')) {
      const relative = fullKey.substring('local:'.length)
      return `local:${relative.replace(/:/g, '/')}`
    }
    if (fullKey.startsWith('outbox:airi-sync-queue:')) {
      const relative = fullKey.substring('outbox:airi-sync-queue:'.length)
      return `outbox:${relative.replace(/:/g, '/')}`
    }
    if (fullKey.startsWith('outbox:')) {
      const relative = fullKey.substring('outbox:'.length)
      return `outbox:${relative.replace(/:/g, '/')}`
    }
    return null
  }

  // Convert storage key to relative path on disk (e.g. local:chat/sessions/123 -> db/chat/sessions/123.json)
  function getRelPathForKey(key: string): string {
    const cleanKey = key.replace(/^local:/, '')
    // Replace colons with slashes to create nested directories, avoiding Windows filename colon restrictions
    return `db/${cleanKey.replace(/:/g, '/')}.json`
  }

  const { post: broadcastBgSync } = useBroadcastChannel({ name: 'airi:background-sync' })
  const { post: broadcastReload } = useBroadcastChannel({ name: 'airi:store-reload' })

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = reader.result as string
        const base64 = result.split(',')[1]
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  async function reconcileBackgrounds(): Promise<void> {
    console.log('[SyncEngine] Reconciling backgrounds...')
    await logDebug('Starting reconcileBackgrounds()')
    try {
      const client = getActiveClient()
      // 1. Get list of deleted background IDs from sync metadata
      const rawLocalKeys = await storage.getKeys('local')
      const localKeys = rawLocalKeys.map(normalizeStorageKey).filter((k): k is string => k !== null)
      const deletedBgIds = new Set<string>()
      const DELETED_PREFIX = 'local:sync-metadata/deleted-backgrounds/'
      for (const k of localKeys) {
        if (k.startsWith(DELETED_PREFIX)) {
          deletedBgIds.add(k.substring(DELETED_PREFIX.length))
        }
      }
      await logDebug(`deletedBgIds size: ${deletedBgIds.size}`)

      // 2. List all remote files to find backgrounds
      const listRes = await client.listFiles()
      if (!listRes.success) {
        await logDebug(`Failed to list remote files: ${listRes.error}`)
        return
      }

      const remoteFiles = (listRes.files || []) as Array<{ relPath: string, mtime: number, size: number }>
      const remoteBgs = new Map<string, { json?: string, png?: string }>()
      for (const file of remoteFiles) {
        const normalizedPath = file.relPath.replace(/\\/g, '/')
        if (normalizedPath.startsWith('assets/backgrounds/')) {
          const base = normalizedPath.substring('assets/backgrounds/'.length)
          const ext = base.split('.').pop()
          const id = base.substring(0, base.length - (ext ? ext.length + 1 : 0))
          if (!id)
            continue
          if (!remoteBgs.has(id)) {
            remoteBgs.set(id, {})
          }
          if (ext === 'json')
            remoteBgs.get(id)!.json = file.relPath
          if (ext === 'png')
            remoteBgs.get(id)!.png = file.relPath
        }
      }
      await logDebug(`remoteBgs size: ${remoteBgs.size}`)

      // 3. Process deletions (both remote and local)
      for (const id of deletedBgIds) {
        const remoteInfo = remoteBgs.get(id)
        if (remoteInfo) {
          if (remoteInfo.json) {
            await client.deleteFile(remoteInfo.json)
          }
          if (remoteInfo.png) {
            await client.deleteFile(remoteInfo.png)
          }
        }
        await localforage.removeItem(id)
      }

      // 4. Load all local backgrounds from localforage
      const localBgs = new Map<string, any>()
      await localforage.iterate<any, void>((val, key) => {
        if (key.startsWith('bg-') && !deletedBgIds.has(key)) {
          localBgs.set(key, val)
        }
      })
      await logDebug(`localBgs size (before uploads/downloads): ${localBgs.size}`)

      // 5. Upload backgrounds present locally but missing/incomplete on remote
      for (const [id, entry] of localBgs.entries()) {
        const remoteInfo = remoteBgs.get(id)
        if (!remoteInfo || !remoteInfo.png || !remoteInfo.json) {
          await logDebug(`Uploading background to remote: ${id} (title: ${entry.title}, characterId: ${entry.characterId})`)
          const { blob, ...metadata } = entry
          const jsonRelPath = `assets/backgrounds/${id}.json`
          await client.writeFile(jsonRelPath, JSON.stringify(metadata, null, 2))

          if (blob instanceof Blob) {
            const base64 = await blobToBase64(blob)
            const pngRelPath = `assets/backgrounds/${id}.png`
            await client.writeFile(pngRelPath, base64, 'base64')
          }
          else {
            await logDebug(`Warning: background ${id} has no valid Blob object locally.`)
          }
        }
      }

      // 6. Download backgrounds present on remote but missing locally
      let hasDownloads = false
      for (const [id, remoteInfo] of remoteBgs.entries()) {
        if (deletedBgIds.has(id))
          continue
        const localEntry = localBgs.get(id)
        const existsLocally = !!(localEntry && localEntry.blob instanceof Blob)

        await logDebug(`Checking background ${id}: existsLocally=${existsLocally}, hasJson=${!!remoteInfo.json}, hasPng=${!!remoteInfo.png}`)

        if (!existsLocally && remoteInfo.json && remoteInfo.png) {
          await logDebug(`Downloading background from remote: ${id}`)
          const readJson = await client.readFile(remoteInfo.json)
          if (!readJson.success || !readJson.content) {
            await logDebug(`Failed to read remote JSON for ${id}: ${readJson.error}`)
            continue
          }
          const metadata = JSON.parse(readJson.content)

          const readPng = await client.readFile(remoteInfo.png, 'base64')
          if (!readPng.success || !readPng.content) {
            await logDebug(`Failed to read remote PNG for ${id}: ${readPng.error}`)
            continue
          }

          const mimeType = 'image/png'
          const res = await fetch(`data:${mimeType};base64,${readPng.content}`)
          const blob = await res.blob()

          const entry = {
            ...metadata,
            id,
            blob,
          }

          await localforage.setItem(id, entry)
          await logDebug(`Successfully saved downloaded background ${id} (title: ${entry.title}, characterId: ${entry.characterId}) to localforage.`)
          hasDownloads = true
        }
      }

      if (hasDownloads) {
        broadcastBgSync(Date.now())
        try {
          const { useBackgroundStore } = await import('./background')
          const bgStore = useBackgroundStore()
          await bgStore.initializeStore()
        }
        catch (e) {
          console.error('[SyncEngine] Failed to refresh background store:', e)
        }
      }
      await logDebug('Finished reconcileBackgrounds()')
    }
    catch (err: any) {
      await logDebug(`Error in reconcileBackgrounds(): ${err.message || err}`)
      throw err
    }
  }

  async function reconcileModels(): Promise<void> {
    console.log('[SyncEngine] Reconciling models...')
    try {
      const client = getActiveClient()
      // 1. Get list of deleted model IDs from sync metadata
      const rawLocalKeys = await storage.getKeys('local')
      const localKeys = rawLocalKeys.map(normalizeStorageKey).filter((k): k is string => k !== null)
      const deletedModelIds = new Set<string>()
      const DELETED_PREFIX = 'local:sync-metadata/deleted-models/'
      for (const k of localKeys) {
        if (k.startsWith(DELETED_PREFIX)) {
          deletedModelIds.add(k.substring(DELETED_PREFIX.length))
        }
      }

      // 2. Read remote manifest
      let manifest: { models: Record<string, { id: string, format: string, name: string, importedAt: number, previewImage?: string, hasTextures: boolean, hasPreview?: boolean }> } = { models: {} }
      let manifestExists = false
      try {
        const readRes = await client.readFile('assets/models/manifest.json')
        if (readRes.success && readRes.content) {
          manifest = JSON.parse(readRes.content)
          manifestExists = true
        }
      }
      catch (e) {
        console.warn('[SyncEngine] Failed to read remote model manifest or it does not exist, initializing new manifest.', e)
      }

      let manifestModified = false

      // Migration: convert inline previewImage strings to sidecar files to shrink bloated manifest.json
      for (const [id, remoteModel] of Object.entries(manifest.models)) {
        if (remoteModel.previewImage && typeof remoteModel.previewImage === 'string' && remoteModel.previewImage.startsWith('data:')) {
          console.log(`[SyncEngine] Migrating bloated previewImage in manifest to sidecar for: ${id}`)
          const parts = remoteModel.previewImage.split(',')
          const base64 = parts[1]
          if (base64) {
            const previewRelPath = `assets/models/${id}-preview.png`
            const uploadRes = await client.writeFile(previewRelPath, base64, 'base64')
            if (uploadRes.success) {
              remoteModel.hasPreview = true
            }
          }
          delete remoteModel.previewImage
          manifestModified = true
        }
      }

      // 3. Process deletions (both remote and local)
      for (const id of deletedModelIds) {
        if (manifest.models[id]) {
          console.log(`[SyncEngine] Deleting remote model assets for: ${id}`)
          await client.deleteFile(`assets/models/${id}.bin`)
          if (manifest.models[id].hasTextures) {
            await client.deleteFile(`assets/models/${id}-textures.json`)
          }
          if (manifest.models[id].hasPreview) {
            await client.deleteFile(`assets/models/${id}-preview.png`)
          }
          delete manifest.models[id]
          manifestModified = true
        }
        await localforage.removeItem(id)
        await localforage.removeItem(`${id}-textures`)
        await storage.removeItem(`local:sync-metadata/timestamps/${id}`)
        await storage.removeItem(`local:sync-metadata/deleted-models/${id}`)
      }

      // 4. Load all local models from localforage (excluding presets & deleted models)
      const localModels = new Map<string, any>()
      await localforage.iterate<any, void>((val, key) => {
        if (key.startsWith('display-model-') && !deletedModelIds.has(key)) {
          localModels.set(key, val)
        }
      })

      // 5. Upload local-only models (not in remote manifest and not in local deleted list)
      for (const [id, entry] of localModels.entries()) {
        if (!manifest.models[id]) {
          // Check if we have sync history for it
          const hasSyncHistory = await storage.getItemRaw<number>(`local:sync-metadata/timestamps/${id}`)
          if (hasSyncHistory && manifestExists) {
            console.log(`[SyncEngine] Model ${id} (${entry.name}) has sync history but is missing from remote manifest. Deleting locally.`)
            await localforage.removeItem(id)
            await localforage.removeItem(`${id}-textures`)
            await storage.removeItem(`local:sync-metadata/timestamps/${id}`)
            continue
          }

          console.log(`[SyncEngine] Uploading model to remote: ${id} (${entry.name})`)
          if (entry.file instanceof Blob || entry.file instanceof File) {
            const base64 = await blobToBase64(entry.file)
            const binRelPath = `assets/models/${id}.bin`
            const uploadRes = await client.writeFile(binRelPath, base64, 'base64')
            if (!uploadRes.success) {
              console.error(`[SyncEngine] Failed to upload model binary for ${id}:`, uploadRes.error)
              continue
            }
          }
          else {
            console.warn(`[SyncEngine] Local model ${id} does not contain a valid File/Blob.`, entry)
            continue
          }

          // Check and upload textures if present
          let hasTextures = false
          const textures = await localforage.getItem<any[]>(`${id}-textures`).catch(() => null)
          if (textures && Array.isArray(textures) && textures.length > 0) {
            console.log(`[SyncEngine] Uploading textures for model: ${id}`)
            const texturesData = []
            for (const tex of textures) {
              if (tex.file instanceof Blob || tex.file instanceof File) {
                const texBase64 = await blobToBase64(tex.file)
                texturesData.push({
                  relativePath: tex.relativePath,
                  name: tex.file.name,
                  type: tex.file.type,
                  base64: texBase64,
                })
              }
            }
            if (texturesData.length > 0) {
              const texturesRelPath = `assets/models/${id}-textures.json`
              const texUploadRes = await client.writeFile(texturesRelPath, JSON.stringify(texturesData, null, 2))
              if (texUploadRes.success) {
                hasTextures = true
              }
              else {
                console.error(`[SyncEngine] Failed to upload textures for ${id}:`, texUploadRes.error)
              }
            }
          }

          // Check and upload preview image if present
          let hasPreview = false
          if (entry.previewImage && typeof entry.previewImage === 'string' && entry.previewImage.startsWith('data:')) {
            console.log(`[SyncEngine] Uploading preview image sidecar for: ${id}`)
            const parts = entry.previewImage.split(',')
            const base64 = parts[1]
            if (base64) {
              const previewRelPath = `assets/models/${id}-preview.png`
              const previewUploadRes = await client.writeFile(previewRelPath, base64, 'base64')
              if (previewUploadRes.success) {
                hasPreview = true
              }
              else {
                console.error(`[SyncEngine] Failed to upload preview for ${id}:`, previewUploadRes.error)
              }
            }
          }

          // Add to manifest
          manifest.models[id] = {
            id,
            format: entry.format,
            name: entry.name || '',
            importedAt: entry.importedAt || Date.now(),
            hasPreview,
            hasTextures,
          }
          manifestModified = true

          // Record sync history timestamp
          await storage.setItemRaw(`local:sync-metadata/timestamps/${id}`, Date.now())
        }
      }

      // 6. Download remote-only models (in remote manifest but missing locally)
      let hasDownloads = false
      for (const [id, remoteModel] of Object.entries(manifest.models)) {
        if (deletedModelIds.has(id))
          continue
        if (!localModels.has(id)) {
          console.log(`[SyncEngine] Downloading model from remote: ${id} (${remoteModel.name})`)
          const readBinRes = await client.readFile(`assets/models/${id}.bin`, 'base64')
          if (!readBinRes.success || !readBinRes.content) {
            console.error(`[SyncEngine] Failed to read remote model binary for ${id}:`, readBinRes.error)
            continue
          }

          // Reconstruct File object
          const mimeType = 'application/octet-stream'
          const res = await fetch(`data:${mimeType};base64,${readBinRes.content}`)
          const blob = await res.blob()
          const fileObj = new File([blob], remoteModel.name, { type: mimeType })

          // Download preview sidecar if present
          let previewImage: string | undefined
          if (remoteModel.hasPreview) {
            console.log(`[SyncEngine] Downloading model preview: ${id}`)
            const readPreviewRes = await client.readFile(`assets/models/${id}-preview.png`, 'base64')
            if (readPreviewRes.success && readPreviewRes.content) {
              previewImage = `data:image/png;base64,${readPreviewRes.content}`
            }
          }

          const entry = {
            id,
            format: remoteModel.format,
            type: 'file',
            file: fileObj,
            name: remoteModel.name,
            previewImage,
            importedAt: remoteModel.importedAt,
          }

          await localforage.setItem(id, entry)

          // Download textures if present
          if (remoteModel.hasTextures) {
            const readTexRes = await client.readFile(`assets/models/${id}-textures.json`)
            if (readTexRes.success && readTexRes.content) {
              const texturesData = JSON.parse(readTexRes.content)
              const textures: any[] = []
              for (const tex of texturesData) {
                const texMime = tex.type || 'image/png'
                const texRes = await fetch(`data:${texMime};base64,${tex.base64}`)
                const texBlob = await texRes.blob()
                const texFile = new File([texBlob], tex.name, { type: texMime })
                textures.push({
                  relativePath: tex.relativePath,
                  file: texFile,
                })
              }
              await localforage.setItem(`${id}-textures`, textures)
            }
          }

          // Record sync history timestamp
          await storage.setItemRaw(`local:sync-metadata/timestamps/${id}`, Date.now())
          hasDownloads = true
        }
      }

      // Write updated manifest to remote
      if (manifestModified) {
        console.log('[SyncEngine] Writing updated model manifest to remote.')
        await client.writeFile('assets/models/manifest.json', JSON.stringify(manifest, null, 2))
      }

      if (hasDownloads) {
        try {
          const { useDisplayModelsStore } = await import('./display-models')
          const modelStore = useDisplayModelsStore()
          await modelStore.loadDisplayModelsFromIndexedDB()
        }
        catch (e) {
          console.error('[SyncEngine] Failed to refresh display models store:', e)
        }
      }
    }
    catch (err) {
      console.error('[SyncEngine] Model reconciliation error:', err)
    }
  }

  function getKeyForRelPath(relPath: string): string {
    const normalized = relPath.replace(/\\/g, '/')
    if (normalized.startsWith('db/') && normalized.endsWith('.json')) {
      const clean = normalized.substring(3, normalized.length - 5)
      return `local:${clean}`
    }
    return ''
  }

  function mergeArraysById(localArr: any[], remoteArr: any[]): any[] {
    const mergedMap = new Map<string, any>()
    for (const item of localArr) {
      if (item && item.id) {
        mergedMap.set(item.id, item)
      }
    }
    for (const item of remoteArr) {
      if (item && item.id) {
        const existing = mergedMap.get(item.id)
        if (existing) {
          const existingTime = existing.updatedAt || existing.createdAt || 0
          const remoteTime = item.updatedAt || item.createdAt || 0
          if (remoteTime > existingTime) {
            mergedMap.set(item.id, item)
          }
        }
        else {
          mergedMap.set(item.id, item)
        }
      }
    }
    return Array.from(mergedMap.values())
  }

  // Merges two airi-cards Map-entry arrays.
  function mergeAiriCards(localVal: any, remoteVal: any): any {
    try {
      const localEntries = Array.isArray(localVal) ? localVal as [string, any][] : []
      const remoteEntries = Array.isArray(remoteVal) ? remoteVal as [string, any][] : []

      const mergedMap = new Map<string, any>()
      for (const [id, card] of localEntries) {
        if (id && card) {
          mergedMap.set(id, card)
        }
      }
      for (const [id, card] of remoteEntries) {
        if (id && card) {
          const existing = mergedMap.get(id)
          if (existing) {
            const existingTime = existing.updatedAt || existing.createdAt || 0
            const remoteTime = card.updatedAt || card.createdAt || 0
            if (remoteTime > existingTime) {
              mergedMap.set(id, card)
            }
          }
          else {
            mergedMap.set(id, card)
          }
        }
      }
      return Array.from(mergedMap.entries())
    }
    catch (e) {
      console.error('[SyncEngine] Failed to merge airi-cards:', e)
      return localVal || remoteVal
    }
  }

  // Merges two chat-session indexes.
  function mergeChatIndices(localVal: any, remoteVal: any): any {
    try {
      const localIdx = localVal && typeof localVal === 'object' && !Array.isArray(localVal) ? localVal : { characters: {} }
      const remoteIdx = remoteVal && typeof remoteVal === 'object' && !Array.isArray(remoteVal) ? remoteVal : { characters: {} }

      const mergedCharacters: Record<string, any> = {}
      const allCharacterIds = new Set([
        ...Object.keys(localIdx.characters || {}),
        ...Object.keys(remoteIdx.characters || {}),
      ])

      for (const charId of allCharacterIds) {
        const localChar = localIdx.characters?.[charId] || { sessions: {} }
        const remoteChar = remoteIdx.characters?.[charId] || { sessions: {} }

        const mergedSessions: Record<string, any> = {}
        const allSessionIds = new Set([
          ...Object.keys(localChar.sessions || {}),
          ...Object.keys(remoteChar.sessions || {}),
        ])

        let activeSessionId = localChar.activeSessionId || remoteChar.activeSessionId || ''

        for (const sessId of allSessionIds) {
          const localSess = localChar.sessions?.[sessId]
          const remoteSess = remoteChar.sessions?.[sessId]

          if (localSess && remoteSess) {
            const localTime = localSess.updatedAt || localSess.createdAt || 0
            const remoteTime = remoteSess.updatedAt || remoteSess.createdAt || 0
            if (remoteTime > localTime) {
              mergedSessions[sessId] = remoteSess
            }
            else {
              mergedSessions[sessId] = localSess
            }
          }
          else {
            mergedSessions[sessId] = localSess || remoteSess
          }
        }

        const localActiveSess = localChar.sessions?.[localChar.activeSessionId]
        const remoteActiveSess = remoteChar.sessions?.[remoteChar.activeSessionId]
        const localActiveTime = localActiveSess?.updatedAt || localActiveSess?.createdAt || 0
        const remoteActiveTime = remoteActiveSess?.updatedAt || remoteActiveSess?.createdAt || 0
        if (remoteActiveTime > localActiveTime && remoteChar.activeSessionId) {
          activeSessionId = remoteChar.activeSessionId
        }
        else if (localChar.activeSessionId) {
          activeSessionId = localChar.activeSessionId
        }

        mergedCharacters[charId] = {
          activeSessionId,
          sessions: mergedSessions,
        }
      }

      return {
        userId: localIdx.userId || remoteIdx.userId || 'local',
        characters: mergedCharacters,
      }
    }
    catch (e) {
      console.error('[SyncEngine] Failed to merge chat indices:', e)
      return localVal || remoteVal
    }
  }

  const conflicts = ref<any[]>([])

  async function logDebug(msg: string) {
    console.log(`[SyncEngine] ${msg}`)
    try {
      const logLine = `[${new Date().toISOString()}] ${msg}\n`
      const client = getActiveClient()
      if (activeProvider.value === 'local-fs' && hasElectron()) {
        await client.writeFile('sync-engine-debug.log', logLine, 'utf-8', true)
      }
    }
    catch (e) {
      console.error('[SyncEngine] Debug log failed:', e)
    }
  }

  async function loadConflicts() {
    try {
      const client = getActiveClient()
      const rawLocalKeys = await storage.getKeys('local')
      const localKeys = rawLocalKeys.map(normalizeStorageKey).filter((k): k is string => k !== null)
      const list: any[] = []
      const PREFIX = 'local:sync-metadata/conflicts/'
      for (const k of localKeys) {
        if (k.startsWith(PREFIX)) {
          const conflictData = await storage.getItemRaw<any>(k)
          if (conflictData) {
            if (conflictData.key.startsWith('local:chat/sessions/')) {
              try {
                const localVal = await storage.getItemRaw<any>(conflictData.key)
                let remoteVal: any = null
                const readRes = await client.readFile(conflictData.remoteRelPath)
                if (readRes.success && readRes.content) {
                  try {
                    remoteVal = JSON.parse(readRes.content)
                  }
                  catch (e) {}
                }

                conflictData.sessionDetails = {
                  local: localVal
                    ? {
                        characterId: localVal.meta?.characterId || '',
                        title: localVal.meta?.title || '',
                        messageCount: localVal.messages?.length || localVal.meta?.messageCount || 0,
                        lastMessage: localVal.messages?.[localVal.messages.length - 1]?.content || '',
                      }
                    : null,
                  remote: remoteVal
                    ? {
                        characterId: remoteVal.meta?.characterId || '',
                        title: remoteVal.meta?.title || '',
                        messageCount: remoteVal.messages?.length || remoteVal.meta?.messageCount || 0,
                        lastMessage: remoteVal.messages?.[remoteVal.messages.length - 1]?.content || '',
                      }
                    : null,
                }
              }
              catch (e) {
                console.error('[SyncEngine] Failed to enrich conflict details:', e)
              }
            }
            list.push(conflictData)
          }
        }
      }
      conflicts.value = list
      await logDebug(`loadConflicts: Loaded ${list.length} conflicts.`)
    }
    catch (e) {
      console.error('[SyncEngine] Failed to load conflicts:', e)
      await logDebug(`loadConflicts error: ${e}`)
    }
  }

  // Safety Heuristics Guard
  async function checkSyncConflict(localKey: string, localTime: number, remoteFile: { size: number, mtime: number, relPath: string }, type: 'remote-newer' | 'local-newer'): Promise<boolean> {
    const isCritical = localKey.startsWith('local:chat/sessions/') || localKey.startsWith('local:characters/') || localKey.startsWith('local:localstorage/') || localKey.startsWith('local:director/sessions/') || localKey.startsWith('local:chat/index/')
    await logDebug(`checkSyncConflict: key=${localKey}, type=${type}, critical=${isCritical}`)
    if (!isCritical)
      return false

    try {
      const localVal = await storage.getItemRaw(localKey)
      const localSize = localVal ? JSON.stringify(localVal).length : 0
      const remoteSize = remoteFile.size
      await logDebug(`checkSyncConflict stats for ${localKey}: localSize=${localSize}, remoteSize=${remoteSize}`)

      let isContraction = false
      if (type === 'remote-newer') {
        isContraction = remoteSize < localSize && localSize > 10240 && (remoteSize < 2048 || localSize > 5 * remoteSize)
      }
      else {
        isContraction = localSize < remoteSize && remoteSize > 10240 && (localSize < 2048 || remoteSize > 5 * localSize)
      }

      await logDebug(`checkSyncConflict outcome for ${localKey}: isContraction=${isContraction}`)

      if (isContraction) {
        await logDebug(`[WARNING] Safety conflict registered for ${localKey} (${type}). Local Size = ${localSize} bytes, Remote Size = ${remoteSize} bytes. Overwrite blocked.`)

        const conflictData = {
          key: localKey,
          localTimestamp: localTime,
          remoteTimestamp: remoteFile.mtime,
          localSize,
          remoteSize,
          remoteRelPath: remoteFile.relPath,
          conflictTime: Date.now(),
        }
        await storage.setItemRaw(`local:sync-metadata/conflicts/${localKey.replace('local:', '')}`, conflictData)
        return true
      }
    }
    catch (e) {
      console.error(`[SyncEngine] Error during safety check for ${localKey}:`, e)
      await logDebug(`checkSyncConflict error for ${localKey}: ${e}`)
    }
    return false
  }

  // Apply Resolution
  async function resolveConflict(localKey: string, choice: 'local' | 'remote' | 'merge') {
    const client = getActiveClient()
    const relPath = getRelPathForKey(localKey)
    const conflictMetadataKey = `local:sync-metadata/conflicts/${localKey.replace('local:', '')}`

    try {
      storageState.isImportingRemoteData = true

      if (choice === 'local') {
        console.log(`[SyncEngine] Resolving conflict for ${localKey} keeping LOCAL.`)
        const localVal = await storage.getItemRaw(localKey)
        if (localVal !== undefined && localVal !== null) {
          const writeRes = await client.writeFile(relPath, JSON.stringify(localVal, null, 2))
          if (writeRes.success) {
            const stats = await client.listFiles()
            const matchingFile = stats.files?.find((f: any) => f.relPath === relPath)
            if (matchingFile) {
              await storage.setItemRaw(`local:sync-metadata/timestamps/${localKey.replace('local:', '')}`, matchingFile.mtime)
            }
          }
          else {
            throw new Error(`Failed to write remote file: ${writeRes.error}`)
          }
        }
      }
      else if (choice === 'remote') {
        console.log(`[SyncEngine] Resolving conflict for ${localKey} keeping REMOTE.`)
        const readRes = await client.readFile(relPath)
        if (readRes.success && readRes.content) {
          const remoteVal = JSON.parse(readRes.content)
          await storage.setItemRaw(localKey, remoteVal)

          const stats = await client.listFiles()
          const matchingFile = stats.files?.find((f: any) => f.relPath === relPath)
          if (matchingFile) {
            await storage.setItemRaw(`local:sync-metadata/timestamps/${localKey.replace('local:', '')}`, matchingFile.mtime)
          }
        }
        else {
          throw new Error(`Failed to read remote file: ${readRes.error}`)
        }
      }
      else if (choice === 'merge') {
        console.log(`[SyncEngine] Resolving conflict for ${localKey} by MERGING arrays.`)
        const readRes = await client.readFile(relPath)
        if (readRes.success && readRes.content) {
          const remoteData = JSON.parse(readRes.content)
          const localData = await storage.getItemRaw(localKey)

          let mergedData: any = null

          if (localKey.startsWith('local:chat/sessions/')) {
            const isLocalObj = localData && typeof localData === 'object' && !Array.isArray(localData)
            const isRemoteObj = remoteData && typeof remoteData === 'object' && !Array.isArray(remoteData)

            const localMsgs = isLocalObj ? (localData.messages || []) : (Array.isArray(localData) ? localData : [])
            const remoteMsgs = isRemoteObj ? (remoteData.messages || []) : (Array.isArray(remoteData) ? remoteData : [])

            const mergedMsgs = mergeArraysById(localMsgs, remoteMsgs)

            if (isLocalObj) {
              mergedData = {
                ...localData,
                ...remoteData,
                messages: mergedMsgs,
                updatedAt: Date.now(),
              }
            }
            else {
              mergedData = mergedMsgs
            }
          }
          else {
            if (Array.isArray(localData) && Array.isArray(remoteData)) {
              mergedData = mergeArraysById(localData, remoteData)
            }
            else {
              mergedData = localData || remoteData
            }
          }

          await storage.setItemRaw(localKey, mergedData)

          const writeRes = await client.writeFile(relPath, JSON.stringify(mergedData, null, 2))
          if (writeRes.success) {
            const stats = await client.listFiles()
            const matchingFile = stats.files?.find((f: any) => f.relPath === relPath)
            if (matchingFile) {
              await storage.setItemRaw(`local:sync-metadata/timestamps/${localKey.replace('local:', '')}`, matchingFile.mtime)
            }
          }
          else {
            throw new Error(`Failed to write remote file: ${writeRes.error}`)
          }
        }
        else {
          throw new Error(`Failed to read remote file: ${readRes.error}`)
        }
      }

      await storage.removeItem(conflictMetadataKey)
      await loadConflicts()
      toast.success(`Conflict resolved successfully using ${choice} strategy`)
    }
    catch (e) {
      console.error(`[SyncEngine] Conflict resolution failed for ${localKey}:`, e)
      toast.error(`Resolution failed: ${e}`)
    }
    finally {
      storageState.isImportingRemoteData = false
    }
  }

  // Run full two-way reconciliation (LWW)
  async function reconcile(opts?: { skipBinaryAssets?: boolean }): Promise<boolean> {
    const client = getActiveClient()
    const pathValidation = await client.validate()
    if (!pathValidation.success) {
      console.warn('[SyncEngine] Sync storage target is invalid or inaccessible, skipping reconciliation:', pathValidation.error)
      return false
    }

    console.log('[SyncEngine] Starting reconciliation...')
    try {
      const listRes = await client.listFiles()
      if (!listRes.success) {
        throw new Error(listRes.error || 'Failed to list remote files')
      }

      const remoteFiles = (listRes.files || []) as Array<{ relPath: string, mtime: number, size: number }>
      const remoteFileMap = new Map(remoteFiles.map(f => [getKeyForRelPath(f.relPath), f]))

      const rawLocalKeys = await storage.getKeys('local')
      const localKeys = rawLocalKeys.map(normalizeStorageKey).filter((k): k is string => k !== null)
      const localTimestamps = new Map<string, number>()

      for (const fullKey of localKeys) {
        if (fullKey.startsWith('local:sync-metadata/timestamps/')) {
          const actualKey = `local:${fullKey.replace('local:sync-metadata/timestamps/', '')}`
          const t = await storage.getItemRaw<number>(fullKey)
          if (t) {
            localTimestamps.set(actualKey, t)
          }
        }
      }

      storageState.isImportingRemoteData = true

      const remoteEntries = Array.from(remoteFileMap.entries())
      await parallelLimit(remoteEntries, 15, async ([localKey, remoteFile]) => {
        if (!localKey)
          return

        const localTime = localTimestamps.get(localKey)
        await logDebug(`Reconciling key: ${localKey}, localTime=${localTime}, remoteMtime=${remoteFile.mtime}, remoteSize=${remoteFile.size}`)

        const isMergeableKey = [
          'local:memory/short-term/local',
          'local:memory/text-journal/local',
          'local:memory/echo-chips/local',
          'local:airi-cards',
        ].includes(localKey) || localKey.startsWith('local:chat/index/')

        if (isMergeableKey) {
          console.log(`[SyncEngine] Key ${localKey} is mergeable. Executing merge...`)
          let remoteVal: any = null
          const readRes = await client.readFile(remoteFile.relPath)
          if (readRes.success && readRes.content) {
            try {
              remoteVal = JSON.parse(readRes.content)
            }
            catch (e) {
              console.error(`[SyncEngine] Failed to parse remote data for mergeable key ${localKey}:`, e)
            }
          }

          const localVal = await storage.getItemRaw<any>(localKey)
          let mergedVal: any = null

          if (localKey === 'local:airi-cards') {
            mergedVal = mergeAiriCards(localVal, remoteVal)
          }
          else if (localKey.startsWith('local:chat/index/')) {
            mergedVal = mergeChatIndices(localVal, remoteVal)
          }
          else {
            let localArr = localVal || []
            let remoteArr = remoteVal || []
            if (!Array.isArray(localArr))
              localArr = []
            if (!Array.isArray(remoteArr))
              remoteArr = []
            mergedVal = mergeArraysById(localArr, remoteArr)
          }

          await storage.setItemRaw(localKey, mergedVal)

          const writeRes = await client.writeFile(remoteFile.relPath, JSON.stringify(mergedVal, null, 2))
          if (writeRes.success && writeRes.mtime) {
            await storage.setItemRaw(`local:sync-metadata/timestamps/${localKey.replace('local:', '')}`, writeRes.mtime)
          }
          localTimestamps.delete(localKey)
          return
        }

        if (localTime === undefined) {
          const localVal = await storage.getItemRaw(localKey)
          if (localVal !== undefined && localVal !== null) {
            await logDebug(`[Case A] Local key ${localKey} exists but localTime is undefined. Running safety check.`)
            const isConflict = await checkSyncConflict(localKey, 0, remoteFile, 'remote-newer')
            if (isConflict) {
              await logDebug(`[WARNING] Safety conflict registered for ${localKey} (Case A - local data exists). Overwrite blocked.`)
              return
            }
          }

          await logDebug(`[SyncEngine] Key ${localKey} missing locally (or safe). Downloading from remote...`)
          const readRes = await client.readFile(remoteFile.relPath)
          if (readRes.success && readRes.content) {
            const data = JSON.parse(readRes.content)
            await storage.setItemRaw(localKey, data)
            await storage.setItemRaw(`local:sync-metadata/timestamps/${localKey.replace('local:', '')}`, remoteFile.mtime)
          }
        }
        else if (remoteFile.mtime > localTime) {
          const isConflict = await checkSyncConflict(localKey, localTime, remoteFile, 'remote-newer')
          if (isConflict) {
            console.log(`[SyncEngine] Conflict safety guard blocked auto-overwrite of local key ${localKey}`)
            return
          }

          console.log(`[SyncEngine] Remote file for ${localKey} is newer. Overwriting local...`)
          const readRes = await client.readFile(remoteFile.relPath)
          if (readRes.success && readRes.content) {
            const data = JSON.parse(readRes.content)
            await storage.setItemRaw(localKey, data)
            await storage.setItemRaw(`local:sync-metadata/timestamps/${localKey.replace('local:', '')}`, remoteFile.mtime)
          }
        }
        else if (localTime > remoteFile.mtime) {
          const isConflict = await checkSyncConflict(localKey, localTime, remoteFile, 'local-newer')
          if (isConflict) {
            console.log(`[SyncEngine] Conflict safety guard blocked auto-overwrite of remote file for key ${localKey}`)
            return
          }

          console.log(`[SyncEngine] Local key ${localKey} is newer. Preparing upload...`)
          const localVal = await storage.getItemRaw(localKey)
          if (localVal) {
            const writeRes = await client.writeFile(remoteFile.relPath, JSON.stringify(localVal, null, 2))
            if (!writeRes.success) {
              console.error(`[SyncEngine] Failed to write remote file for ${localKey}:`, writeRes.error)
            }
          }
        }
      })

      const localKeysToUpload = localKeys.filter((fullKey) => {
        if (fullKey.startsWith('local:sync-metadata/') || fullKey === 'local:sync-metadata')
          return false
        return !remoteFileMap.has(fullKey)
      })

      await parallelLimit(localKeysToUpload, 15, async (fullKey) => {
        const relPath = getRelPathForKey(fullKey)
        console.log(`[SyncEngine] Key ${fullKey} exists locally only. Uploading... Path: ${relPath}`)

        const localValRaw = await storage.getItemRaw(fullKey)
        const localVal = await storage.getItem(fullKey)
        const valToUse = localVal ?? localValRaw
        if (valToUse !== undefined && valToUse !== null) {
          const writeRes = await client.writeFile(relPath, typeof valToUse === 'string' ? valToUse : JSON.stringify(valToUse, null, 2))
          if (!writeRes.success) {
            console.error(`[SyncEngine] Failed to write remote file for ${fullKey}:`, writeRes.error)
            return
          }
          if (writeRes.mtime) {
            await storage.setItemRaw(`local:sync-metadata/timestamps/${fullKey.replace('local:', '')}`, writeRes.mtime)
          }
        }
      })

      if (!opts?.skipBinaryAssets) {
        await reconcileBackgrounds()
        await reconcileModels()
      }
      else {
        console.log('[SyncEngine] Skipping binary asset reconciliation (startup mode).')
      }

      storageState.isImportingRemoteData = false
      return true
    }
    catch (err) {
      storageState.isImportingRemoteData = false
      console.error('[SyncEngine] Reconciliation error:', err)
      return false
    }
  }

  // Process the pending mutations in the outbox queue
  async function processOutbox(): Promise<boolean> {
    const client = getActiveClient()
    const pathValidation = await client.validate()
    if (!pathValidation.success) {
      return false
    }

    const rawOutboxKeys = await storage.getKeys('outbox')
    const outboxKeys = rawOutboxKeys.map(normalizeStorageKey).filter((k): k is string => k !== null).filter(k => k.startsWith('outbox:queue/'))
    if (outboxKeys.length === 0)
      return true

    console.log(`[SyncEngine] Processing ${outboxKeys.length} outbox queue items...`)

    storageState.isImportingRemoteData = true
    try {
      await parallelLimit(outboxKeys, 15, async (fullQueueKey) => {
        const item = await storage.getItemRaw<{ key: string, action: 'upsert' | 'delete', timestamp: number }>(fullQueueKey)
        if (!item) {
          await storage.removeItem(fullQueueKey)
          return
        }

        const conflictKey = `local:sync-metadata/conflicts/${item.key.replace('local:', '')}`
        const hasActiveConflict = await storage.getItemRaw(conflictKey)
        if (hasActiveConflict) {
          console.log(`[SyncEngine] Outbox processing skipped for ${item.key} due to active conflict.`)
          return
        }

        const relPath = getRelPathForKey(item.key)

        if (item.action === 'upsert') {
          const isMergeableKey = [
            'local:memory/short-term/local',
            'local:memory/text-journal/local',
            'local:memory/echo-chips/local',
            'local:airi-cards',
          ].includes(item.key) || item.key.startsWith('local:chat/index/')

          if (isMergeableKey) {
            console.log(`[SyncEngine] Outbox key ${item.key} is mergeable. Merging with remote...`)
            let remoteVal: any = null
            const readRes = await client.readFile(relPath)
            if (readRes.success && readRes.content) {
              try {
                remoteVal = JSON.parse(readRes.content)
              }
              catch (e) {}
            }
            const localVal = await storage.getItemRaw<any>(item.key)
            let mergedVal: any = null

            if (item.key === 'local:airi-cards') {
              mergedVal = mergeAiriCards(localVal, remoteVal)
            }
            else if (item.key.startsWith('local:chat/index/')) {
              mergedVal = mergeChatIndices(localVal, remoteVal)
            }
            else {
              let localArr = localVal || []
              let remoteArr = remoteVal || []
              if (!Array.isArray(localArr))
                localArr = []
              if (!Array.isArray(remoteArr))
                remoteArr = []
              mergedVal = mergeArraysById(localArr, remoteArr)
            }

            await storage.setItemRaw(item.key, mergedVal)

            const writeRes = await client.writeFile(relPath, JSON.stringify(mergedVal, null, 2))
            if (!writeRes.success) {
              throw new Error(writeRes.error || 'Failed to write remote file')
            }
            if (writeRes.mtime) {
              await storage.setItemRaw(`local:sync-metadata/timestamps/${item.key.replace('local:', '')}`, writeRes.mtime)
            }
          }
          else {
            const val = await storage.getItemRaw(item.key)
            if (val) {
              const writeRes = await client.writeFile(relPath, JSON.stringify(val, null, 2))
              if (!writeRes.success) {
                throw new Error(writeRes.error || 'Failed to write remote file')
              }
              if (writeRes.mtime) {
                await storage.setItemRaw(`local:sync-metadata/timestamps/${item.key.replace('local:', '')}`, writeRes.mtime)
              }
            }
          }
        }
        else if (item.action === 'delete') {
          const delRes = await client.deleteFile(relPath)
          if (!delRes.success) {
            throw new Error(delRes.error || 'Failed to delete remote file')
          }
        }

        await storage.removeItem(fullQueueKey)
      })
      storageState.isImportingRemoteData = false
      return true
    }
    catch (err) {
      storageState.isImportingRemoteData = false
      console.error('[SyncEngine] Failed to process outbox queue:', err)
      return false
    }
  }

  function shouldExcludeLocalStorageKey(key: string): boolean {
    // NOTICE: airi-cards and scene/backgrounds are too large for localStorage quota;
    // they are synced natively via IndexedDB / localforage so we exclude them from the dump/restore bridge.
    if (key === 'airi-cards')
      return true
    if (key === 'scene/backgrounds')
      return true
    if (key.startsWith('airi_cc_'))
      return true
    if (key.startsWith('settings/sync/'))
      return true
    return false
  }

  async function dumpLocalStorageToIndexedDb() {
    await logDebug('dumpLocalStorageToIndexedDb starting...')
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && !shouldExcludeLocalStorageKey(key)) {
        const val = localStorage.getItem(key) || ''
        const cachedVal = await storage.getItemRaw<{ value: string }>(`local:localstorage/${key}`)
        if (!cachedVal || cachedVal.value !== val) {
          await logDebug(`dumpLocalStorageToIndexedDb: key=${key} has changed. Writing to IndexedDB.`)
          await storage.setItemRaw(`local:localstorage/${key}`, { value: val })
        }
      }
    }
    await logDebug('dumpLocalStorageToIndexedDb completed.')
  }

  async function restoreLocalStorageFromIndexedDb() {
    await logDebug('restoreLocalStorageFromIndexedDb starting...')
    let anyChanged = false
    try {
      const rawLocalKeys = await storage.getKeys('local')
      const localKeys = rawLocalKeys.map(normalizeStorageKey).filter((k): k is string => k !== null)
      for (const fullKey of localKeys) {
        if (fullKey.startsWith('local:localstorage/')) {
          const key = fullKey.substring('local:localstorage/'.length)
          if (!shouldExcludeLocalStorageKey(key)) {
            const valObj = await storage.getItemRaw<{ value: string }>(fullKey)
            if (valObj && typeof valObj === 'object' && 'value' in valObj) {
              const val = valObj.value
              if (val !== null && val !== undefined) {
                const currentVal = localStorage.getItem(key)
                if (currentVal !== val) {
                  await logDebug(`restoreLocalStorageFromIndexedDb: key=${key} updated from IndexedDB.`)
                  try {
                    localStorage.setItem(key, val)
                    anyChanged = true
                    window.dispatchEvent(new StorageEvent('storage', {
                      key,
                      newValue: val,
                      storageArea: localStorage,
                    }))
                  }
                  catch (quotaErr) {
                    console.error(`[SyncEngine] Failed to write key ${key} to localStorage:`, quotaErr)
                    await logDebug(`Failed to write key ${key} to localStorage (quota exceeded).`)
                  }
                }
              }
            }
          }
        }
      }
      if (anyChanged) {
        await logDebug('restoreLocalStorageFromIndexedDb: LocalStorage changed. Reloading window...')
        toast.info('Settings updated, reloading interface...', { duration: 1500 })
        setTimeout(() => {
          window.location.reload()
        }, 1500)
      }
    }
    catch (e) {
      console.error('[SyncEngine] Failed to restore localStorage from IndexedDB:', e)
      await logDebug(`restoreLocalStorageFromIndexedDB error: ${e}`)
    }
    await logDebug('restoreLocalStorageFromIndexedDb completed.')
  }

  // Non-destructive startup restore: fills in localStorage keys that are ABSENT (null)
  // from the IndexedDB backup. Does NOT overwrite existing keys, does NOT reload.
  // Returns the list of keys that were written.
  async function restoreLocalStorageFromIndexedDbSafe(): Promise<string[]> {
    await logDebug('restoreLocalStorageFromIndexedDbSafe starting...')
    const restored: string[] = []
    try {
      const rawLocalKeys = await storage.getKeys('local')
      const localKeys = rawLocalKeys.map(normalizeStorageKey).filter((k): k is string => k !== null)
      for (const fullKey of localKeys) {
        if (fullKey.startsWith('local:localstorage/')) {
          const key = fullKey.substring('local:localstorage/'.length)
          if (shouldExcludeLocalStorageKey(key))
            continue
          // Only restore if the key is currently absent from localStorage
          if (localStorage.getItem(key) !== null)
            continue
          const valObj = await storage.getItemRaw<{ value: string }>(fullKey)
          if (valObj && typeof valObj === 'object' && 'value' in valObj) {
            const val = valObj.value
            if (val !== null && val !== undefined) {
              try {
                localStorage.setItem(key, val)
                restored.push(key)
                await logDebug(`restoreLocalStorageFromIndexedDbSafe: restored missing key=${key}`)
              }
              catch (quotaErr) {
                console.error(`[SyncEngine] Safe restore: quota exceeded for key ${key}:`, quotaErr)
              }
            }
          }
        }
      }
    }
    catch (e) {
      console.error('[SyncEngine] restoreLocalStorageFromIndexedDbSafe failed:', e)
      await logDebug(`restoreLocalStorageFromIndexedDbSafe error: ${e}`)
    }
    await logDebug(`restoreLocalStorageFromIndexedDbSafe completed. Restored ${restored.length} keys.`)
    return restored
  }

  // Called once at app boot. Fills in any missing localStorage keys from IndexedDB
  // (safe, non-destructive), then if sync is enabled and the backup path is reachable,
  // kicks off a background full reconcile to pull any IndexedDB keys that were also lost.
  async function initializeFromLocalBackup(): Promise<void> {
    await logDebug('initializeFromLocalBackup starting...')
    try {
      const restored = await restoreLocalStorageFromIndexedDbSafe()
      if (restored.length > 0) {
        console.log(`[SyncEngine] Boot restore: recovered ${restored.length} localStorage keys from IndexedDB:`, restored)
        // Dispatch storage events so reactive refs (useLocalStorage / useLocalStorageManualReset)
        // that are already initialized pick up the newly-written values.
        for (const key of restored) {
          window.dispatchEvent(new StorageEvent('storage', {
            key,
            newValue: localStorage.getItem(key),
            storageArea: localStorage,
          }))
        }
      }

      // Re-read syncEnabled directly from localStorage (the Pinia reactive ref may still
      // reflect the stale default=false value until Vue flushes the watcher queue).
      const syncEnabledRaw = localStorage.getItem('settings/sync/enabled')
      const syncIsOn = syncEnabledRaw === 'true'

      if (syncIsOn) {
        await logDebug('initializeFromLocalBackup: sync is enabled, kicking off background reconcile from disk...')
        // Run non-blocking so we don't block the rest of the App.vue startup pipeline.
        void (async () => {
          try {
            // CRITICAL: dump current localStorage to IDB FIRST so every key gets a fresh
            // timestamp (= now). This prevents the subsequent reconcile from treating
            // a slightly-older remote file as "newer" and downloading it on top of the
            // user's current provider/voice/settings configuration.
            await dumpLocalStorageToIndexedDb()
            // Run lightweight startup reconcile — JSON data only, skip models/backgrounds
            // to prevent OOM from loading large binary assets into the renderer heap.
            const success = await reconcile({ skipBinaryAssets: true })
            if (success) {
              await restoreLocalStorageFromIndexedDb()
              window.dispatchEvent(new CustomEvent('airi:idb-key-updated', { detail: { key: 'local:airi-cards' } }))
              await logDebug('initializeFromLocalBackup: background reconcile + restore complete.')
            }
          }
          catch (e) {
            console.error('[SyncEngine] initializeFromLocalBackup background reconcile failed:', e)
            await logDebug(`initializeFromLocalBackup background reconcile error: ${e}`)
          }
        })()
      }
    }
    catch (e) {
      console.error('[SyncEngine] initializeFromLocalBackup failed:', e)
      await logDebug(`initializeFromLocalBackup error: ${e}`)
    }
    await logDebug('initializeFromLocalBackup completed.')
  }

  // Manual Trigger Sync
  async function triggerSync() {
    if (isSyncing.value)
      return
    isSyncing.value = true
    syncError.value = ''

    try {
      // 0. Dump local storage changes
      await dumpLocalStorageToIndexedDb()

      // 1. Reconcile both ends
      const reconSuccess = await reconcile()
      if (!reconSuccess) {
        throw new Error('Reconciliation failed or backup directory is inaccessible.')
      }

      // 2. Process any remaining local outbox items
      const queueSuccess = await processOutbox()
      if (!queueSuccess) {
        throw new Error('Failed to fully process sync outbox.')
      }

      // 2.5. Restore synced values back to localStorage
      await restoreLocalStorageFromIndexedDb()

      // 2.6. Notify stores that consume native IndexedDB keys (not localStorage) to reload.
      // The airi-card store uses local:airi-cards directly in IndexedDB and has no automatic
      // reactivity watcher — dispatch an event so it can call loadCards() to pick up merged data.
      window.dispatchEvent(new CustomEvent('airi:idb-key-updated', { detail: { key: 'local:airi-cards' } }))

      await loadConflicts()

      lastSyncTime.value = Date.now()
      localStorage.setItem('settings/sync/last-time', String(lastSyncTime.value))
      toast.success('Cloud Sync completed successfully')
      broadcastReload(Date.now())
    }
    catch (err) {
      syncError.value = String(err)
      toast.error(`Sync Failed: ${syncError.value}`)
    }
    finally {
      isSyncing.value = false
    }
  }

  // Background Auto Sync Interval Trigger
  let syncTimer: any = null

  function startAutoSyncTimer() {
    stopAutoSyncTimer()
    if (!syncEnabled.value)
      return

    const ms = syncInterval.value * 60 * 1000
    syncTimer = setInterval(() => {
      void triggerSync()
    }, ms)
  }

  function stopAutoSyncTimer() {
    if (syncTimer) {
      clearInterval(syncTimer)
      syncTimer = null
    }
  }

  // Watchers to restart timer when config changes
  watch([syncEnabled, syncInterval], () => {
    if (syncEnabled.value) {
      startAutoSyncTimer()
    }
    else {
      stopAutoSyncTimer()
    }
  }, { immediate: true })

  // Initialize conflicts on store load
  void loadConflicts()

  return {
    syncEnabled,
    syncInterval,
    conflictStrategy,
    activeProvider,
    fsBackupPath,
    s3Endpoint,
    s3Bucket,
    s3Region,
    s3AccessKeyId,
    s3SecretAccessKey,
    isSyncing,
    lastSyncTime,
    syncError,
    conflicts,

    validatePath,
    validateConnection,
    triggerSync,
    resolveConflict,
    loadConflicts,
    initializeFromLocalBackup,
  }
})
