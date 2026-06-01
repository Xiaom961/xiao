<script setup lang="ts">
import { useSyncEngineStore } from '@proj-airi/stage-ui/stores/sync-engine'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const syncStore = useSyncEngineStore()

const {
  syncEnabled,
  syncInterval,
  conflictStrategy,
  activeProvider,
  fsBackupPath,
  isSyncing,
  lastSyncTime,
  syncError,
} = storeToRefs(syncStore)

const formattedLastSync = computed(() => {
  if (!lastSyncTime.value)
    return 'Never'
  return new Date(lastSyncTime.value).toLocaleString()
})

const activeProviderLabel = computed(() => {
  if (activeProvider.value === 'local-fs') {
    return 'Local File System / Samba'
  }
  return activeProvider.value || 'Not Configured'
})

function handleConfigureProvider() {
  if (activeProvider.value === 'local-fs') {
    router.push('/settings/providers/cloud/local-fs')
  }
  else {
    router.push('/settings/providers#cloud')
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
        </select>
      </div>

      <!-- Active Provider Info -->
      <div class="flex items-center justify-between py-2">
        <div>
          <div class="text-neutral-700 font-medium dark:text-neutral-300">
            Active Storage Provider
          </div>
          <div class="text-xs text-neutral-400 dark:text-neutral-500">
            {{ activeProviderLabel }}
          </div>
        </div>
        <button
          class="border border-neutral-200 rounded-xl px-4 py-2 text-sm text-neutral-600 font-semibold outline-none transition-colors duration-200 dark:border-neutral-700 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800"
          @click="handleConfigureProvider"
        >
          Configure
        </button>
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
        <button
          class="ml-auto rounded-xl bg-primary-500 px-5 py-2.5 text-sm text-white font-semibold transition-colors duration-200 hover:bg-primary-600 focus:outline-none"
          :disabled="isSyncing"
          @click="syncStore.triggerSync"
        >
          {{ isSyncing ? 'Syncing...' : 'Sync Now' }}
        </button>
      </div>

      <div v-if="syncError" class="mt-2 flex items-center gap-2 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-600 font-medium dark:text-rose-400">
        <div class="i-solar:danger-bold text-lg" />
        <span>Failed: {{ syncError }}</span>
      </div>
    </div>
  </div>

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
