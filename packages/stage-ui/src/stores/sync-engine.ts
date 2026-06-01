import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
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

  // Convert relative file path back to storage key (e.g. db/chat/sessions/123.json -> local:chat/sessions/123)
  function getKeyForRelPath(relPath: string): string {
    if (relPath.startsWith('db/') && relPath.endsWith('.json')) {
      const clean = relPath.substring(3, relPath.length - 5)
      return `local:${clean}`
    }
    return ''
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
