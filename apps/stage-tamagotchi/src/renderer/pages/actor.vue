<script setup lang="ts">
import ViewControlInputs from '@proj-airi/stage-layouts/components/Layouts/ViewControls/Inputs.vue'

import { useElectronEventaContext, useElectronEventaInvoke, useElectronMouseAroundWindowBorder, useElectronMouseInElement, useElectronMouseInWindow } from '@proj-airi/electron-vueuse'
import { WhisperDock } from '@proj-airi/stage-ui/components'
import { RendererStage } from '@proj-airi/stage-ui/components/scenes'
import { useBackgroundStore } from '@proj-airi/stage-ui/stores'
import { useSpeakingStore } from '@proj-airi/stage-ui/stores/audio'
import { useSettings } from '@proj-airi/stage-ui/stores/settings'
import { useSettingsControlStrip } from '@proj-airi/stage-ui/stores/settings/control-strip'
import { useSettingsControlsIsland } from '@proj-airi/stage-ui/stores/settings/controls-island'
import { usePositioningStore } from '@proj-airi/stage-ui/stores/settings/positioning'
import { Button } from '@proj-airi/ui'
import { refDebounced, useBroadcastChannel, useWindowSize } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref, toRaw, watch } from 'vue'

import { electron, electronStartDraggingWindow } from '../../shared/eventa'
import { useWindowStore } from '../stores/window'

const backgroundStore = useBackgroundStore()
const { activeBackgroundUrl } = storeToRefs(backgroundStore)

const settingsStore = useSettings()
const { stageModelSelected, stageModelRenderer, stageViewControlsEnabled, stageViewControlsMode } = storeToRefs(settingsStore)

const controlStripStore = useSettingsControlStrip()
const { stageEnabled } = storeToRefs(controlStripStore)

const positioningStore = usePositioningStore()

const windowStore = useWindowStore()
const { live2dLookAtX, live2dLookAtY } = storeToRefs(windowStore)

const controlsIslandStore = useSettingsControlsIsland()
const { fadeOnHoverEnabled } = storeToRefs(controlsIslandStore)

const speakingStore = useSpeakingStore()
const { mouthOpenSize } = storeToRefs(speakingStore)

interface SpeakingState {
  mouthOpenSize: number
  nowSpeaking: boolean
}
const { data: speakingState } = useBroadcastChannel<SpeakingState, SpeakingState>({ name: 'airi-speaking-state' })

watch(speakingState, (val) => {
  if (val) {
    speakingStore.mouthOpenSize = val.mouthOpenSize
    speakingStore.nowSpeaking = val.nowSpeaking
  }
})

const scale = computed(() => {
  return positioningStore.getPosition(stageModelSelected.value).scale
})

const xOffset = computed(() => {
  return positioningStore.getPosition(stageModelSelected.value).x
})

const yOffset = computed(() => {
  return positioningStore.getPosition(stageModelSelected.value).y
})

function handleScaleChange(val: number) {
  const current = positioningStore.getPosition(stageModelSelected.value)
  positioningStore.setPosition(stageModelSelected.value, {
    ...current,
    scale: val,
  })
}

function handleOffsetChange(val: { x: number, y: number }) {
  const current = positioningStore.getPosition(stageModelSelected.value)
  positioningStore.setPosition(stageModelSelected.value, {
    ...current,
    x: val.x,
    y: val.y,
  })
}

// Selfie Viewfinder Overlay state
const selfieViewfinderActive = ref(false)
const selfieCountdown = ref<number | null>(null)
const { data: viewfinderSignal } = useBroadcastChannel<{ active: boolean, countdown: number | null }, { active: boolean, countdown: number | null }>({ name: 'airi:stage-selfie-viewfinder' })

watch(viewfinderSignal, (val) => {
  const raw = toRaw(val)
  if (raw) {
    selfieViewfinderActive.value = raw.active || raw.countdown !== null
    selfieCountdown.value = raw.countdown
  }
})

const { width: windowWidth, height: windowHeight } = useWindowSize()

const cropSize = computed(() => {
  return Math.min(windowWidth.value * 0.95, windowHeight.value * 0.95)
})

const cropLeft = computed(() => {
  return (windowWidth.value - cropSize.value) / 2
})

const cropTop = computed(() => {
  return Math.min(windowHeight.value * 0.15, windowHeight.value - cropSize.value)
})

// WhisperDock stub tools
const tools = ref<any[]>([])
function handleSpawnStandalone() {}

// Window Dragging Handle
const context = useElectronEventaContext()
const startDraggingWindowInvoke = useElectronEventaInvoke(electronStartDraggingWindow, context.value)
const getBounds = useElectronEventaInvoke(electron.window.getBounds, context.value)
const setBounds = useElectronEventaInvoke(electron.window.setBounds, context.value)

function startDraggingWindow() {
  startDraggingWindowInvoke()
}

let isTouchDragging = false
let startTouchScreenX = 0
let startTouchScreenY = 0
let startWindowBounds: { x: number, y: number, width: number, height: number } | null = null

async function onDragStartTouch(e: TouchEvent) {
  isTouchDragging = true
  const touch = e.touches[0]
  startTouchScreenX = touch.screenX
  startTouchScreenY = touch.screenY

  try {
    const b = await getBounds()
    if (b) {
      startWindowBounds = b
    }
  }
  catch (err) {
    console.error('Failed to get window bounds on touch drag start:', err)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('touchmove', onDraggingTouch, { passive: false })
    window.addEventListener('touchend', onDragEndTouch)
  }
}

async function onDraggingTouch(e: TouchEvent) {
  if (!isTouchDragging || !startWindowBounds)
    return

  const touch = e.touches[0]
  const deltaX = touch.screenX - startTouchScreenX
  const deltaY = touch.screenY - startTouchScreenY

  try {
    await setBounds([{
      x: Math.round(startWindowBounds.x + deltaX),
      y: Math.round(startWindowBounds.y + deltaY),
      width: startWindowBounds.width,
      height: startWindowBounds.height,
    }])
  }
  catch (err) {
    console.error('Failed to set window bounds on touch drag:', err)
  }
}

function onDragEndTouch() {
  isTouchDragging = false
  startWindowBounds = null
  if (typeof window !== 'undefined') {
    window.removeEventListener('touchmove', onDraggingTouch)
    window.removeEventListener('touchend', onDragEndTouch)
  }
}

const whisperDockIsOpen = ref(false)

// Fade overlay controls on hover states
const showControls = ref(false)

// Auto-hide (fade-on-hover) for the stage window.
// When enabled, entering the window fades the character to invisible and enables click-through.
// The ControlStrip window always stays visible — only the actor stage window fades.
const setIgnoreMouseEvents = useElectronEventaInvoke(electron.window.setIgnoreMouseEvents)
const stageIsHidden = ref(false)

const { isOutside: isOutsideWindow } = useElectronMouseInWindow()
const isInsideWindow = computed(() => !isOutsideWindow.value)

// Proximity/hover detection for control regions
const dragHandleRef = ref<HTMLDivElement | null>(null)
const whisperDockWrapperRef = ref<HTMLDivElement | null>(null)
const positioningSelectorsRef = ref<HTMLDivElement | null>(null)
const positioningSliderRef = ref<HTMLDivElement | null>(null)

const { isOutside: isOutsideDragHandle } = useElectronMouseInElement(dragHandleRef)
const { isOutside: isOutsideWhisperDock } = useElectronMouseInElement(whisperDockWrapperRef)
const { isOutside: isOutsidePositioningSelectors } = useElectronMouseInElement(positioningSelectorsRef)
const { isOutside: isOutsidePositioningSlider } = useElectronMouseInElement(positioningSliderRef)

const isOverControls = computed(() => {
  return !isOutsideDragHandle.value
    || !isOutsideWhisperDock.value
    || whisperDockIsOpen.value
    || (stageViewControlsEnabled.value && controlStripStore.stageMode === 'positionMode' && (!isOutsidePositioningSelectors.value || !isOutsidePositioningSlider.value))
})

watch(
  [isInsideWindow, fadeOnHoverEnabled, stageEnabled, isOverControls],
  ([inside, fadeEnabled, stageOn, overControls]) => {
    if (!stageOn) {
      stageIsHidden.value = false
      setIgnoreMouseEvents([false, { forward: true }])
      showControls.value = false
      return
    }

    const shouldHide = fadeEnabled && inside && !overControls
    stageIsHidden.value = shouldHide
    setIgnoreMouseEvents([shouldHide, { forward: true }])
    showControls.value = inside && !shouldHide
  },
  { immediate: true },
)

const { isNearAnyBorder: isAroundWindowBorder } = useElectronMouseAroundWindowBorder({ threshold: 30 })
const isAroundWindowBorderFor250Ms = refDebounced(isAroundWindowBorder, 250)
</script>

<template>
  <div
    :class="[
      'relative h-full w-full flex flex-col overflow-hidden rounded-xl bg-transparent',
      'transition-opacity duration-300 ease-in-out',
      stageIsHidden ? 'opacity-0' : 'opacity-100',
    ]"
  >
    <div class="relative h-full w-full overflow-hidden rounded-2xl">
      <!-- Scene Background Layer -->
      <div
        v-if="activeBackgroundUrl"
        :class="[
          'absolute inset-0 z-0',
          'transition-opacity duration-500',
        ]"
        :style="{
          backgroundImage: `url(${activeBackgroundUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }"
      />

      <!-- Standalone Graphics Model Scene Renderer -->
      <div class="absolute inset-0 z-10">
        <RendererStage
          :paused="!stageEnabled"
          :focus-at="{ x: live2dLookAtX, y: live2dLookAtY }"
          :x-offset="xOffset"
          :y-offset="yOffset"
          :scale="scale"
          :mouth-open-size="mouthOpenSize"
          @scale-change="handleScaleChange"
          @offset-change="handleOffsetChange"
        />
      </div>

      <!-- Spatial Controls Overlay -->
      <Transition name="fade">
        <div v-if="stageViewControlsEnabled && controlStripStore.stageMode === 'positionMode'" class="pointer-events-none absolute left-0 top-0 z-100 h-full w-full">
          <!-- Axis Selectors (Top Left) -->
          <div ref="positioningSelectorsRef" class="pointer-events-auto absolute left-4 top-4 flex gap-1 rounded-2xl bg-neutral-100/60 p-1 backdrop-blur-md dark:bg-neutral-900/60">
            <Button
              variant="secondary-muted"
              size="sm"
              :toggled="stageViewControlsMode === 'x'"
              class="min-w-10 font-bold font-mono"
              @click="stageViewControlsMode = 'x'"
            >
              X
            </Button>
            <Button
              variant="secondary-muted"
              size="sm"
              :toggled="stageViewControlsMode === 'y'"
              class="min-w-10 font-bold font-mono"
              @click="stageViewControlsMode = 'y'"
            >
              Y
            </Button>
            <Button
              v-if="stageModelRenderer === 'vrm'"
              variant="secondary-muted"
              size="sm"
              :toggled="stageViewControlsMode === 'z'"
              class="min-w-10 font-bold font-mono"
              @click="stageViewControlsMode = 'z'"
            >
              Z
            </Button>
            <Button
              variant="secondary-muted"
              size="sm"
              :toggled="stageViewControlsMode === 'scale'"
              class="min-w-10 font-bold font-mono"
              @click="stageViewControlsMode = 'scale'"
            >
              S
            </Button>
          </div>

          <!-- Vertical Slider (Left Edge) -->
          <div ref="positioningSliderRef" class="pointer-events-auto absolute left-4 top-1/2 -translate-y-1/2">
            <ViewControlInputs :mode="stageViewControlsMode" />
          </div>
        </div>
      </Transition>

      <!-- Floating Window Drag Control (Fades on hover) -->
      <div
        ref="dragHandleRef"
        :class="[
          'pointer-events-auto absolute right-4 top-4 z-50 transition-opacity duration-300 ease-in-out',
          showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ]"
      >
        <button
          class="w-fit flex cursor-pointer items-center self-end justify-center border-2 border-neutral-200/60 rounded-xl border-solid bg-neutral-50/80 p-2 backdrop-blur-md transition-all transition-duration-300 transition-ease-out active:scale-95 dark:border-neutral-800/10 dark:bg-neutral-800/70 hover:transition-none"
          title="Drag to Reposition Stage"
          @mousedown="startDraggingWindow"
          @touchstart="onDragStartTouch"
        >
          <div class="i-ph:arrows-out-cardinal size-5 text-neutral-800 dark:text-neutral-300" />
        </button>
      </div>

      <!-- WhisperDock horizontal input overlay -->
      <div
        ref="whisperDockWrapperRef"
        :class="[
          'absolute bottom-0 left-0 w-full h-16 z-50 transition-opacity duration-300 ease-in-out',
          (showControls || whisperDockIsOpen) ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ]"
      >
        <WhisperDock
          v-model:open="whisperDockIsOpen"
          :tools="tools"
          @spawn-standalone="handleSpawnStandalone"
        />
      </div>

      <!-- Selfie Viewfinder Overlay -->
      <div v-if="selfieViewfinderActive" class="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
        <!-- Semi-transparent overlay mask -->
        <div class="absolute inset-0 bg-neutral-950/40 backdrop-blur-[1px]" />
        <!-- Glowing Crop Box -->
        <div
          class="absolute border-2 border-sky-400 border-dashed bg-transparent shadow-[0_0_0_9999px_rgba(10,10,10,0.5)] transition-all duration-300"
          :style="{
            width: `${cropSize}px`,
            height: `${cropSize}px`,
            top: `${cropTop}px`,
            left: `${cropLeft}px`,
          }"
        >
          <!-- Corner crop marks -->
          <div class="absolute h-4 w-4 border-l-4 border-t-4 border-sky-400 -left-1 -top-1" />
          <div class="absolute h-4 w-4 border-r-4 border-t-4 border-sky-400 -right-1 -top-1" />
          <div class="absolute h-4 w-4 border-b-4 border-l-4 border-sky-400 -bottom-1 -left-1" />
          <div class="absolute h-4 w-4 border-b-4 border-r-4 border-sky-400 -bottom-1 -right-1" />

          <!-- Countdown text in the center -->
          <div v-if="selfieCountdown !== null" class="absolute inset-0 flex items-center justify-center">
            <span class="animate-pulse text-6xl text-white font-bold drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
              {{ selfieCountdown }}
            </span>
          </div>
        </div>
      </div>

      <!-- Proximity Border Highlight -->
      <Transition
        enter-active-class="transition-opacity duration-250 ease-in-out"
        enter-from-class="opacity-50"
        enter-to-class="opacity-100"
        leave-active-class="transition-opacity duration-250 ease-in-out"
        leave-from-class="opacity-100"
        leave-to-class="opacity-50"
      >
        <div v-if="isAroundWindowBorderFor250Ms" class="pointer-events-none absolute left-0 top-0 z-999 h-full w-full">
          <div
            :class="[
              'b-primary/50',
              'h-full w-full animate-flash animate-duration-3s animate-count-infinite b-4 rounded-2xl',
            ]"
          />
        </div>
      </Transition>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: stage
</route>
