<script setup lang="ts">
import { Live2DScene } from '@proj-airi/stage-ui-live2d'
import { MMDScene } from '@proj-airi/stage-ui-mmd'
import { SpineScene } from '@proj-airi/stage-ui-spine'
import { ThreeScene, useModelStore } from '@proj-airi/stage-ui-three'
import { useBroadcastChannel } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref, toRaw, watch } from 'vue'

import { useBackgroundStore } from '../../stores/background'
import { useAiriCardStore } from '../../stores/modules'
import { useSettings } from '../../stores/settings'
import { useVHackStore } from '../../stores/vhack'

const props = withDefaults(defineProps<{
  paused?: boolean
  focusAt: { x: number, y: number }
  xOffset?: number | string
  yOffset?: number | string
  scale?: number
  mouthOpenSize?: number
  currentAudioSource?: AudioBufferSourceNode
  isWindowResizing?: boolean
  vrmActiveAnimation?: string
  vrmEffectiveIdleCycleEnabled?: boolean
}>(), {
  paused: false,
  scale: 1,
  mouthOpenSize: 0,
  isWindowResizing: false,
  vrmEffectiveIdleCycleEnabled: false,
})

const emits = defineEmits<{
  (e: 'hitAreaHover', value: { name: string, x: number, y: number, hovered: boolean } | null): void
  (e: 'scaleChange', value: number): void
  (e: 'offsetChange', value: { x: number, y: number }): void
  (e: 'animationFinished'): void
  (e: 'animationPlayStatus', status: { duration: number, url: string }): void
}>()

console.log('[RendererStage.vue] Setup loaded with stage capture listener')

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })

const vrmViewerRef = ref<InstanceType<typeof ThreeScene>>()
const live2dSceneRef = ref<InstanceType<typeof Live2DScene>>()
const spineViewerRef = ref<InstanceType<typeof SpineScene>>()
const mmdViewerRef = ref<InstanceType<typeof MMDScene>>()

const settingsStore = useSettings()
const vhackStore = useVHackStore()
const { activeCard } = storeToRefs(useAiriCardStore())
const {
  stageModelRenderer,
  stageViewControlsEnabled,
  live2dDisableFocus,
  live2dFollowSpeed,
  stageModelSelectedUrl,
  stageModelSelectedFile,
  stageModelSelected,
  themeColorsHue,
  themeColorsHueDynamic,
  live2dIdleAnimationEnabled,
  live2dAutoBlinkEnabled,
  live2dForceAutoBlinkEnabled,
  live2dShadowEnabled,
  live2dMaxFps,
  mmdTextureMap,
  spinePremultipliedAlpha,
  spineDefaultMixDuration,
  spineIdleAnimationEnabled,
  spineMaxFps,
  spineRenderScale,
} = storeToRefs(settingsStore)

const vrmStore = useModelStore()

const reducedRenderScale = computed(() => {
  const nextScale = Math.min(vrmStore.renderScale, 0.75)
  return Math.max(0.5, nextScale)
})

function canvasElement() {
  if (stageModelRenderer.value === 'live2d')
    return live2dSceneRef.value?.canvasElement()
  else if (stageModelRenderer.value === 'vrm')
    return vrmViewerRef.value?.canvasElement()
  else if (stageModelRenderer.value === 'spine')
    return spineViewerRef.value?.canvasElement()
  else if (stageModelRenderer.value === 'mmd')
    return mmdViewerRef.value?.canvasElement()
}

function readRenderTargetRegionAtClientPoint(clientX: number, clientY: number, radius: number) {
  if (stageModelRenderer.value !== 'vrm')
    return null
  return vrmViewerRef.value?.readRenderTargetRegionAtClientPoint?.(clientX, clientY, radius) ?? null
}

async function captureFrame() {
  console.log('[RendererStage] captureFrame() called. stageModelRenderer:', stageModelRenderer.value)
  console.log('[RendererStage] live2dSceneRef.value:', live2dSceneRef.value)
  console.log('[RendererStage] vrmViewerRef.value:', vrmViewerRef.value)
  console.log('[RendererStage] spineViewerRef.value:', spineViewerRef.value)
  console.log('[RendererStage] mmdViewerRef.value:', mmdViewerRef.value)

  if (stageModelRenderer.value === 'live2d') {
    if (!live2dSceneRef.value) {
      console.warn('[RendererStage] Cannot capture: live2dSceneRef.value is falsy')
      return null
    }
    console.log('[RendererStage] Invoking captureFrame() on Live2D scene')
    return live2dSceneRef.value.captureFrame()
  }
  else if (stageModelRenderer.value === 'vrm') {
    if (!vrmViewerRef.value) {
      console.warn('[RendererStage] Cannot capture: vrmViewerRef.value is falsy')
      return null
    }
    console.log('[RendererStage] Invoking captureFrame() on Three (VRM) scene')
    return vrmViewerRef.value.captureFrame()
  }
  else if (stageModelRenderer.value === 'spine') {
    if (!spineViewerRef.value) {
      console.warn('[RendererStage] Cannot capture: spineViewerRef.value is falsy')
      return null
    }
    console.log('[RendererStage] Invoking captureFrame() on Spine scene')
    return spineViewerRef.value.captureFrame()
  }
  else if (stageModelRenderer.value === 'mmd') {
    if (!mmdViewerRef.value) {
      console.warn('[RendererStage] Cannot capture: mmdViewerRef.value is falsy')
      return null
    }
    console.log('[RendererStage] Invoking captureFrame() on MMD scene')
    return mmdViewerRef.value.captureFrame()
  }
  console.warn('[RendererStage] Cannot capture: unsupported renderer format:', stageModelRenderer.value)
  return null
}

async function compositeBg(modelCanvas: HTMLCanvasElement, bgUrl: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = modelCanvas.width
      canvas.height = modelCanvas.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(null)
        return
      }

      // Draw background keeping cover aspect ratio
      const canvasRatio = canvas.width / canvas.height
      const imgRatio = img.width / img.height
      let drawWidth = canvas.width
      let drawHeight = canvas.height
      let offsetX = 0
      let offsetY = 0

      if (imgRatio > canvasRatio) {
        drawWidth = canvas.height * imgRatio
        offsetX = (canvas.width - drawWidth) / 2
      }
      else {
        drawHeight = canvas.width / imgRatio
        offsetY = (canvas.height - drawHeight) / 2
      }

      ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight)

      // Draw model canvas on top
      ctx.drawImage(modelCanvas, 0, 0)

      canvas.toBlob(resolve, 'image/png')
    }
    img.onerror = () => {
      console.error('[RendererStage] Failed to load background image for composition:', bgUrl)
      resolve(null)
    }
    img.src = bgUrl
  })
}

async function cropScreenshot(screenshotBlob: Blob, cropLeft: number, cropTop: number, cropSize: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = cropSize
      canvas.height = cropSize
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(null)
        return
      }

      const dpr = img.width / window.innerWidth
      const sX = cropLeft * dpr
      const sY = cropTop * dpr
      const sWidth = cropSize * dpr
      const sHeight = cropSize * dpr

      ctx.drawImage(img, sX, sY, sWidth, sHeight, 0, 0, cropSize, cropSize)
      canvas.toBlob(resolve, 'image/png')
    }
    img.onerror = () => {
      console.error('[RendererStage] Failed to load screenshot for cropping')
      resolve(null)
    }
    img.src = URL.createObjectURL(screenshotBlob)
  })
}

const backgroundStore = useBackgroundStore()
const { data: stageCaptureSignal } = useBroadcastChannel<{ characterId: string, includeBg: boolean }, { characterId: string, includeBg: boolean }>({ name: 'airi:stage-capture' })
watch(stageCaptureSignal, async (val) => {
  const rawVal = toRaw(val)
  console.log('[RendererStage] received stage capture broadcast signal (raw):', rawVal)
  if (rawVal?.characterId) {
    try {
      const includeBg = rawVal.includeBg ?? true
      let blob: Blob | null = null

      if (includeBg) {
        if (typeof window !== 'undefined' && (window as any).electron?.ipcRenderer) {
          console.log('[RendererStage] Taking stage window screenshot via Electron IPC')
          try {
            const buffer = await (window as any).electron.ipcRenderer.invoke('stage:capture-window')
            if (buffer) {
              const rawBlob = new Blob([buffer], { type: 'image/png' })
              const windowWidth = window.innerWidth
              const windowHeight = window.innerHeight
              const cropSizeVal = Math.min(windowWidth * 0.95, windowHeight * 0.95)
              const cropLeftVal = (windowWidth - cropSizeVal) / 2
              const cropTopVal = Math.min(windowHeight * 0.15, windowHeight - cropSizeVal)

              console.log('[RendererStage] Cropping window screenshot to:', { cropLeftVal, cropTopVal, cropSizeVal })
              blob = await cropScreenshot(rawBlob, cropLeftVal, cropTopVal, cropSizeVal)
            }
          }
          catch (ipcErr) {
            console.error('[RendererStage] Failed capturing stage window via IPC:', ipcErr)
          }
        }

        // Fallback to compositing model canvas with background image if IPC is not available or failed
        if (!blob && backgroundStore.activeBackgroundUrl) {
          const canvas = canvasElement()
          if (canvas) {
            console.log('[RendererStage] Fallback: Compositing model canvas with background:', backgroundStore.activeBackgroundUrl)
            blob = await compositeBg(canvas, backgroundStore.activeBackgroundUrl)
          }
        }
      }

      if (!blob) {
        console.log('[RendererStage] Fetching standard model-only frame capture')
        blob = await captureFrame() as Blob | null
      }

      console.log('[RendererStage] captureFrame completed. Returned blob:', blob)
      if (blob) {
        const title = `Selfie - ${new Date().toLocaleString()}`
        await backgroundStore.addBackground('selfie', blob, title, undefined, rawVal.characterId)
        console.log('[RendererStage] successfully added selfie background to store.')
      }
      else {
        console.warn('[RendererStage] captureFrame returned a falsy or empty blob:', blob)
      }
    }
    catch (err) {
      console.error('[RendererStage] error during stage capture flow:', err)
    }
  }
  else {
    console.warn('[RendererStage] Broadcast signal missing characterId. val:', rawVal)
  }
})

defineExpose({
  canvasElement,
  captureFrame,
  readRenderTargetRegionAtClientPoint,
  vrmViewerRef,
  live2dSceneRef,
  spineViewerRef,
  mmdViewerRef,
})
</script>

<template>
  <div class="relative h-full w-full">
    <Live2DScene
      v-if="stageModelRenderer === 'live2d'"
      ref="live2dSceneRef"
      v-model:state="componentState"
      :class="['min-w-50% <lg:full min-h-100 sm:100', 'h-full w-full flex-1']"
      :model-src="stageModelSelectedUrl"
      :model-id="stageModelSelected"
      :model-file="stageModelSelectedFile"
      :focus-at="focusAt"
      :mouth-open-size="mouthOpenSize"
      :paused="paused"
      :x-offset="xOffset"
      :y-offset="yOffset"
      :scale="scale"
      :disable-focus-at="live2dDisableFocus"
      :follow-speed="live2dFollowSpeed"
      :theme-colors-hue="themeColorsHue"
      :theme-colors-hue-dynamic="themeColorsHueDynamic"
      :live2d-idle-animation-enabled="live2dIdleAnimationEnabled"
      :live2d-auto-blink-enabled="live2dAutoBlinkEnabled"
      :live2d-force-auto-blink-enabled="live2dForceAutoBlinkEnabled"
      :live2d-shadow-enabled="live2dShadowEnabled"
      :live2d-max-fps="live2dMaxFps"
      :idle-animations="activeCard?.extensions?.airi?.acting?.idleAnimations"
      :draggable="stageViewControlsEnabled"
      :interaction-mode="vrmStore.interactionMode === 'tactile' ? 'tactile' : 'orbit'"
      @scale-change="(val) => emits('scaleChange', val)"
      @offset-change="(val) => emits('offsetChange', val)"
      @hit-area-hover="(val) => emits('hitAreaHover', val)"
    />
    <ThreeScene
      v-if="stageModelRenderer === 'vrm' && stageModelSelectedUrl"
      v-slot
      ref="vrmViewerRef"
      v-model:state="componentState"
      :mouth-open-size="mouthOpenSize"
      :model-src="stageModelSelectedUrl"
      :model-identity="stageModelSelected"
      :idle-animation="props.vrmActiveAnimation"
      :idle-animations="activeCard?.extensions?.airi?.acting?.idleAnimations"
      :idle-cycle-enabled="props.vrmEffectiveIdleCycleEnabled"
      :render-scale-override="isWindowResizing ? reducedRenderScale : undefined"
      :class="['min-w-50% <lg:full min-h-100 sm:100', 'h-full w-full flex-1']"
      :paused="paused"
      :show-axes="false"
      :current-audio-source="currentAudioSource"
      :scale="scale !== undefined ? Number(scale) : undefined"
      :x-offset="xOffset !== undefined ? Number(xOffset) : undefined"
      :y-offset="yOffset !== undefined ? Number(yOffset) : undefined"
      :draggable="stageViewControlsEnabled"
      @error="console.error"
      @binary-loaded="vhackStore.setSourceArrayBuffer"
      @finished="emits('animationFinished')"
      @play-status="(status) => emits('animationPlayStatus', status)"
      @scale-change="(val) => emits('scaleChange', val)"
      @offset-change="(val) => emits('offsetChange', val)"
    />
    <SpineScene
      v-if="stageModelRenderer === 'spine'"
      ref="spineViewerRef"
      v-model:state="componentState"
      :model-src="stageModelSelectedUrl"
      :model-id="stageModelSelected"
      :class="['min-w-50% <lg:full min-h-100 sm:100', 'h-full w-full flex-1']"
      :paused="paused"
      :interaction-mode="vrmStore.interactionMode === 'tactile' ? 'tactile' : 'orbit'"
      :x-offset="xOffset !== undefined ? Number(xOffset) : undefined"
      :y-offset="yOffset !== undefined ? Number(yOffset) : undefined"
      :scale="scale !== undefined ? Number(scale) : undefined"
      :premultiplied-alpha="spinePremultipliedAlpha"
      :default-mix-duration="spineDefaultMixDuration"
      :idle-animation-enabled="spineIdleAnimationEnabled"
      :max-fps="spineMaxFps"
      :render-scale="spineRenderScale"
      :draggable="stageViewControlsEnabled"
      :idle-animations="activeCard?.extensions?.airi?.acting?.idleAnimations"
      :mouth-open-size="mouthOpenSize"
      @scale-change="(val) => emits('scaleChange', val)"
      @offset-change="(val) => emits('offsetChange', val)"
      @hit-area-hover="(val) => emits('hitAreaHover', val)"
    />
    <MMDScene
      v-if="stageModelRenderer === 'mmd' && stageModelSelectedUrl"
      v-slot
      ref="mmdViewerRef"
      v-model:state="componentState"
      :class="['min-w-50% <lg:full min-h-100 sm:100', 'h-full w-full flex-1']"
      :model-src="stageModelSelectedUrl"
      :paused="paused"
      :mouth-open-size="mouthOpenSize"
      :texture-map="mmdTextureMap"
      :scale="scale !== undefined ? Number(scale) : undefined"
      :position-x="xOffset !== undefined ? Number(xOffset) : undefined"
      :position-y="yOffset !== undefined ? Number(yOffset) : undefined"
      :idle-animations="activeCard?.extensions?.airi?.acting?.idleAnimations"
      :draggable="stageViewControlsEnabled"
      @error="console.error"
      @scale-change="(val) => emits('scaleChange', val)"
      @offset-change="(val) => emits('offsetChange', val)"
    />
  </div>
</template>
