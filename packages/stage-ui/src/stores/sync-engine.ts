import localforage from 'localforage'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { useBroadcastChannel } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { toast } from 'vue-sonner'

import { storage, storageState } from '../database/storage'

export const useSyncEngineStore = defineStore('sync-engine', () => {
  // Sync Configuration State
  const syncEnabled = useLocalStorageManualReset<boolean>('settings/sync/enabled', false)
  const syncInterval = useLocalStorageManualReset<number>('settings/sync/interval', 30) // in minutes
  const conflictStrategy = useLocalStorageManualReset<'lww'>('settings/sync/conflict-strategy', 'lww')
  const activeProvider = useLocalStorageManualReset<string>('settings/sync/active-provider', 'local-fs')
  const fsBackupPath = useLocalStorageManualReset<string>('settings/sync/fs-path', '')

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

  // Helper to call Electron IPC
  const electron = (window as any).electron

  function hasElectron(): boolean {
    return Boolean(electron?.ipcRenderer)
  }

  async function validatePath(path: string): Promise<{ success: boolean, error?: string }> {
    if (!hasElectron()) {
      return { success: false, error: 'File system access is only available in the desktop application.' }
    }
    try {
      return await electron.ipcRenderer.invoke('byos-fs:validate-path', { path })
    }
    catch (err) {
      return { success: false, error: String(err) }
    }
  }

  // Normalize keys returned by storage.getKeys to their canonical slash-separated form
  function normalizeStorageKey(fullKey: string): string | null {
    if (fullKey.startsWith('local:airi-local:')) {
      const relative = fullKey.substring('local:airi-local:'.length)
      return `local:${relative.replace(/:/g, '/')}`
    }
    if (fullKey.startsWith('outbox:airi-sync-queue:')) {
      const relative = fullKey.substring('outbox:airi-sync-queue:'.length)
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
    try {
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

      // 2. List all remote files to find backgrounds
      const listRes = await electron.ipcRenderer.invoke('byos-fs:list-files', { dir: fsBackupPath.value })
      if (!listRes.success)
        return

      const remoteFiles = (listRes.files || []) as Array<{ relPath: string, mtime: number, size: number }>
      const remoteBgs = new Map<string, { json?: string, png?: string }>()
      for (const file of remoteFiles) {
        if (file.relPath.startsWith('assets/backgrounds/')) {
          const base = file.relPath.substring('assets/backgrounds/'.length)
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

      // 3. Process deletions (both remote and local)
      for (const id of deletedBgIds) {
        const remoteInfo = remoteBgs.get(id)
        if (remoteInfo) {
          if (remoteInfo.json) {
            await electron.ipcRenderer.invoke('byos-fs:delete-file', { dir: fsBackupPath.value, relPath: remoteInfo.json })
          }
          if (remoteInfo.png) {
            await electron.ipcRenderer.invoke('byos-fs:delete-file', { dir: fsBackupPath.value, relPath: remoteInfo.png })
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

      // 5. Upload backgrounds present locally but missing/incomplete on remote
      for (const [id, entry] of localBgs.entries()) {
        const remoteInfo = remoteBgs.get(id)
        if (!remoteInfo || !remoteInfo.png || !remoteInfo.json) {
          console.log(`[SyncEngine] Uploading background to remote: ${id}`)
          const { blob, ...metadata } = entry
          const jsonRelPath = `assets/backgrounds/${id}.json`
          await electron.ipcRenderer.invoke('byos-fs:write-file', {
            dir: fsBackupPath.value,
            relPath: jsonRelPath,
            content: JSON.stringify(metadata, null, 2),
          })

          if (blob instanceof Blob) {
            const base64 = await blobToBase64(blob)
            const pngRelPath = `assets/backgrounds/${id}.png`
            await electron.ipcRenderer.invoke('byos-fs:write-file', {
              dir: fsBackupPath.value,
              relPath: pngRelPath,
              content: base64,
              encoding: 'base64',
            })
          }
        }
      }

      // 6. Download backgrounds present on remote but missing locally
      let hasDownloads = false
      for (const [id, remoteInfo] of remoteBgs.entries()) {
        if (deletedBgIds.has(id))
          continue
        const existsLocally = localBgs.has(id)
        if (!existsLocally && remoteInfo.json && remoteInfo.png) {
          console.log(`[SyncEngine] Downloading background from remote: ${id}`)
          const readJson = await electron.ipcRenderer.invoke('byos-fs:read-file', {
            dir: fsBackupPath.value,
            relPath: remoteInfo.json,
          })
          if (!readJson.success || !readJson.content)
            continue
          const metadata = JSON.parse(readJson.content)

          const readPng = await electron.ipcRenderer.invoke('byos-fs:read-file', {
            dir: fsBackupPath.value,
            relPath: remoteInfo.png,
            encoding: 'base64',
          })
          if (!readPng.success || !readPng.content)
            continue

          const mimeType = 'image/png'
          const res = await fetch(`data:${mimeType};base64,${readPng.content}`)
          const blob = await res.blob()

          const entry = {
            ...metadata,
            id,
            blob,
          }

          await localforage.setItem(id, entry)
          hasDownloads = true
        }
      }

      if (hasDownloads) {
        // Trigger reload on other tabs and in the current store
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
    }
    catch (err) {
      console.error('[SyncEngine] Background reconciliation error:', err)
    }
  }

  // Convert relative file path back to storage key (e.g. db/chat/sessions/123.json -> local:chat/sessions/123)
  function getKeyForRelPath(relPath: string): string {
    if (relPath.startsWith('db/') && relPath.endsWith('.json')) {
      const clean = relPath.substring(3, relPath.length - 5)
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

  // Run full two-way reconciliation (LWW)
  async function reconcile(): Promise<boolean> {
    if (!hasElectron() || !fsBackupPath.value)
      return false

    const pathValidation = await validatePath(fsBackupPath.value)
    if (!pathValidation.success) {
      console.warn('[SyncEngine] Backup path is invalid/not mounted, skipping reconciliation:', pathValidation.error)
      return false
    }

    console.log('[SyncEngine] Starting reconciliation...')
    try {
      // 1. List all remote files in the backup directory
      const listRes = await electron.ipcRenderer.invoke('byos-fs:list-files', { dir: fsBackupPath.value })
      if (!listRes.success) {
        throw new Error(listRes.error || 'Failed to list remote files')
      }

      const remoteFiles = (listRes.files || []) as Array<{ relPath: string, mtime: number, size: number }>
      const remoteFileMap = new Map(remoteFiles.map(f => [getKeyForRelPath(f.relPath), f]))

      // 2. Scan all local metadata timestamps
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

      // Bypass sync outbox enqueuing during remote reconciliation writes
      storageState.isImportingRemoteData = true

      // 3. Resolve conflict resolution per remote file
      for (const [localKey, remoteFile] of remoteFileMap.entries()) {
        if (!localKey)
          continue

        const localTime = localTimestamps.get(localKey)

        const isMergeableKey = [
          'local:memory/short-term/local',
          'local:memory/text-journal/local',
          'local:memory/echo-chips/local',
        ].includes(localKey)

        if (isMergeableKey) {
          console.log(`[SyncEngine] Key ${localKey} is mergeable. Executing array-level merge...`)
          let remoteVal: any[] = []
          const readRes = await electron.ipcRenderer.invoke('byos-fs:read-file', {
            dir: fsBackupPath.value,
            relPath: remoteFile.relPath,
          })
          if (readRes.success && readRes.content) {
            try {
              remoteVal = JSON.parse(readRes.content)
            }
            catch (e) {
              console.error(`[SyncEngine] Failed to parse remote data for mergeable key ${localKey}:`, e)
            }
          }

          let localVal = await storage.getItemRaw<any[]>(localKey) || []
          if (!Array.isArray(localVal))
            localVal = []
          if (!Array.isArray(remoteVal))
            remoteVal = []

          const mergedVal = mergeArraysById(localVal, remoteVal)

          // Overwrite local
          storageState.isImportingRemoteData = true
          await storage.setItemRaw(localKey, mergedVal)
          storageState.isImportingRemoteData = false

          // Overwrite remote
          const writeRes = await electron.ipcRenderer.invoke('byos-fs:write-file', {
            dir: fsBackupPath.value,
            relPath: remoteFile.relPath,
            content: JSON.stringify(mergedVal, null, 2),
          })

          if (writeRes.success) {
            // Get stats to align timestamp
            const listRes = await electron.ipcRenderer.invoke('byos-fs:list-files', { dir: fsBackupPath.value })
            const matchingFile = listRes.files?.find((f: any) => f.relPath === remoteFile.relPath)
            if (matchingFile) {
              storageState.isImportingRemoteData = true
              await storage.setItemRaw(`local:sync-metadata/timestamps/${localKey.replace('local:', '')}`, matchingFile.mtime)
              storageState.isImportingRemoteData = false
            }
          }
          // Remove from localTimestamps map so normal loop doesn't process it again
          localTimestamps.delete(localKey)
          continue
        }

        if (localTime === undefined) {
          // Case A: Remote exists, but missing locally -> Download and import
          console.log(`[SyncEngine] Key ${localKey} missing locally. Downloading from remote...`)
          const readRes = await electron.ipcRenderer.invoke('byos-fs:read-file', {
            dir: fsBackupPath.value,
            relPath: remoteFile.relPath,
          })
          if (readRes.success && readRes.content) {
            const data = JSON.parse(readRes.content)
            await storage.setItemRaw(localKey, data)
            // Set local timestamp to match remote mtime
            await storage.setItemRaw(`local:sync-metadata/timestamps/${localKey.replace('local:', '')}`, remoteFile.mtime)
          }
        }
        else if (remoteFile.mtime > localTime) {
          // Case B: Remote file is newer -> Download and overwrite local
          console.log(`[SyncEngine] Remote file for ${localKey} is newer. Overwriting local...`)
          const readRes = await electron.ipcRenderer.invoke('byos-fs:read-file', {
            dir: fsBackupPath.value,
            relPath: remoteFile.relPath,
          })
          if (readRes.success && readRes.content) {
            const data = JSON.parse(readRes.content)
            await storage.setItemRaw(localKey, data)
            await storage.setItemRaw(`local:sync-metadata/timestamps/${localKey.replace('local:', '')}`, remoteFile.mtime)
          }
        }
        else if (localTime > remoteFile.mtime) {
          // Case C: Local is newer -> Upload to remote
          console.log(`[SyncEngine] Local key ${localKey} is newer. Preparing upload...`)
          const localVal = await storage.getItemRaw(localKey)
          if (localVal) {
            const writeRes = await electron.ipcRenderer.invoke('byos-fs:write-file', {
              dir: fsBackupPath.value,
              relPath: remoteFile.relPath,
              content: JSON.stringify(localVal, null, 2),
            })
            if (!writeRes.success) {
              console.error(`[SyncEngine] Failed to write remote file for ${localKey}:`, writeRes.error)
            }
          }
        }
      }

      // 4. Handle files that exist locally but not on remote
      for (const fullKey of localKeys) {
        if (fullKey.startsWith('local:sync-metadata/') || fullKey === 'local:sync-metadata')
          continue

        const remoteFile = remoteFileMap.get(fullKey)
        if (!remoteFile) {
          const relPath = getRelPathForKey(fullKey)
          console.log(`[SyncEngine] Key ${fullKey} exists locally only. Uploading... Path: ${relPath}`)

          // Try both getItem and getItemRaw to see which returns the data
          const localValRaw = await storage.getItemRaw(fullKey)
          const localVal = await storage.getItem(fullKey)
          console.log(`[SyncEngine] Key ${fullKey} localValRaw type: ${typeof localValRaw}, localVal type: ${typeof localVal}`)

          const valToUse = localVal ?? localValRaw
          if (valToUse !== undefined && valToUse !== null) {
            const writeRes = await electron.ipcRenderer.invoke('byos-fs:write-file', {
              dir: fsBackupPath.value,
              relPath,
              content: typeof valToUse === 'string' ? valToUse : JSON.stringify(valToUse, null, 2),
            })
            console.log(`[SyncEngine] Write response for ${fullKey}:`, writeRes)
            if (!writeRes.success) {
              console.error(`[SyncEngine] Failed to write remote file for ${fullKey}:`, writeRes.error)
              continue
            }
            // Update remote mtime reference in local timestamps
            const stats = await electron.ipcRenderer.invoke('byos-fs:list-files', { dir: fsBackupPath.value })
            const matchingFile = stats.files?.find((f: any) => f.relPath === relPath)
            if (matchingFile) {
              await storage.setItemRaw(`local:sync-metadata/timestamps/${fullKey.replace('local:', '')}`, matchingFile.mtime)
            }
          }
          else {
            console.warn(`[SyncEngine] Key ${fullKey} has no local content (both getItem and getItemRaw returned null/undefined).`)
          }
        }
      }

      await reconcileBackgrounds()

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
    if (!hasElectron() || !fsBackupPath.value)
      return false

    const rawOutboxKeys = await storage.getKeys('outbox')
    const outboxKeys = rawOutboxKeys.map(normalizeStorageKey).filter((k): k is string => k !== null).filter(k => k.startsWith('outbox:queue/'))
    if (outboxKeys.length === 0)
      return true

    console.log(`[SyncEngine] Processing ${outboxKeys.length} outbox queue items...`)

    try {
      for (const fullQueueKey of outboxKeys) {
        const item = await storage.getItemRaw<{ key: string, action: 'upsert' | 'delete', timestamp: number }>(fullQueueKey)
        if (!item) {
          await storage.removeItem(fullQueueKey)
          continue
        }

        const relPath = getRelPathForKey(item.key)

        if (item.action === 'upsert') {
          const isMergeableKey = [
            'local:memory/short-term/local',
            'local:memory/text-journal/local',
            'local:memory/echo-chips/local',
          ].includes(item.key)

          if (isMergeableKey) {
            console.log(`[SyncEngine] Outbox key ${item.key} is mergeable. Merging with remote...`)
            let remoteVal: any[] = []
            const readRes = await electron.ipcRenderer.invoke('byos-fs:read-file', {
              dir: fsBackupPath.value,
              relPath,
            })
            if (readRes.success && readRes.content) {
              try {
                remoteVal = JSON.parse(readRes.content)
              }
              catch (e) {}
            }
            let localVal = await storage.getItemRaw<any[]>(item.key) || []
            if (!Array.isArray(localVal))
              localVal = []
            if (!Array.isArray(remoteVal))
              remoteVal = []

            const mergedVal = mergeArraysById(localVal, remoteVal)

            // Overwrite local
            storageState.isImportingRemoteData = true
            await storage.setItemRaw(item.key, mergedVal)
            storageState.isImportingRemoteData = false

            // Overwrite remote
            const writeRes = await electron.ipcRenderer.invoke('byos-fs:write-file', {
              dir: fsBackupPath.value,
              relPath,
              content: JSON.stringify(mergedVal, null, 2),
            })
            if (!writeRes.success) {
              throw new Error(writeRes.error || 'Failed to write remote file')
            }
            // Align local timestamp with file modification time
            const stats = await electron.ipcRenderer.invoke('byos-fs:list-files', { dir: fsBackupPath.value })
            const matchingFile = stats.files?.find((f: any) => f.relPath === relPath)
            if (matchingFile) {
              storageState.isImportingRemoteData = true
              await storage.setItemRaw(`local:sync-metadata/timestamps/${item.key.replace('local:', '')}`, matchingFile.mtime)
              storageState.isImportingRemoteData = false
            }
          }
          else {
            const val = await storage.getItemRaw(item.key)
            if (val) {
              const writeRes = await electron.ipcRenderer.invoke('byos-fs:write-file', {
                dir: fsBackupPath.value,
                relPath,
                content: JSON.stringify(val, null, 2),
              })
              if (!writeRes.success) {
                throw new Error(writeRes.error || 'Failed to write remote file')
              }
              // Align local timestamp with file modification time
              const stats = await electron.ipcRenderer.invoke('byos-fs:list-files', { dir: fsBackupPath.value })
              const matchingFile = stats.files?.find((f: any) => f.relPath === relPath)
              if (matchingFile) {
                storageState.isImportingRemoteData = true
                await storage.setItemRaw(`local:sync-metadata/timestamps/${item.key.replace('local:', '')}`, matchingFile.mtime)
                storageState.isImportingRemoteData = false
              }
            }
          }
        }
        else if (item.action === 'delete') {
          const delRes = await electron.ipcRenderer.invoke('byos-fs:delete-file', {
            dir: fsBackupPath.value,
            relPath,
          })
          if (!delRes.success) {
            throw new Error(delRes.error || 'Failed to delete remote file')
          }
        }

        // Clean up outbox item
        await storage.removeItem(fullQueueKey)
      }
      return true
    }
    catch (err) {
      console.error('[SyncEngine] Failed to process outbox queue:', err)
      return false
    }
  }

  // Manual Trigger Sync
  async function triggerSync() {
    if (isSyncing.value)
      return
    isSyncing.value = true
    syncError.value = ''

    try {
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

      lastSyncTime.value = Date.now()
      localStorage.setItem('settings/sync/last-time', String(lastSyncTime.value))
      toast.success('Cloud Sync completed successfully')
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

  return {
    syncEnabled,
    syncInterval,
    conflictStrategy,
    activeProvider,
    fsBackupPath,
    isSyncing,
    lastSyncTime,
    syncError,

    validatePath,
    triggerSync,
  }
})
