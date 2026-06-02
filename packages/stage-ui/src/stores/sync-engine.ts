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

  function mergeAiriCards(localVal: any, remoteVal: any): any {
    try {
      const localStr = localVal?.value || '[]'
      const remoteStr = remoteVal?.value || '[]'
      const localEntries = JSON.parse(localStr) as [string, any][]
      const remoteEntries = JSON.parse(remoteStr) as [string, any][]

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
      const mergedEntries = Array.from(mergedMap.entries())
      return { value: JSON.stringify(mergedEntries) }
    }
    catch (e) {
      console.error('[SyncEngine] Failed to merge airi-cards:', e)
      return localVal || remoteVal
    }
  }

  // Reactive State for conflicts
  const conflicts = ref<any[]>([])

  async function logDebug(msg: string) {
    console.log(`[SyncEngine] ${msg}`)
    if (hasElectron()) {
      try {
        const logLine = `[${new Date().toISOString()}] ${msg}\n`
        await electron.ipcRenderer.invoke('byos-fs:write-file', {
          dir: 'C:\\Users\\h4rdc\\Documents\\Github\\airi-rebase-scratch',
          relPath: 'sync-engine-debug.log',
          content: logLine,
          encoding: 'utf-8',
          append: true,
        })
      }
      catch (e) {
        console.error('[SyncEngine] Debug log failed:', e)
      }
    }
  }

  async function loadConflicts() {
    try {
      const rawLocalKeys = await storage.getKeys('local')
      const localKeys = rawLocalKeys.map(normalizeStorageKey).filter((k): k is string => k !== null)
      const list: any[] = []
      const PREFIX = 'local:sync-metadata/conflicts/'
      for (const k of localKeys) {
        if (k.startsWith(PREFIX)) {
          const conflictData = await storage.getItemRaw<any>(k)
          if (conflictData) {
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
    const isCritical = localKey.startsWith('local:chat/sessions/') || localKey.startsWith('local:characters/') || localKey.startsWith('local:localstorage/')
    await logDebug(`checkSyncConflict: key=${localKey}, type=${type}, critical=${isCritical}`)
    if (!isCritical)
      return false

    try {
      const localVal = await storage.getItemRaw(localKey)
      const localSize = localVal ? JSON.stringify(localVal).length : 0
      const remoteSize = remoteFile.size
      await logDebug(`checkSyncConflict stats for ${localKey}: localSize=${localSize}, remoteSize=${remoteSize}`)

      // Safety Guard Contraction Rule:
      // A conflict is registered if the newer file is significantly smaller than the older file:
      let isContraction = false
      if (type === 'remote-newer') {
        // Remote is newer but remote is much smaller than local
        isContraction = remoteSize < localSize && localSize > 10240 && (remoteSize < 2048 || localSize > 5 * remoteSize)
      }
      else {
        // Local is newer but local is much smaller than remote
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
    if (!hasElectron() || !fsBackupPath.value)
      return false

    const relPath = getRelPathForKey(localKey)
    const conflictMetadataKey = `local:sync-metadata/conflicts/${localKey.replace('local:', '')}`

    try {
      storageState.isImportingRemoteData = true

      if (choice === 'local') {
        console.log(`[SyncEngine] Resolving conflict for ${localKey} keeping LOCAL.`)
        const localVal = await storage.getItemRaw(localKey)
        if (localVal !== undefined && localVal !== null) {
          const writeRes = await electron.ipcRenderer.invoke('byos-fs:write-file', {
            dir: fsBackupPath.value,
            relPath,
            content: JSON.stringify(localVal, null, 2),
          })
          if (writeRes.success) {
            const stats = await electron.ipcRenderer.invoke('byos-fs:list-files', { dir: fsBackupPath.value })
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
        const readRes = await electron.ipcRenderer.invoke('byos-fs:read-file', {
          dir: fsBackupPath.value,
          relPath,
        })
        if (readRes.success && readRes.content) {
          const remoteVal = JSON.parse(readRes.content)
          await storage.setItemRaw(localKey, remoteVal)

          const stats = await electron.ipcRenderer.invoke('byos-fs:list-files', { dir: fsBackupPath.value })
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
        const readRes = await electron.ipcRenderer.invoke('byos-fs:read-file', {
          dir: fsBackupPath.value,
          relPath,
        })
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

          // Save locally
          await storage.setItemRaw(localKey, mergedData)

          // Write remotely
          const writeRes = await electron.ipcRenderer.invoke('byos-fs:write-file', {
            dir: fsBackupPath.value,
            relPath,
            content: JSON.stringify(mergedData, null, 2),
          })

          if (writeRes.success) {
            const stats = await electron.ipcRenderer.invoke('byos-fs:list-files', { dir: fsBackupPath.value })
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

      // Cleanup conflict metadata
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
        await logDebug(`Reconciling key: ${localKey}, localTime=${localTime}, remoteMtime=${remoteFile.mtime}, remoteSize=${remoteFile.size}`)

        const isMergeableKey = [
          'local:memory/short-term/local',
          'local:memory/text-journal/local',
          'local:memory/echo-chips/local',
          'local:localstorage/airi-cards',
        ].includes(localKey)

        if (isMergeableKey) {
          console.log(`[SyncEngine] Key ${localKey} is mergeable. Executing merge...`)
          let remoteVal: any = null
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

          const localVal = await storage.getItemRaw<any>(localKey)
          let mergedVal: any = null

          if (localKey === 'local:localstorage/airi-cards') {
            mergedVal = mergeAiriCards(localVal, remoteVal)
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
          // Safety Check: if the local key actually has data, run the safety conflict check
          // to prevent silently wiping out existing local data.
          const localVal = await storage.getItemRaw(localKey)
          if (localVal !== undefined && localVal !== null) {
            await logDebug(`[Case A] Local key ${localKey} exists but localTime is undefined. Running safety check.`)
            const isConflict = await checkSyncConflict(localKey, 0, remoteFile, 'remote-newer')
            if (isConflict) {
              await logDebug(`[WARNING] Safety conflict registered for ${localKey} (Case A - local data exists). Overwrite blocked.`)
              continue
            }
          }

          await logDebug(`[SyncEngine] Key ${localKey} missing locally (or safe). Downloading from remote...`)
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
          const isConflict = await checkSyncConflict(localKey, localTime, remoteFile, 'remote-newer')
          if (isConflict) {
            console.log(`[SyncEngine] Conflict safety guard blocked auto-overwrite of local key ${localKey}`)
            continue
          }

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
          const isConflict = await checkSyncConflict(localKey, localTime, remoteFile, 'local-newer')
          if (isConflict) {
            console.log(`[SyncEngine] Conflict safety guard blocked auto-overwrite of remote file for key ${localKey}`)
            continue
          }

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

        // Safety Gate: Skip outbox upload if there is an active sync conflict registered for this key
        const conflictKey = `local:sync-metadata/conflicts/${item.key.replace('local:', '')}`
        const hasActiveConflict = await storage.getItemRaw(conflictKey)
        if (hasActiveConflict) {
          console.log(`[SyncEngine] Outbox processing skipped for ${item.key} due to active conflict.`)
          continue
        }

        const relPath = getRelPathForKey(item.key)

        if (item.action === 'upsert') {
          const isMergeableKey = [
            'local:memory/short-term/local',
            'local:memory/text-journal/local',
            'local:memory/echo-chips/local',
            'local:localstorage/airi-cards',
          ].includes(item.key)

          if (isMergeableKey) {
            console.log(`[SyncEngine] Outbox key ${item.key} is mergeable. Merging with remote...`)
            let remoteVal: any = null
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
            const localVal = await storage.getItemRaw<any>(item.key)
            let mergedVal: any = null

            if (item.key === 'local:localstorage/airi-cards') {
              mergedVal = mergeAiriCards(localVal, remoteVal)
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

  function shouldExcludeLocalStorageKey(key: string): boolean {
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
                  localStorage.setItem(key, val)
                  anyChanged = true
                  window.dispatchEvent(new StorageEvent('storage', {
                    key,
                    newValue: val,
                    storageArea: localStorage,
                  }))
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
    isSyncing,
    lastSyncTime,
    syncError,
    conflicts,

    validatePath,
    triggerSync,
    resolveConflict,
    loadConflicts,
  }
})
