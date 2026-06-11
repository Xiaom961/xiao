<script setup lang="ts">
import { useBackgroundStore } from '@proj-airi/stage-ui/stores/background'
import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useSyncEngineStore } from '@proj-airi/stage-ui/stores/sync-engine'
import { storeToRefs } from 'pinia'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const syncStore = useSyncEngineStore()
const cardStore = useAiriCardStore()
const backgroundStore = useBackgroundStore()
const displayModelsStore = useDisplayModelsStore()

const {
  syncEnabled,
  syncInterval,
  conflictStrategy,
  activeProvider,
  isSyncing,
  lastSyncTime,
  syncError,
  conflicts,
  selectiveSyncEnabled,
  selectiveCheckedIds,
} = storeToRefs(syncStore)

// Selective Sync Modal states
const isSelectiveSyncOpen = ref(false)
const searchCharQuery = ref('')

const remoteCards = ref<Map<string, any>>(new Map())
const remoteModels = ref<any[]>([])
const remoteBgs = ref<any[]>([])
const remoteFilesList = ref<any[]>([])
const isLoadingRemote = ref(false)

interface TreeNode {
  id: string
  label: string
  size?: string
  checked: boolean
  required?: boolean
  children?: TreeNode[]
}

const syncTree = ref<TreeNode[]>([
  {
    id: 'metadata',
    label: 'Database Core & Settings',
    checked: true,
    required: true,
    children: [
      { id: 'meta-configs', label: 'App Settings & Provider Configurations', checked: true, required: true },
      { id: 'meta-cards', label: 'Character Cards Database (JSON metadata)', checked: true, required: true },
      { id: 'meta-shortmemory', label: 'Short-Term Memory summaries', checked: true, required: true },
    ],
  },
  {
    id: 'chats',
    label: 'Chat Sessions',
    checked: true,
    children: [],
  },
  {
    id: 'backgrounds',
    label: 'Custom Background Images',
    checked: false,
    children: [],
  },
  {
    id: 'models',
    label: 'Display Models (VRM / Live2D / Spine / MMD)',
    checked: false,
    children: [],
  },
])

const remoteLoadError = ref('')

async function fetchRemoteCatalogData() {
  isLoadingRemote.value = true
  remoteLoadError.value = ''
  try {
    const res = await syncStore.getRemoteCatalog()
    if (res && res.success) {
      // 1. Remote Cards
      const cardsMap = new Map()
      if (Array.isArray(res.cards)) {
        for (const [id, card] of res.cards) {
          cardsMap.set(id, card)
        }
      }
      remoteCards.value = cardsMap

      // 2. Remote Models
      remoteModels.value = res.models || []

      // 3. Remote Backgrounds
      remoteBgs.value = res.backgrounds || []

      // 4. Remote Files List
      remoteFilesList.value = res.remoteFiles || []
    }
    else {
      remoteLoadError.value = res?.error || 'Failed to retrieve remote catalog.'
    }
  }
  catch (e: any) {
    console.error('Failed to fetch remote catalog:', e)
    remoteLoadError.value = e.message || 'Network or connection error occurred.'
  }
  finally {
    isLoadingRemote.value = false
    updateSyncTree()
  }
}

watch(isSelectiveSyncOpen, async (isOpen) => {
  if (isOpen) {
    await fetchRemoteCatalogData()
  }
})

function updateSyncTree() {
  const checkedMap: Record<string, boolean> = {}

  if (selectiveSyncEnabled.value && selectiveCheckedIds.value && selectiveCheckedIds.value.length > 0) {
    for (const id of selectiveCheckedIds.value) {
      checkedMap[id] = true
    }
  }
  else {
    const saveCheckedState = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        checkedMap[node.id] = node.checked
        if (node.children) {
          saveCheckedState(node.children)
        }
      }
    }
    saveCheckedState(syncTree.value)
  }

  // Combine local and remote cards
  const allCards = new Map<string, any>()
  for (const [id, card] of remoteCards.value.entries()) {
    allCards.set(id, card)
  }
  for (const [id, card] of cardStore.cards.entries()) {
    allCards.set(id, card)
  }

  // 1. Core Metadata (Required)
  const metadataNode: TreeNode = {
    id: 'metadata',
    label: 'Database Core & Settings',
    checked: true,
    required: true,
    children: [
      { id: 'meta-configs', label: 'App Settings & Provider Configurations', checked: true, required: true },
      { id: 'meta-cards', label: 'Character Cards Database (JSON metadata)', checked: true, required: true },
      { id: 'meta-shortmemory', label: 'Short-Term Memory summaries', checked: true, required: true },
    ],
  }

  // 2. Chats (Representing dynamic profiles/chats in system)
  const chatChildren: TreeNode[] = []
  if (allCards.size > 0) {
    for (const [id, card] of allCards.entries()) {
      const chatNodeId = `chat-${id}`

      // Calculate size: check if we have remote files under db/chat/sessions/ for this ID
      const remoteChatFile = remoteFilesList.value.find(f =>
        f.relPath.replace(/\\/g, '/').startsWith(`db/chat/sessions/${id}.json`),
      )
      const sizeStr = remoteChatFile ? formatSize(remoteChatFile.size) : '150 KB'

      chatChildren.push({
        id: chatNodeId,
        label: card.name || 'Unnamed Session',
        size: sizeStr,
        checked: checkedMap[chatNodeId] !== false,
      })
    }
  }
  else {
    chatChildren.push(
      { id: 'chat-asuka', label: 'Asuka Langley Soryu', size: '250 KB', checked: checkedMap['chat-asuka'] !== false },
      { id: 'chat-kiana', label: 'Kiana Kaslana', size: '420 KB', checked: checkedMap['chat-kiana'] !== false },
      { id: 'chat-bronya', label: 'Bronya Zaychik', size: '1.2 MB', checked: checkedMap['chat-bronya'] !== false },
    )
  }

  const chatsNode: TreeNode = {
    id: 'chats',
    label: 'Chat Sessions',
    checked: checkedMap.chats !== false,
    children: chatChildren,
  }
  chatsNode.checked = chatChildren.some(c => c.checked)

  // 3. Backgrounds (Local + Remote)
  const localBgs = Array.from(backgroundStore.entries.values()).filter(e => e.type !== 'builtin')
  const allBgsMap = new Map<string, any>()
  for (const bg of remoteBgs.value) {
    allBgsMap.set(bg.id, {
      id: bg.id,
      characterId: bg.characterId,
      title: bg.title,
      size: bg.sizeBytes || 0,
      isRemote: true,
    })
  }
  for (const bg of localBgs) {
    allBgsMap.set(bg.id, {
      id: bg.id,
      characterId: bg.characterId,
      title: bg.title,
      size: bg.blob?.size || 0,
      isLocal: true,
    })
  }

  const bgEntries = Array.from(allBgsMap.values())
  const bgGroups: Record<string, { entries: any[], totalSize: number }> = {}
  for (const entry of bgEntries) {
    const charId = entry.characterId || 'shared'
    if (!bgGroups[charId]) {
      bgGroups[charId] = { entries: [], totalSize: 0 }
    }
    bgGroups[charId].entries.push(entry)
    bgGroups[charId].totalSize += entry.size
  }

  const backgroundChildren: TreeNode[] = []
  for (const [charId, group] of Object.entries(bgGroups)) {
    let id = ''
    let label = ''
    if (charId === 'shared') {
      id = 'bg-char-shared'
      label = 'Shared / Global Backgrounds'
    }
    else {
      const card = allCards.get(charId)
      if (card) {
        id = `bg-char-${charId}`
        label = `${card.name}'s Backgrounds`
      }
      else {
        id = `bg-char-uncategorized-${charId}`
        label = `Orphaned (${charId.slice(0, 8)})`
      }
    }

    const count = group.entries.length
    const sizeStr = `${formatSize(group.totalSize)} (${count} image${count === 1 ? '' : 's'})`
    backgroundChildren.push({
      id,
      label,
      size: sizeStr,
      checked: checkedMap[id] || false,
      totalSize: group.totalSize,
    } as any)
  }
  backgroundChildren.sort((a: any, b: any) => b.totalSize - a.totalSize)

  const backgroundsNode: TreeNode = {
    id: 'backgrounds',
    label: 'Custom Background Images',
    checked: checkedMap.backgrounds || false,
    children: backgroundChildren,
  }
  if (backgroundChildren.length > 0) {
    backgroundsNode.checked = backgroundChildren.some(c => c.checked)
  }

  // 4. Display Models (Local + Remote)
  const localModels = displayModelsStore.displayModels.filter(m => m.type === 'file')
  const allModelsMap = new Map<string, any>()
  for (const m of remoteModels.value) {
    allModelsMap.set(m.id, {
      id: m.id,
      name: m.name,
      format: m.format,
      sizeBytes: m.sizeBytes || 0,
      isRemote: true,
    })
  }
  for (const m of localModels) {
    const sizeBytes = (m as any).file?.size || 0
    allModelsMap.set(m.id, {
      id: m.id,
      name: m.name,
      format: m.format,
      sizeBytes,
      isLocal: true,
    })
  }

  // Resolve remote model size from remoteFiles list if missing
  for (const m of allModelsMap.values()) {
    if (!m.sizeBytes) {
      const binPath = `assets/models/${m.id}.bin`
      const remoteFile = remoteFilesList.value.find(rf => rf.relPath === binPath)
      if (remoteFile) {
        m.sizeBytes = remoteFile.size
      }
    }
  }

  const modelChildren: TreeNode[] = Array.from(allModelsMap.values()).map((model) => {
    return {
      id: `model-${model.id}`,
      label: `${model.name} (${model.format.toUpperCase()})`,
      size: formatSize(model.sizeBytes),
      checked: checkedMap[`model-${model.id}`] || false,
    }
  })

  const modelsNode: TreeNode = {
    id: 'models',
    label: 'Display Models (VRM / Live2D / Spine / MMD)',
    checked: checkedMap.models || false,
    children: modelChildren,
  }
  if (modelChildren.length > 0) {
    modelsNode.checked = modelChildren.some(c => c.checked)
  }

  syncTree.value = [
    metadataNode,
    chatsNode,
    backgroundsNode,
    modelsNode,
  ]
}

const allCardsMap = computed(() => {
  const cardsMap = new Map<string, any>()
  for (const [id, card] of remoteCards.value.entries()) {
    cardsMap.set(id, card)
  }
  for (const [id, card] of cardStore.cards.entries()) {
    cardsMap.set(id, card)
  }
  return cardsMap
})

watch(
  [() => backgroundStore.entries, () => displayModelsStore.displayModels, () => cardStore.cards],
  () => {
    updateSyncTree()
  },
  { deep: true, immediate: true },
)

const searchMatchesMessage = computed(() => {
  const query = searchCharQuery.value.trim().toLowerCase()
  if (!query)
    return ''

  const foundEntry = Array.from(allCardsMap.value.entries()).find(([_, card]) =>
    card.name?.toLowerCase().includes(query),
  )
  if (!foundEntry)
    return 'No matching characters'

  const [cardId, matchedCard] = foundEntry

  const localBgs = Array.from(backgroundStore.entries.values()).filter(e => e.type !== 'builtin')
  const allBgs = [...remoteBgs.value, ...localBgs]
  const charBgs = allBgs.filter(e => e.characterId === cardId)

  const referencedModelIds = new Set<string>()
  const defaultModelId = matchedCard.extensions?.airi?.modules?.displayModelId
  if (defaultModelId)
    referencedModelIds.add(defaultModelId)

  const visualAssets = matchedCard.extensions?.airi?.visual_assets || {}
  for (const asset of Object.values(visualAssets) as any[]) {
    if (asset.manifestation?.modelId) {
      referencedModelIds.add(asset.manifestation.modelId)
    }
  }

  const localModels = displayModelsStore.displayModels.filter(m => m.type === 'file')
  const allModels = [...remoteModels.value, ...localModels]
  const matchedModels = allModels.filter(m => referencedModelIds.has(m.id))

  return `Found: ${matchedCard.name} (${charBgs.length} Backgrounds, ${matchedModels.length} Models)`
})

function handleSelectRelated() {
  const query = searchCharQuery.value.trim().toLowerCase()
  if (!query)
    return

  const foundEntry = Array.from(allCardsMap.value.entries()).find(([_, card]) =>
    card.name?.toLowerCase().includes(query),
  )
  if (!foundEntry)
    return

  const [cardId, matchedCard] = foundEntry
  const targetIds = new Set<string>()

  // 1. Character background bundle ID
  targetIds.add(`bg-char-${cardId}`)

  // 2. Referenced display models and backgrounds
  const defaultModelId = matchedCard.extensions?.airi?.modules?.displayModelId
  if (defaultModelId)
    targetIds.add(`model-${defaultModelId}`)
  const defaultBgId = matchedCard.extensions?.airi?.modules?.activeBackgroundId
  if (defaultBgId) {
    const localBgs = Array.from(backgroundStore.entries.values()).filter(e => e.type !== 'builtin')
    const allBgs = [...remoteBgs.value, ...localBgs]
    const bgEntry = allBgs.find(e => e.id === defaultBgId)
    if (bgEntry) {
      const charId = bgEntry.characterId || 'shared'
      targetIds.add(charId === 'shared' ? 'bg-char-shared' : `bg-char-${charId}`)
    }
  }

  const visualAssets = matchedCard.extensions?.airi?.visual_assets || {}
  for (const asset of Object.values(visualAssets) as any[]) {
    if (asset.manifestation?.modelId) {
      targetIds.add(`model-${asset.manifestation.modelId}`)
    }
    if (asset.manifestation?.backgroundId) {
      const localBgs = Array.from(backgroundStore.entries.values()).filter(e => e.type !== 'builtin')
      const allBgs = [...remoteBgs.value, ...localBgs]
      const bgEntry = allBgs.find(e => e.id === asset.manifestation.backgroundId)
      if (bgEntry) {
        const charId = bgEntry.characterId || 'shared'
        targetIds.add(charId === 'shared' ? 'bg-char-shared' : `bg-char-${charId}`)
      }
    }
  }

  const cardNameLower = matchedCard.name?.toLowerCase() || ''

  for (const group of syncTree.value) {
    if (group.children) {
      for (const child of group.children) {
        if (child.required)
          continue

        const isChatMatch = group.id === 'chats' && (
          child.id.includes(cardId)
          || (cardNameLower && child.id.includes(cardNameLower))
          || child.label.toLowerCase().includes(cardNameLower)
        )

        if (targetIds.has(child.id) || isChatMatch) {
          child.checked = true
          group.checked = true
        }
      }
    }
  }
}

function toggleChild(parentIndex: number, childIndex: number) {
  const parent = syncTree.value[parentIndex]
  const child = parent.children![childIndex]
  if (child.required)
    return
  child.checked = !child.checked

  const anyChecked = parent.children!.some(c => c.checked)
  parent.checked = anyChecked
}

function toggleParent(parentIndex: number) {
  const parent = syncTree.value[parentIndex]
  if (parent.required)
    return
  parent.checked = !parent.checked
  if (parent.children) {
    for (const child of parent.children) {
      if (child.required)
        continue
      child.checked = parent.checked
    }
  }
}

async function triggerSelectiveSync() {
  const checkedIds: string[] = []
  const collectChecked = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.checked) {
        checkedIds.push(node.id)
      }
      if (node.children) {
        collectChecked(node.children)
      }
    }
  }
  collectChecked(syncTree.value)

  selectiveCheckedIds.value = checkedIds
  selectiveSyncEnabled.value = true

  isSelectiveSyncOpen.value = false
  await syncStore.triggerSync()
}

async function handleSyncAll() {
  selectiveSyncEnabled.value = false
  await syncStore.triggerSync()
}

function getConflictCharacterName(conflict: any): string {
  const charId = conflict.sessionDetails?.local?.characterId || conflict.sessionDetails?.remote?.characterId
  if (!charId)
    return ''
  const card = cardStore.cards.get(charId)
  return card?.name || charId
}

const formattedLastSync = computed(() => {
  if (!lastSyncTime.value)
    return 'Never'
  return new Date(lastSyncTime.value).toLocaleString()
})

function handleConfigureProvider() {
  if (activeProvider.value === 'local-fs') {
    router.push('/settings/providers/cloud/local-fs')
  }
  else if (activeProvider.value === 's3') {
    router.push('/settings/providers/cloud/s3')
  }
  else {
    router.push('/settings/providers#cloud')
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0)
    return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

function cleanKeyLabel(key: string): string {
  return key.replace('local:', '')
}

async function handleRestoreFromBackup() {
  const confirmed = confirm(
    'WARNING: This will completely wipe all local settings, characters, chat history, and assets, replacing them with the remote backup. This action cannot be undone.\n\nAre you sure you want to proceed?',
  )
  if (confirmed) {
    await syncStore.forceRestoreFromRemote()
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="h-fit w-full flex flex-col gap-4 rounded-xl bg-neutral-100 p-4 dark:bg-[rgba(0,0,0,0.3)]">
      <div>
        <h2 class="text-lg text-neutral-500 md:text-2xl dark:text-neutral-400">
          Cloud Sync Settings
        </h2>
        <div class="text-neutral-400 dark:text-neutral-500">
          Configure how and when your databases, character cards, memory segments, and media assets are synchronized.
        </div>
      </div>

      <!-- Sync Enable Switch -->
      <div class="flex items-center justify-between border-b border-neutral-200 py-3 dark:border-neutral-800">
        <div>
          <div class="text-neutral-700 font-medium dark:text-neutral-300">
            Enable Cloud Sync
          </div>
          <div class="text-xs text-neutral-400 dark:text-neutral-500">
            Automatically back up and sync your data in the background.
          </div>
        </div>
        <button
          class="relative h-6 w-11 inline-flex shrink-0 cursor-pointer border-2 border-transparent rounded-full transition-colors duration-200 ease-in-out focus:outline-none"
          :class="syncEnabled ? 'bg-primary-500' : 'bg-neutral-200 dark:bg-neutral-700'"
          role="switch"
          :aria-checked="syncEnabled"
          @click="syncEnabled = !syncEnabled"
        >
          <span
            pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out
            :class="syncEnabled ? 'translate-x-5' : 'translate-x-0'"
          />
        </button>
      </div>

      <!-- Sync Interval -->
      <div class="flex flex-col gap-2 border-b border-neutral-200 py-3 dark:border-neutral-800">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-neutral-700 font-medium dark:text-neutral-300">
              Sync Interval (Minutes)
            </div>
            <div class="text-xs text-neutral-400 dark:text-neutral-500">
              Time between automatic background sync loops.
            </div>
          </div>
          <span class="text-sm text-neutral-600 font-semibold dark:text-neutral-400">{{ syncInterval }} min</span>
        </div>
        <input
          v-model.number="syncInterval"
          type="range"
          min="5"
          max="120"
          step="5"
          class="h-2 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-primary-500 dark:bg-neutral-700"
        >
      </div>

      <!-- Conflict Strategy -->
      <div class="flex items-center justify-between border-b border-neutral-200 py-3 dark:border-neutral-800">
        <div>
          <div class="text-neutral-700 font-medium dark:text-neutral-300">
            Conflict Resolution Strategy
          </div>
          <div class="text-xs text-neutral-400 dark:text-neutral-500">
            How conflict is resolved if data diverges on multiple devices.
          </div>
        </div>
        <select
          v-model="conflictStrategy"
          class="border border-neutral-300 rounded-lg bg-white px-3 py-1.5 text-sm text-neutral-700 outline-none dark:border-neutral-700 focus:border-primary-500 dark:bg-neutral-800 dark:text-neutral-300"
        >
          <option value="lww">
            Last-Write-Wins (LWW)
          </option>
          <option value="remote-wins">
            Remote-Wins (Override Conflicts)
          </option>
        </select>
      </div>

      <!-- Active Provider Info -->
      <div class="flex items-center justify-between py-2">
        <div>
          <div class="text-neutral-700 font-medium dark:text-neutral-300">
            Active Storage Provider
          </div>
          <div class="text-xs text-neutral-400 dark:text-neutral-500">
            Choose which sync target is active.
          </div>
        </div>
        <div class="flex items-center gap-2">
          <select
            v-model="activeProvider"
            class="border border-neutral-300 rounded-lg bg-white px-3 py-1.5 text-sm text-neutral-700 outline-none dark:border-neutral-700 focus:border-primary-500 dark:bg-neutral-800 dark:text-neutral-300"
          >
            <option value="local-fs">
              Local File System / Samba
            </option>
            <option value="s3">
              S3-Compatible Cloud Storage
            </option>
          </select>
          <button
            class="border border-neutral-200 rounded-xl px-4 py-2 text-sm text-neutral-600 font-semibold outline-none transition-colors duration-200 dark:border-neutral-700 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800"
            @click="handleConfigureProvider"
          >
            Configure
          </button>
        </div>
      </div>
    </div>

    <!-- Sync Now Trigger Panel -->
    <div class="flex flex-col gap-4 border border-neutral-200 rounded-xl p-4 dark:border-neutral-800">
      <div class="flex flex-row items-center gap-3">
        <div class="size-10 flex items-center justify-center rounded-full bg-primary-500/10 text-primary-500">
          <div class="i-solar:refresh-bold text-xl" :class="{ 'animate-spin': isSyncing }" />
        </div>
        <div class="flex flex-col">
          <span class="text-neutral-700 font-semibold dark:text-neutral-300">Manual Synchronization</span>
          <span class="text-xs text-neutral-400 dark:text-neutral-500">Last Synced: {{ formattedLastSync }}</span>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <button
            class="border border-neutral-200 rounded-xl px-4 py-2.5 text-sm text-neutral-600 font-semibold outline-none transition-colors duration-200 dark:border-neutral-700 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800"
            :disabled="isSyncing"
            @click="isSelectiveSyncOpen = true"
          >
            Selective Sync...
          </button>
          <button
            class="rounded-xl bg-primary-500 px-5 py-2.5 text-sm text-white font-semibold transition-colors duration-200 hover:bg-primary-600 focus:outline-none"
            :disabled="isSyncing"
            @click="handleSyncAll"
          >
            {{ isSyncing ? 'Syncing...' : 'Sync All' }}
          </button>
        </div>
      </div>

      <div class="flex flex-row items-center border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <div class="size-10 flex items-center justify-center rounded-full bg-rose-500/10 text-rose-500">
          <div class="i-solar:shield-warning-bold text-xl" />
        </div>
        <div class="ml-3 flex flex-col">
          <span class="text-neutral-700 font-semibold dark:text-neutral-300">Restore Remote Backup</span>
          <span class="text-xs text-neutral-400 dark:text-neutral-500">Nuke local data and force restore all settings from remote.</span>
        </div>
        <button
          class="ml-auto rounded-xl bg-rose-600 px-5 py-2.5 text-sm text-white font-semibold transition-colors duration-200 hover:bg-rose-700 focus:outline-none"
          :disabled="isSyncing"
          @click="handleRestoreFromBackup"
        >
          Restore Backup...
        </button>
      </div>

      <div v-if="syncError" class="mt-2 flex items-center gap-2 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-600 font-medium dark:text-rose-400">
        <div class="i-solar:danger-bold text-lg" />
        <span>Failed: {{ syncError }}</span>
      </div>
    </div>

    <!-- Sync Conflicts Section -->
    <div v-if="conflicts && conflicts.length > 0" class="flex flex-col gap-4 border border-rose-200 rounded-xl bg-rose-50/50 p-4 dark:border-rose-900/30 dark:bg-rose-950/10">
      <div class="flex items-center gap-2 text-rose-600 dark:text-rose-400">
        <div class="i-solar:danger-bold animate-pulse text-xl" />
        <h3 class="text-lg font-semibold">
          Review Sync Conflicts
        </h3>
        <span class="rounded bg-rose-500 px-1.5 py-0.5 text-xs text-white font-bold">{{ conflicts.length }}</span>
      </div>
      <div class="text-xs text-neutral-500 dark:text-neutral-400">
        The sync engine blocked automatic overwriting for these files because a significant data contraction was detected. Please choose which version to keep, or merge them.
      </div>

      <div class="flex flex-col gap-3">
        <div v-for="conflict in conflicts" :key="conflict.key" class="flex flex-col gap-3 border border-rose-200/50 rounded-lg bg-white p-3 dark:border-rose-900/20 dark:bg-neutral-900">
          <div class="flex items-center justify-between border-b border-neutral-100 pb-2 dark:border-neutral-800">
            <span class="flex flex-wrap items-center gap-2 break-all pr-2 text-xs text-neutral-800 font-semibold dark:text-neutral-200">
              <span v-if="getConflictCharacterName(conflict)" class="shrink-0 rounded bg-primary-500/10 px-2 py-0.5 text-xs text-primary-600 font-bold dark:bg-primary-500/20 dark:text-primary-400">
                {{ getConflictCharacterName(conflict) }}
              </span>
              <span>{{ cleanKeyLabel(conflict.key) }}</span>
            </span>
            <span class="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">
              {{ new Date(conflict.conflictTime).toLocaleTimeString() }}
            </span>
          </div>

          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <!-- Local Version info -->
            <div class="flex flex-col gap-1 rounded bg-neutral-50 p-2 dark:bg-neutral-800/50">
              <div class="text-[10px] text-neutral-400 font-medium uppercase dark:text-neutral-500">
                Local (This Device)
              </div>
              <div class="text-xs text-neutral-800 font-bold dark:text-neutral-200">
                {{ formatSize(conflict.localSize) }}
              </div>
              <div class="text-[10px] text-neutral-500 dark:text-neutral-400">
                {{ new Date(conflict.localTimestamp).toLocaleString() }}
              </div>
              <div v-if="conflict.sessionDetails?.local" class="mt-1 flex flex-col gap-0.5 border-t border-neutral-200/50 pt-1 text-[10px] text-neutral-500 dark:border-neutral-700/50 dark:text-neutral-400">
                <div>Messages: <span class="font-semibold">{{ conflict.sessionDetails.local.messageCount }}</span></div>
                <div v-if="conflict.sessionDetails.local.lastMessage" class="max-w-[280px] truncate italic">
                  Last: "{{ conflict.sessionDetails.local.lastMessage }}"
                </div>
              </div>
            </div>

            <!-- Remote Version info -->
            <div class="flex flex-col gap-1 rounded bg-neutral-50 p-2 dark:bg-neutral-800/50">
              <div class="text-[10px] text-neutral-400 font-medium uppercase dark:text-neutral-500">
                Remote (Cloud/Backup)
              </div>
              <div class="text-xs text-neutral-800 font-bold dark:text-neutral-200">
                {{ formatSize(conflict.remoteSize) }}
              </div>
              <div class="text-[10px] text-neutral-500 dark:text-neutral-400">
                {{ new Date(conflict.remoteTimestamp).toLocaleString() }}
              </div>
              <div v-if="conflict.sessionDetails?.remote" class="mt-1 flex flex-col gap-0.5 border-t border-neutral-200/50 pt-1 text-[10px] text-neutral-500 dark:border-neutral-700/50 dark:text-neutral-400">
                <div>Messages: <span class="font-semibold">{{ conflict.sessionDetails.remote.messageCount }}</span></div>
                <div v-if="conflict.sessionDetails.remote.lastMessage" class="max-w-[280px] truncate italic">
                  Last: "{{ conflict.sessionDetails.remote.lastMessage }}"
                </div>
              </div>
            </div>
          </div>

          <div class="mt-1 flex flex-wrap gap-2">
            <button
              class="border border-neutral-200 rounded-xl px-3 py-1.5 text-xs text-neutral-700 font-semibold transition dark:border-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              @click="syncStore.resolveConflict(conflict.key, 'local')"
            >
              Keep Local
            </button>
            <button
              class="border border-neutral-200 rounded-xl px-3 py-1.5 text-xs text-neutral-700 font-semibold transition dark:border-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              @click="syncStore.resolveConflict(conflict.key, 'remote')"
            >
              Keep Remote
            </button>
            <button
              v-if="conflict.key.startsWith('local:chat/sessions/')"
              class="rounded-xl bg-primary-500 px-3 py-1.5 text-xs text-white font-semibold transition hover:bg-primary-600"
              @click="syncStore.resolveConflict(conflict.key, 'merge')"
            >
              Merge Message History
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Selective Sync Modal Dialog -->
  <DialogRoot :open="isSelectiveSyncOpen" @update:open="isSelectiveSyncOpen = $event">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-100 bg-black/60 backdrop-blur-sm data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-100 max-h-[85vh] max-w-2xl w-[90vw] flex flex-col border border-white/10 rounded-2xl bg-neutral-900/95 p-6 text-white shadow-2xl backdrop-blur-xl -translate-x-1/2 -translate-y-1/2 data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow focus:outline-none"
      >
        <DialogTitle class="mb-1 w-full flex items-center gap-2 text-xl font-bold">
          <div class="i-solar:shield-keyhole-bold-duotone text-2xl text-primary-400" />
          <span>Selective Sync Scope</span>
          <button
            class="ml-auto flex items-center gap-1.5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-neutral-400 font-semibold transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
            title="Refresh Remote Catalog"
            :disabled="isLoadingRemote"
            @click="fetchRemoteCatalogData"
          >
            <div class="i-solar:refresh-bold text-xs" :class="{ 'animate-spin': isLoadingRemote }" />
            <span>Refresh Remote</span>
          </button>
        </DialogTitle>
        <DialogDescription class="mb-4 text-xs text-neutral-400">
          Choose which databases and heavy media assets you want to synchronize with your storage backend. Required core metadata is always synced.
        </DialogDescription>

        <!-- Search Character Helper -->
        <div class="mb-4 border border-white/5 rounded-xl bg-neutral-950/40 p-3">
          <div class="mb-1.5 text-[10px] text-primary-400 font-bold tracking-wider uppercase">
            Select by Character Profile
          </div>
          <div class="flex items-center gap-2">
            <div class="relative flex-1">
              <input
                v-model="searchCharQuery"
                type="text"
                placeholder="Type character name (e.g. Asuka, Kiana, Bronya)..."
                class="w-full border border-white/10 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-white outline-none transition-colors focus:border-primary-500 placeholder-neutral-500"
              >
              <span v-if="searchMatchesMessage" class="absolute right-3 top-1/2 text-[10px] text-primary-400 font-semibold -translate-y-1/2">
                {{ searchMatchesMessage }}
              </span>
            </div>
            <button
              class="rounded-lg bg-primary-500 px-3 py-1.5 text-xs text-white font-bold transition-all hover:bg-primary-600 disabled:opacity-50"
              :disabled="!searchCharQuery"
              @click="handleSelectRelated"
            >
              Select All Related
            </button>
          </div>
        </div>

        <!-- Tree View Container -->
        <div class="mb-6 max-h-[40vh] flex flex-1 flex-col gap-4 overflow-y-auto border border-white/5 rounded-xl bg-neutral-950/25 p-4 scrollbar-thin">
          <div v-if="isLoadingRemote" class="flex flex-col items-center justify-center gap-3 py-12 text-neutral-400">
            <div class="i-solar:refresh-bold animate-spin text-3xl text-primary-400" />
            <div class="text-xs">
              Fetching remote assets and catalogs...
            </div>
          </div>

          <div v-else-if="remoteLoadError" class="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-rose-400">
            <div class="i-solar:danger-bold text-2xl" />
            <div class="text-xs font-semibold">
              Failed to fetch remote catalog
            </div>
            <div class="max-w-md break-words text-[10px] text-rose-500/85">
              {{ remoteLoadError }}
            </div>
            <button
              class="mt-2 rounded-lg bg-rose-500/20 px-3.5 py-1.5 text-xs text-rose-300 font-bold transition-colors hover:bg-rose-500/30"
              @click="fetchRemoteCatalogData"
            >
              Retry Connection
            </button>
          </div>

          <template v-else>
            <div v-for="(parent, pIdx) in syncTree" :key="parent.id" class="flex flex-col gap-2">
              <!-- Parent Node -->
              <div class="group flex items-center justify-between">
                <label class="flex cursor-pointer select-none items-center gap-2.5">
                  <input
                    type="checkbox"
                    :checked="parent.checked"
                    :disabled="parent.required"
                    class="border-white/10 rounded bg-neutral-800 text-primary-500 disabled:opacity-50 focus:ring-0 focus:ring-offset-0"
                    @change="toggleParent(pIdx)"
                  >
                  <span class="text-xs text-neutral-200 font-bold transition-colors group-hover:text-white" :class="{ 'text-primary-400': parent.required }">
                    {{ parent.label }}
                    <span v-if="parent.required" class="ml-1.5 rounded bg-primary-500/25 px-1.5 py-0.5 text-[9px] text-primary-400 tracking-wider uppercase">Required</span>
                  </span>
                </label>
              </div>

              <!-- Children Nodes -->
              <div v-if="parent.children" class="ml-1.5 flex flex-col gap-2.5 border-l border-white/5 pl-6">
                <div v-for="(child, cIdx) in parent.children" :key="child.id" class="group flex items-center justify-between">
                  <label class="flex cursor-pointer select-none items-center gap-2.5">
                    <input
                      type="checkbox"
                      :checked="child.checked"
                      :disabled="child.required"
                      class="border-white/10 rounded bg-neutral-800 text-primary-500 disabled:opacity-50 focus:ring-0 focus:ring-offset-0"
                      @change="toggleChild(pIdx, cIdx)"
                    >
                    <span class="text-xs text-neutral-400 transition-colors group-hover:text-neutral-200" :class="{ 'text-neutral-300 font-medium': child.checked }">
                      {{ child.label }}
                    </span>
                  </label>
                  <div class="flex items-center gap-2">
                    <span v-if="child.size" class="text-[10px] text-neutral-500 font-semibold">{{ child.size }}</span>
                    <span v-if="child.required" class="rounded bg-primary-500/10 px-1.5 py-0.5 text-[9px] text-primary-400">ALWAYS SYNCED</span>
                    <span v-else-if="child.size" class="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-400">HEAVY ASSET</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- Action Footer -->
        <div class="flex items-center justify-between border-t border-white/5 pt-4">
          <span class="text-[10px] text-neutral-400">Values are stored locally for subsequent background sync cycles.</span>
          <div class="flex gap-2">
            <button
              class="border border-white/10 rounded-xl px-4 py-2 text-xs text-neutral-300 font-semibold outline-none transition-colors duration-200 hover:bg-white/5"
              @click="isSelectiveSyncOpen = false"
            >
              Cancel
            </button>
            <button
              class="rounded-xl bg-primary-500 px-4 py-2 text-xs text-white font-bold transition-all hover:bg-primary-600"
              @click="triggerSelectiveSync"
            >
              Sync Selected
            </button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <div
    v-motion
    class="pointer-events-none fixed bottom-0 right-[-1.25rem] top-[calc(100dvh-15rem)] z-[-1] size-60 flex items-center justify-center text-neutral-200/50 dark:text-neutral-600/20"
    :initial="{ scale: 0.9, opacity: 0, x: 20 }"
    :enter="{ scale: 1, opacity: 1, x: 0 }"
    :duration="500"
  >
    <div class="i-solar:cloud-bold-duotone text-[60px]" />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.cloud-sync.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
