<script setup lang="ts">
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'

import { useLiveSessionStore } from '../../../stores/modules/live-session'
import { useSettingsAudioDevice } from '../../../stores/settings/audio-device'
import { useSettingsControlStrip } from '../../../stores/settings/control-strip'
import { useSettingsControlsIsland } from '../../../stores/settings/controls-island'

const controlStripStore = useSettingsControlStrip()
const { orientation, buttons, stageEnabled, chatOpen, captionOpen, backgroundTint, stageMode } = storeToRefs(controlStripStore)

const settingsAudioDeviceStore = useSettingsAudioDevice()
const { enabled: micEnabled } = storeToRefs(settingsAudioDeviceStore)

const liveSessionStore = useLiveSessionStore()
const { powerState } = storeToRefs(liveSessionStore)

const controlsIslandStore = useSettingsControlsIsland()
const { fadeOnHoverEnabled, alwaysOnTop } = storeToRefs(controlsIslandStore)

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

// Persistent dragging position, defaults to top-right layout bounds
const position = useLocalStorageManualReset<{ x: number, y: number }>('settings/control-strip/position', { x: 20, y: 150 })

// Dragging states
const isDragging = ref(false)
let startX = 0
let startY = 0
let startPosX = 0
let startPosY = 0
let dragDistance = 0

function onDragStart(e: MouseEvent | TouchEvent) {
  isDragging.value = true
  dragDistance = 0

  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

  startX = clientX
  startY = clientY
  startPosX = position.value.x
  startPosY = position.value.y

  if (typeof window !== 'undefined') {
    window.addEventListener('mousemove', onDragging)
    window.addEventListener('mouseup', onDragEnd)
    window.addEventListener('touchmove', onDragging, { passive: false })
    window.addEventListener('touchend', onDragEnd)
  }
}

function onDragging(e: MouseEvent | TouchEvent) {
  if (!isDragging.value)
    return

  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

  const diffX = clientX - startX
  const diffY = clientY - startY
  dragDistance = Math.sqrt(diffX * diffX + diffY * diffY)

  // Since anchored to absolute 'right', moving cursor to the left increases x coordinate offset
  const deltaX = startX - clientX
  const deltaY = clientY - startY

  position.value.x = Math.max(10, Math.min(window.innerWidth - 80, startPosX + deltaX))
  position.value.y = Math.max(10, Math.min(window.innerHeight - 300, startPosY + deltaY))
}

function onDragEnd() {
  isDragging.value = false
  if (typeof window !== 'undefined') {
    window.removeEventListener('mousemove', onDragging)
    window.removeEventListener('mouseup', onDragEnd)
    window.removeEventListener('touchmove', onDragging)
    window.removeEventListener('touchend', onDragEnd)
  }

  // Tap/click trigger if pointer didn't move significantly
  if (dragDistance < 5) {
    toggleOrientation()
  }
}

// Filter for active buttons
const activeButtons = computed(() => {
  return buttons.value.filter(btn => btn.enabled)
})

function handleAction(actionId: string) {
  console.info(`[Control Strip] Button clicked: "${actionId}". Dispatching control-strip:action event...`)
  if (actionId === 'layout') {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('control-strip:open-customizer'))
    }
    return
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('control-strip:action', { detail: { action: actionId } }))
  }
}

function handleRightClick(e: MouseEvent) {
  e.preventDefault()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('control-strip:open-customizer'))
  }
}

function toggleOrientation() {
  controlStripStore.toggleOrientation()
}

function getButtonTitle(btnId: string, defaultLabel: string): string {
  if (btnId === 'chat') {
    return `Chat Toggle: ${chatOpen.value ? 'Open (Green)' : 'Closed (Red)'}`
  }
  if (btnId === 'stage') {
    return `Actor Stage: ${stageEnabled.value ? 'Visible (Green)' : 'Hidden (Red)'}`
  }
  if (btnId === 'mic') {
    return `Microphone: ${micEnabled.value ? 'Active (Green)' : 'Muted (Red)'}`
  }
  if (btnId === 'caption') {
    return `Captions: ${captionOpen.value ? 'Active (Green)' : 'Disabled (Red)'}`
  }
  if (btnId === 'gemini-session') {
    const stateLabels: Record<string, string> = {
      off: 'Disconnected (Gray)',
      connecting: 'Connecting (Sky Blue)',
      active: 'Listening / Idle (Red)',
      busy: 'Transmitting / Speaking (Purple)',
      ambient: 'Witness Mode Active (Amber)',
    }
    return `Speech Session: ${stateLabels[powerState.value] || 'Disconnected (Gray)'}`
  }
  return defaultLabel
}
</script>

<template>
  <div
    :class="[
      'absolute pointer-events-auto select-none',
      'bg-neutral-100/30 dark:bg-neutral-900/40',
      'backdrop-blur-xl border border-white/20 dark:border-neutral-800/60',
      'shadow-2xl shadow-black/10 rounded-full',
      'transition-all duration-300 ease-out',
      isDragging ? 'scale-102 border-primary-500/30 shadow-primary-500/5' : '',
      orientation === 'vertical' ? 'flex flex-col items-center py-3 px-2 gap-2.5 w-14' : 'flex flex-row items-center px-3 py-2 gap-2.5 h-14',
    ]"
    :style="{
      top: `${position.y}px`,
      right: `${position.x}px`,
      backgroundColor: backgroundTint,
      opacity: 0.85,
    }"
    @contextmenu="handleRightClick"
  >
    <!-- TOP/LEFT ENDCAP: Perpendicular Drag & Layout Handle -->
    <button
      :class="[
        'flex items-center justify-center',
        'w-9 h-9 rounded-full',
        'bg-white/10 hover:bg-white/25 dark:bg-white/5 dark:hover:bg-white/15',
        'border border-white/10 dark:border-white/5',
        'text-neutral-700 dark:text-neutral-300',
        'transition-all duration-200 active:scale-90',
        isDragging ? 'cursor-grabbing' : 'cursor-grab',
      ]"
      title="Drag to Reposition | Click to Toggle Layout"
      @mousedown="onDragStart"
      @touchstart="onDragStart"
      @click.stop
    >
      <span
        :class="[
          'text-lg transition-transform duration-300',
          orientation === 'vertical' ? 'i-solar:double-alt-arrow-right-linear' : 'i-solar:double-alt-arrow-down-linear',
        ]"
      />
    </button>

    <!-- CORE INTERACTIVE BUTTONS -->
    <div
      :class="[
        orientation === 'vertical' ? 'flex flex-col items-center gap-2.5' : 'flex flex-row items-center gap-2.5',
      ]"
    >
      <button
        v-for="btn in activeButtons"
        :key="btn.id"
        :class="[
          'relative flex items-center justify-center',
          'w-9 h-9 rounded-full border border-white/15 dark:border-white/5',
          'bg-white/15 hover:bg-white/25 dark:bg-white/5 dark:hover:bg-white/15 text-neutral-800 dark:text-neutral-200',
          'transition-all duration-200 hover:scale-105 active:scale-90 cursor-pointer',
        ]"
        :title="getButtonTitle(btn.id, btn.label)"
        @click="handleAction(btn.id)"
      >
        <span :class="[btn.icon, 'text-lg']" />

        <!-- Status dot badge for Stage (Actor Stage) -->
        <span
          v-if="btn.id === 'stage'"
          :class="[
            'absolute right-1 top-1 h-1.5 w-1.5 rounded-full transition-colors duration-200',
            stageEnabled ? 'bg-green-500' : 'bg-red-500',
          ]"
        />

        <!-- Status dot badge for Chat (Chat Toggle) -->
        <span
          v-if="btn.id === 'chat'"
          :class="[
            'absolute right-1 top-1 h-1.5 w-1.5 rounded-full transition-colors duration-200',
            chatOpen ? 'bg-green-500' : 'bg-red-500',
          ]"
        />

        <!-- Status dot badge for Microphone (Microphone Toggle) -->
        <span
          v-if="btn.id === 'mic'"
          :class="[
            'absolute right-1 top-1 h-1.5 w-1.5 rounded-full transition-colors duration-200',
            micEnabled ? 'bg-green-500' : 'bg-red-500',
          ]"
        />

        <!-- Status dot badge for Captions (CC Toggle) -->
        <span
          v-if="btn.id === 'caption'"
          :class="[
            'absolute right-1 top-1 h-1.5 w-1.5 rounded-full transition-colors duration-200',
            captionOpen ? 'bg-green-500' : 'bg-red-500',
          ]"
        />

        <!-- Status dot badge for Gemini Session (Sparkle Toggle) -->
        <span
          v-if="btn.id === 'gemini-session'"
          :class="[
            'absolute right-1 top-1 h-1.5 w-1.5 rounded-full transition-all duration-300',
            geminiDotClasses,
          ]"
        />

        <!-- Status dot badge for Auto-Hide toggle -->
        <span
          v-if="btn.id === 'viewport-auto-hide'"
          :class="[
            'absolute right-1 top-1 h-1.5 w-1.5 rounded-full transition-colors duration-200',
            fadeOnHoverEnabled ? 'bg-green-500' : 'bg-red-500',
          ]"
        />

        <!-- Status dot badge for Always-on-Top toggle -->
        <span
          v-if="btn.id === 'always-on-top'"
          :class="[
            'absolute right-1 top-1 h-1.5 w-1.5 rounded-full transition-colors duration-200',
            alwaysOnTop ? 'bg-green-500' : 'bg-red-500',
          ]"
        />

        <!-- Status dot badge for Tactile Mode -->
        <span
          v-if="btn.id === 'viewport-tactile'"
          :class="[
            'absolute right-1 top-1 h-1.5 w-1.5 rounded-full transition-colors duration-200',
            stageMode === 'tactileMode' ? 'bg-green-500' : 'bg-red-500',
          ]"
        />

        <!-- Status dot badge for Drag Mode -->
        <span
          v-if="btn.id === 'viewport-drag'"
          :class="[
            'absolute right-1 top-1 h-1.5 w-1.5 rounded-full transition-colors duration-200',
            stageMode === 'dragMode' ? 'bg-green-500' : 'bg-red-500',
          ]"
        />

        <!-- Status dot badge for Positioning Mode -->
        <span
          v-if="btn.id === 'viewport-positioning'"
          :class="[
            'absolute right-1 top-1 h-1.5 w-1.5 rounded-full transition-colors duration-200',
            stageMode === 'positionMode' ? 'bg-green-500' : 'bg-red-500',
          ]"
        />

        <!-- Status dot badge for Orbit Mode -->
        <span
          v-if="btn.id === 'viewport-orbit'"
          :class="[
            'absolute right-1 top-1 h-1.5 w-1.5 rounded-full transition-colors duration-200',
            stageMode === 'orbitMode' ? 'bg-green-500' : 'bg-red-500',
          ]"
        />
      </button>
    </div>
  </div>
</template>
