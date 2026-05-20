<script setup lang="ts">
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { CUSTOMIZER_CATALOG } from '@proj-airi/stage-ui/constants/control-customizer'
import { useLiveSessionStore } from '@proj-airi/stage-ui/stores/modules/live-session'
import { useSettings, useSettingsAudioDevice, useSettingsControlStrip } from '@proj-airi/stage-ui/stores/settings'
import { usePositioningStore } from '@proj-airi/stage-ui/stores/settings/positioning'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'

import { electronCustomizerToggleVisibility } from '../../shared/eventa'

const settingsStore = useSettings()
const controlStripStore = useSettingsControlStrip()
const positioningStore = usePositioningStore()
const settingsAudioDeviceStore = useSettingsAudioDevice()
const liveSessionStore = useLiveSessionStore()

const { buttons } = storeToRefs(controlStripStore)
const { powerState } = storeToRefs(liveSessionStore)

const toggleCustomizerVisibility = useElectronEventaInvoke(electronCustomizerToggleVisibility)

const modelSelected = computed(() => settingsStore.stageModelSelected || 'default')

// Navigation state
const activeGroupId = ref('ai-gemini')

const activeGroup = computed(() => {
  return CUSTOMIZER_CATALOG.find(g => g.id === activeGroupId.value) || CUSTOMIZER_CATALOG[0]
})

// Bound state resolvers
function isBoundActive(binding: 'chatOpen' | 'stageEnabled' | 'micEnabled' | 'captionOpen' | 'geminiSession' | undefined): boolean {
  if (!binding)
    return false
  if (binding === 'chatOpen')
    return controlStripStore.chatOpen
  if (binding === 'stageEnabled')
    return controlStripStore.stageEnabled
  if (binding === 'captionOpen')
    return controlStripStore.captionOpen
  if (binding === 'micEnabled')
    return settingsAudioDeviceStore.enabled
  if (binding === 'geminiSession')
    return powerState.value !== 'off'
  return false
}

function toggleBoundState(binding: 'chatOpen' | 'stageEnabled' | 'micEnabled' | 'captionOpen' | 'geminiSession' | undefined) {
  if (!binding)
    return
  if (binding === 'chatOpen')
    controlStripStore.chatOpen = !controlStripStore.chatOpen
  if (binding === 'stageEnabled')
    controlStripStore.stageEnabled = !controlStripStore.stageEnabled
  if (binding === 'captionOpen')
    controlStripStore.captionOpen = !controlStripStore.captionOpen
  if (binding === 'micEnabled')
    settingsAudioDeviceStore.enabled = !settingsAudioDeviceStore.enabled
  if (binding === 'geminiSession') {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('control-strip:action', { detail: { action: 'gemini-session' } }))
    }
  }
}

const geminiDotClasses = computed(() => {
  if (powerState.value === 'busy') {
    return 'bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.8)] animate-pulse'
  }
  if (powerState.value === 'active') {
    return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]'
  }
  if (powerState.value === 'connecting') {
    return 'bg-sky-400 animate-pulse'
  }
  if (powerState.value === 'ambient') {
    return 'bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]'
  }
  return 'bg-neutral-400/50'
})

// Control strip items inclusion getters
function isItemOnStrip(itemId: string): boolean {
  const btn = buttons.value.find(b => b.id === itemId)
  return btn ? btn.enabled : false
}

function toggleItemOnStrip(itemId: string) {
  const btn = buttons.value.find(b => b.id === itemId)
  if (btn) {
    btn.enabled = !btn.enabled
  }
  else {
    const catalogItem = CUSTOMIZER_CATALOG.flatMap(g => g.items).find(i => i.id === itemId)
    if (catalogItem) {
      buttons.value.push({
        id: catalogItem.id,
        enabled: true,
        label: catalogItem.label,
        icon: catalogItem.icon,
      })
    }
  }
}

// Action triggers
function handleAction(actionId: string) {
  console.info(`[Control Customizer] Triggering action direct dispatch: "${actionId}"`)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('control-strip:action', { detail: { action: actionId } }))
  }
}

const currentPosition = computed(() => {
  return positioningStore.getPosition(modelSelected.value)
})

const xVal = computed({
  get: () => currentPosition.value.x,
  set: (v) => {
    positioningStore.setPosition(modelSelected.value, {
      ...currentPosition.value,
      x: Number(v),
    })
  },
})

const yVal = computed({
  get: () => currentPosition.value.y,
  set: (v) => {
    positioningStore.setPosition(modelSelected.value, {
      ...currentPosition.value,
      y: Number(v),
    })
  },
})

const scaleVal = computed({
  get: () => currentPosition.value.scale,
  set: (v) => {
    positioningStore.setPosition(modelSelected.value, {
      ...currentPosition.value,
      scale: Number(v),
    })
  },
})

async function closeWindow() {
  await toggleCustomizerVisibility(false)
}

function resetPlacement() {
  positioningStore.setPosition(modelSelected.value, { x: 0, y: 0, scale: 1 })
}
</script>

<template>
  <div class="h-screen w-screen flex flex-col select-none overflow-hidden bg-transparent p-3 font-sans">
    <!-- Premium Container with intense glassmorphism -->
    <div class="relative h-full w-full flex flex-col overflow-hidden border border-white/10 rounded-2xl bg-neutral-950/80 shadow-2xl backdrop-blur-2xl dark:border-neutral-800/80">
      <!-- Radial background glowing anomalies -->
      <div class="pointer-events-none absolute h-44 w-44 rounded-full bg-emerald-500/10 blur-3xl -left-16 -top-16" />
      <div class="pointer-events-none absolute h-44 w-44 rounded-full bg-sky-500/10 blur-3xl -bottom-16 -right-16" />

      <!-- Draggable Header -->
      <div class="[-webkit-app-region:drag] flex items-center justify-between border-b border-white/5 px-4 py-3.5">
        <div class="flex items-center gap-2.5">
          <div class="i-solar:widget-linear animate-pulse text-lg text-emerald-400" />
          <span class="text-xs text-neutral-100 font-bold tracking-widest uppercase">Control Customizer</span>
        </div>
        <!-- Action Buttons (non-draggable) -->
        <button
          class="pointer-events-auto rounded-lg p-1.5 text-neutral-400 transition-all duration-200 active:scale-95 hover:bg-white/10 hover:text-neutral-100 dark:hover:bg-neutral-800/60"
          @click="closeWindow"
        >
          <div class="i-solar:close-square-linear text-lg" />
        </button>
      </div>

      <!-- Option B: Main Workspace Splitter -->
      <div class="flex flex-1 overflow-hidden">
        <!-- Left Sidebar Navigation Menu -->
        <div class="scrollbar-hide w-[200px] flex flex-col gap-1.5 overflow-y-auto border-r border-white/5 bg-black/20 p-3">
          <button
            v-for="group in CUSTOMIZER_CATALOG"
            :key="group.id"
            :class="[
              activeGroupId === group.id
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 font-semibold'
                : 'border-transparent text-neutral-400 hover:bg-white/5 hover:text-neutral-200',
              'w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all duration-200 cursor-pointer text-xs',
            ]"
            @click="activeGroupId = group.id"
          >
            <div :class="[group.icon, 'text-base shrink-0']" />
            <span class="truncate">{{ group.name }}</span>
          </button>
        </div>

        <!-- Right Content Details Container -->
        <div class="scrollbar-hide flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <!-- Category Banner Header -->
          <div class="border-b border-white/5 pb-2.5 space-y-1">
            <h2 class="flex items-center gap-2 text-xs text-neutral-100 font-bold tracking-wide">
              <div :class="[activeGroup.icon, 'text-emerald-400 text-sm']" />
              {{ activeGroup.name }}
            </h2>
            <p class="text-[10px] text-neutral-400/80 leading-relaxed">
              {{ activeGroup.description }}
            </p>
          </div>

          <!-- Render List of Items in the Active Category -->
          <div class="border border-white/5 rounded-xl bg-white/5 p-3 space-y-4 dark:bg-neutral-900/40">
            <div
              v-for="item in activeGroup.items"
              :key="item.id"
              class="flex items-start justify-between gap-4 border-b border-white/5 pb-3 last:border-0 last:pb-0"
            >
              <div class="space-y-0.5">
                <div class="flex items-center gap-2">
                  <div :class="[item.icon, 'text-neutral-300 text-sm shrink-0']" />
                  <span class="text-xs text-neutral-200 font-semibold">{{ item.label }}</span>

                  <!-- Dynamic State Indicator Dot -->
                  <span v-if="item.binding" class="flex items-center gap-1">
                    <span
                      :class="[
                        'h-2 w-2 rounded-full inline-block',
                        item.binding === 'geminiSession' ? geminiDotClasses : (isBoundActive(item.binding) ? 'bg-green-500' : 'bg-red-500'),
                      ]"
                    />
                    <span class="text-[9px] text-neutral-500 font-mono">
                      {{ item.binding === 'geminiSession' ? powerState : (isBoundActive(item.binding) ? 'active' : 'inactive') }}
                    </span>
                  </span>
                </div>
                <p class="text-[10px] text-neutral-400 leading-normal">
                  {{ item.description }}
                </p>
              </div>

              <!-- Action Controls -->
              <div class="flex shrink-0 items-center gap-2">
                <!-- Control Strip Inclusion Switch -->
                <div class="flex items-center gap-1.5 border border-white/5 rounded-lg bg-black/30 px-2 py-1">
                  <span class="text-[9px] text-neutral-500 font-bold tracking-wider uppercase">Strip</span>
                  <button
                    :class="[
                      isItemOnStrip(item.id) ? 'bg-emerald-500/20 border-emerald-500/40' : 'bg-neutral-800/25 border-neutral-700/20',
                      'relative inline-flex h-4.5 w-8.5 shrink-0 cursor-pointer rounded-full border transition-all duration-300 ease-out active:scale-95',
                    ]"
                    @click="toggleItemOnStrip(item.id)"
                  >
                    <span
                      :class="[
                        isItemOnStrip(item.id) ? 'translate-x-4 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'translate-x-0.5 bg-neutral-500',
                        'pointer-events-none inline-block h-3 w-3 transform rounded-full transition-all duration-300 ease-out mt-[1.5px]',
                      ]"
                    />
                  </button>
                </div>

                <!-- Bound state toggle switch -->
                <button
                  v-if="item.type === 'toggle' && item.binding"
                  :class="[
                    isBoundActive(item.binding) ? 'bg-sky-500/20 border-sky-500/40 text-sky-400' : 'bg-neutral-800/40 border-neutral-700/20 text-neutral-400',
                    'px-2 py-0.5 rounded-md border text-[9px] font-semibold active:scale-95 transition-all',
                  ]"
                  @click="toggleBoundState(item.binding)"
                >
                  {{ isBoundActive(item.binding) ? 'ACTIVE' : 'MUTED' }}
                </button>

                <!-- Trigger generic action / menu overlay -->
                <button
                  v-else-if="item.type === 'action' || item.type === 'menu' || item.type === 'cycler'"
                  class="border border-white/10 rounded-md bg-white/5 px-2.5 py-0.5 text-[9px] text-neutral-200 font-semibold transition-all active:scale-95 hover:bg-white/10"
                  @click="handleAction(item.id)"
                >
                  {{ item.type === 'menu' ? 'Open' : (item.type === 'cycler' ? 'Cycle' : 'Run') }}
                </button>
              </div>
            </div>
          </div>

          <!-- Viewport offset coordinates controls inside Viewport & Controls category -->
          <div v-if="activeGroupId === 'viewport-controls'" class="mt-1 space-y-3">
            <div class="flex items-center justify-between border-t border-white/5 pt-3">
              <span class="text-[11px] text-sky-400/95 font-bold tracking-wider uppercase">Avatar Position Sliders</span>
              <button
                class="text-[10px] text-neutral-400 transition-colors hover:text-sky-300"
                @click="resetPlacement"
              >
                Reset Coordinate Defaults
              </button>
            </div>

            <div class="border border-white/5 rounded-xl bg-white/5 p-3 space-y-4 dark:bg-neutral-900/40">
              <!-- X Slider -->
              <div class="space-y-1.5">
                <div class="flex justify-between text-[11px] text-neutral-400 font-medium">
                  <span>Horizontal (X)</span>
                  <span class="text-neutral-200 font-mono">{{ xVal.toFixed(2) }}</span>
                </div>
                <input
                  v-model.number="xVal"
                  type="range"
                  min="-3"
                  max="3"
                  step="0.05"
                  class="h-1 w-full cursor-pointer appearance-none rounded-lg bg-neutral-800 accent-sky-400 focus:outline-none"
                >
              </div>

              <!-- Y Slider -->
              <div class="space-y-1.5">
                <div class="flex justify-between text-[11px] text-neutral-400 font-medium">
                  <span>Vertical (Y)</span>
                  <span class="text-neutral-200 font-mono">{{ yVal.toFixed(2) }}</span>
                </div>
                <input
                  v-model.number="yVal"
                  type="range"
                  min="-3"
                  max="3"
                  step="0.05"
                  class="h-1 w-full cursor-pointer appearance-none rounded-lg bg-neutral-800 accent-sky-400 focus:outline-none"
                >
              </div>

              <!-- Scale Slider -->
              <div class="space-y-1.5">
                <div class="flex justify-between text-[11px] text-neutral-400 font-medium">
                  <span>Scale (Zoom)</span>
                  <span class="text-neutral-200 font-mono">{{ scaleVal.toFixed(2) }}x</span>
                </div>
                <input
                  v-model.number="scaleVal"
                  type="range"
                  min="0.1"
                  max="4"
                  step="0.05"
                  class="h-1 w-full cursor-pointer appearance-none rounded-lg bg-neutral-800 accent-sky-400 focus:outline-none"
                >
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer Info -->
      <div class="flex items-center justify-between border-t border-white/5 bg-black/25 px-4 py-3.5 text-[10px] text-neutral-500 font-medium">
        <span>Model: <span class="text-neutral-400 font-mono">{{ modelSelected }}</span></span>
        <span class="flex items-center gap-1.5">
          <span class="h-1.5 w-1.5 animate-ping rounded-full bg-emerald-400" />
          Live Synced View
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

/* Accent style range inputs */
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #38bdf8;
  cursor: pointer;
  box-shadow: 0 0 6px rgba(56, 189, 248, 0.6);
  transition: all 0.15s ease-out;
}
input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.9);
}
</style>

<route lang="yaml">
meta:
  layout: stage
</route>
