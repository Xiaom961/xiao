<script setup lang="ts">
import type { AnimationState, AssetManager, Skeleton, SpineCanvas, SpineCanvasApp } from '@esotericsoftware/spine-webgl'

import type { SpineAnimationManager } from '../../../composables/spine'
import type { Emotion } from '../../../constants/emotions'
import type { SpineModelVariant } from '../../../utils/spine-zip-loader'

import { Mutex } from 'es-toolkit'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, ref, toRef, watch } from 'vue'

import { useSpineAnimationManager } from '../../../composables/spine'
import { EMOTION_SpineAnimationName_value, SpineAnimationName } from '../../../constants/emotions'
import { useSpine } from '../../../stores/spine'
import { loadSpineRuntime } from '../../../utils/spine-runtime'
import { detectSpineVersionFromBinary, detectSpineVersionFromJson } from '../../../utils/spine-version'
import { loadSpineZip } from '../../../utils/spine-zip-loader'

const props = withDefaults(defineProps<{
  modelSrc?: string
  modelId?: string
  canvas?: HTMLCanvasElement
  width: number
  height: number
  paused?: boolean
  premultipliedAlpha?: boolean
  defaultMixDuration?: number
  idleAnimationEnabled?: boolean
  maxFps?: number
}>(), {
  paused: false,
  premultipliedAlpha: false,
  defaultMixDuration: 0.2,
  idleAnimationEnabled: true,
  maxFps: 0,
})

const emits = defineEmits<{
  (e: 'modelLoaded'): void
  (e: 'error', error: Error): void
  (e: 'animationsDiscovered', value: { animations: { name: string, duration: number }[], skins: { name: string }[] }): void
}>()

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })

const spineStore = useSpine()
const {
  position,
  scale,
  currentAnimation,
  activeAnimations,
  currentSkin,
  availableAnimations,
  availableSkins,
  availableVariants,
  currentVariant,
  animationSpeed,
} = storeToRefs(spineStore)

let isUnmounted = false
const modelLoadMutex = new Mutex()
const modelLoading = ref(false)

// Live runtime objects.
let spineCanvas: SpineCanvas | undefined
let assetCleanup: (() => void) | undefined
let animationManager: SpineAnimationManager | undefined
let skeleton: Skeleton | undefined
let animationState: AnimationState | undefined
let loadedVariants: SpineModelVariant[] = []
let prevActiveAnimations: Record<string, boolean> = {}
let model0Motions: Record<string, any> = {}
let loadedBlobUrls: Record<string, string> | undefined
/** Single audio instance for model0 motions — prevents overlapping playback. */
let currentSpineAudio: HTMLAudioElement | null = null
/** Motions already fired in the current activation cycle — prevents re-trigger after one-shot finishes. */
const triggeredMotions = new Set<string>()

const canvas = toRef(() => props.canvas)
const modelSrc = toRef(() => props.modelSrc)
const paused = toRef(() => props.paused)

function disposeSpine() {
  if (spineCanvas) {
    try {
      spineCanvas.dispose()
    }
    catch (err) {
      console.warn('[Spine] Failed to dispose SpineCanvas:', err)
    }
    spineCanvas = undefined
  }
  assetCleanup?.()
  assetCleanup = undefined
  animationManager = undefined
  skeleton = undefined
  animationState = undefined
}

async function loadModel() {
  await modelLoadMutex.acquire()

  modelLoading.value = true
  componentState.value = 'loading'

  try {
    if (!canvas.value) {
      modelLoading.value = false
      componentState.value = 'mounted'
      return
    }

    if (!modelSrc.value) {
      console.warn('[Spine] No model source provided')
      disposeSpine()
      modelLoading.value = false
      componentState.value = 'mounted'
      return
    }

    disposeSpine()

    let assetPaths: { skeletonPath: string, atlasPath: string, skeletonFormat: 'binary' | 'json', texturePaths: string[] }
    let pathPrefix = ''
    let blobUrls: Record<string, string> | undefined
    let rawData: Record<string, Uint8Array | string> | undefined

    const isLocalBlob = modelSrc.value.startsWith('blob:')
    if (isLocalBlob || modelSrc.value.endsWith('.zip')) {
      const response = await fetch(modelSrc.value)
      const blob = await response.blob()
      const file = new File([blob], 'model.zip', { type: 'application/zip' })
      const loaded = await loadSpineZip(file)
      loadedVariants = loaded.variants

      // Populate variant store.
      availableVariants.value = loaded.variants.map(v => ({ name: v.name }))
      // Select stored variant or default to first.
      const selectedVariant = loaded.variants.find(v => v.name === currentVariant.value)
        ?? loaded.variants[0]
      if (selectedVariant && currentVariant.value !== selectedVariant.name)
        currentVariant.value = selectedVariant.name

      assetPaths = selectedVariant.layout
      blobUrls = loaded.blobUrls
      loadedBlobUrls = blobUrls
      rawData = loaded.rawData
      assetCleanup = loaded.dispose
    }
    else {
      // Plain URL case: assume a sibling .skel/.json + .atlas next to the source.
      const baseUrl = new URL(modelSrc.value, window.location.href)
      pathPrefix = baseUrl.href.replace(/\/[^/]+$/, '/')
      const baseName = baseUrl.pathname.replace(/^.*\//, '').replace(/\.(?:json|skel|atlas)(?:\.txt)?$/i, '')
      const skeletonFormat: 'binary' | 'json' = baseUrl.pathname.toLowerCase().endsWith('.json') ? 'json' : 'binary'
      assetPaths = {
        skeletonPath: `${baseName}.${skeletonFormat === 'binary' ? 'skel' : 'json'}`,
        atlasPath: `${baseName}.atlas`,
        skeletonFormat,
        texturePaths: [],
      }
    }

    // Detect version from skeleton data to load the matching runtime.
    let detectedVersion = rawData
      ? (assetPaths.skeletonFormat === 'binary'
          ? detectSpineVersionFromBinary(rawData[assetPaths.skeletonPath] as Uint8Array)
          : detectSpineVersionFromJson(rawData[assetPaths.skeletonPath] as string))
      : undefined
    if (!detectedVersion)
      detectedVersion = '4.2'
    const spine = await loadSpineRuntime(detectedVersion)
    console.log(`[Spine] Detected skeleton version: ${detectedVersion}`)

    if (isUnmounted) {
      assetCleanup?.()
      modelLoading.value = false
      componentState.value = 'mounted'
      return
    }

    await new Promise<void>((resolve, reject) => {
      const app: SpineCanvasApp = {
        loadAssets: (sc) => {
          const am = sc.assetManager
          // NOTICE:
          // Patch BEFORE any load calls. SpineCanvas calls loadAssets
          // synchronously in its constructor, and am.loadBinary/loadJson/
          // loadTextureAtlas immediately dispatch XHRs. The downloader
          // checks rawDataUris at dispatch time — if we patch after the
          // constructor returns, requests already hit the dev server.
          if (blobUrls)
            patchAssetManagerForZipAssets(am, blobUrls, rawData!, assetPaths.texturePaths)

          if (assetPaths.skeletonFormat === 'binary')
            am.loadBinary(assetPaths.skeletonPath)
          else
            am.loadJson(assetPaths.skeletonPath)

          am.loadTextureAtlas(assetPaths.atlasPath)
        },
        initialize: (sc) => {
          try {
            const am = sc.assetManager
            const atlas = am.require(assetPaths.atlasPath) as import('@esotericsoftware/spine-webgl').TextureAtlas
            const attachmentLoader = new spine.AtlasAttachmentLoader(atlas)
            const skeletonData = assetPaths.skeletonFormat === 'binary'
              ? new spine.SkeletonBinary(attachmentLoader).readSkeletonData(am.require(assetPaths.skeletonPath) as Uint8Array)
              : new spine.SkeletonJson(attachmentLoader).readSkeletonData(am.require(assetPaths.skeletonPath) as string)

            skeleton = new spine.Skeleton(skeletonData)
            skeleton.setToSetupPose()
            applyTransformFromStore()

            const stateData = new spine.AnimationStateData(skeletonData)
            stateData.defaultMix = props.defaultMixDuration
            animationState = new spine.AnimationState(stateData)

            animationManager = useSpineAnimationManager(animationState, skeleton, {
              mixDuration: props.defaultMixDuration,
              idleAnimationEnabled: props.idleAnimationEnabled,
            })

            // Inventory animations and skins, populate the store.
            const animations = skeletonData.animations.map(animation => ({ name: animation.name, duration: animation.duration }))

            // Check for model0.json
            const model0Str = rawData?.['model0.json']
            if (model0Str) {
              try {
                const model0 = JSON.parse(model0Str as string)
                if (model0.motions) {
                  model0Motions = model0.motions
                  for (const key in model0.motions) {
                    if (key !== 'idle' && !animations.find(a => a.name === key)) {
                      animations.push({ name: key, duration: 0 }) // virtual motion
                    }
                  }
                }
              }
              catch (e) {
                console.error('[Spine] Failed to parse model0.json:', e)
              }
            }

            const skins = skeletonData.skins.map(s => ({ name: s.name }))
            availableAnimations.value = animations
            availableSkins.value = skins
            emits('animationsDiscovered', { animations, skins })

            // Apply the user's saved skin (if any).
            applySkin(currentSkin.value)

            // Apply the user's saved idle animation.
            applyCurrentAnimation()

            // Apply active independent animations.
            applyActiveAnimations(activeAnimations.value[props.modelId] || {})

            emits('modelLoaded')
            resolve()
          }
          catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            emits('error', error)
            reject(error)
          }
        },
        update: (_sc, delta) => {
          if (!skeleton || !animationState)
            return
          if (paused.value) {
            return
          }
          animationState.update(delta * animationSpeed.value)
          animationState.apply(skeleton)
          // Physics was added in Spine 4.2; older runtimes take no argument.
          if (spine.Physics && (spine.Physics as any).update)
            skeleton.updateWorldTransform((spine.Physics as any).update)
          else
            (skeleton as any).updateWorldTransform()
        },
        render: (sc) => {
          if (!skeleton)
            return
          const renderer = sc.renderer
          renderer.resize(spine.ResizeMode.Expand)
          sc.gl.clearColor(0, 0, 0, 0)
          sc.gl.clear(sc.gl.COLOR_BUFFER_BIT)
          renderer.begin()
          renderer.drawSkeleton(skeleton, props.premultipliedAlpha)
          renderer.end()
        },
        error: (_sc, errors: Record<string, string>) => {
          const message = Object.values(errors).join('; ')
          const error = new Error(message)
          emits('error', error)
          reject(error)
        },
      }

      spineCanvas = new spine.SpineCanvas(canvas.value!, {
        app,
        pathPrefix,
        webglConfig: { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true },
      })
    })
  }
  catch (err) {
    console.error('[Spine] Failed to load model:', err)
    emits('error', err instanceof Error ? err : new Error(String(err)))
  }
  finally {
    modelLoading.value = false
    componentState.value = 'mounted'
    modelLoadMutex.release()
  }
}

/**
 * Patches the AssetManager's Downloader to serve ZIP-extracted assets from
 * memory. Skeleton/atlas data is served directly from `rawData`; texture
 * pages use blob URLs registered in `rawDataUris` for `image.src`.
 *
 * NOTICE:
 * Spine's Downloader.rawDataUris has a broken heuristic: values without "."
 * are decoded as data: URIs via atob(). In Electron, blob URLs are
 * `blob:null/<uuid>` (no dots) → treated as inline data → 400 error.
 * Even with data: URIs, the atob round-trip corrupts multi-byte binary.
 * We bypass rawDataUris entirely for text/binary and monkey-patch the
 * download methods to resolve from the in-memory `rawData` map.
 * Source: spine-core/AssetManagerBase.js Downloader class.
 * Removal condition: Spine ships a Blob/ArrayBuffer-aware asset loader.
 */
function patchAssetManagerForZipAssets(
  assetManager: AssetManager,
  blobUrls: Record<string, string>,
  rawData: Record<string, Uint8Array | string>,
  texturePaths: string[],
) {
  const downloader = (assetManager as unknown as {
    downloader?: {
      rawDataUris: Record<string, string>
      downloadText: (url: string, success: (data: string) => void, error: (status: number, responseText: string) => void) => void
      downloadBinary: (url: string, success: (data: Uint8Array) => void, error: (status: number, response: unknown) => void) => void
    }
  }).downloader
  if (!downloader)
    return

  // Build a lookup keyed by both full path and bare filename.
  const textLookup = new Map<string, string>()
  const binaryLookup = new Map<string, Uint8Array>()
  for (const [path, data] of Object.entries(rawData)) {
    const bare = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path
    if (typeof data === 'string') {
      textLookup.set(path, data)
      textLookup.set(bare, data)
    }
    else {
      binaryLookup.set(path, data)
      binaryLookup.set(bare, data)
    }
  }

  const origDownloadText = downloader.downloadText.bind(downloader)
  const origDownloadBinary = downloader.downloadBinary.bind(downloader)

  downloader.downloadText = (url, success, error) => {
    const data = textLookup.get(url)
    if (data !== undefined) {
      queueMicrotask(() => success(data))
      return
    }
    origDownloadText(url, success, error)
  }

  downloader.downloadBinary = (url, success, error) => {
    const data = binaryLookup.get(url)
    if (data !== undefined) {
      queueMicrotask(() => success(data))
      return
    }
    origDownloadBinary(url, success, error)
  }

  // Texture blob URLs → rawDataUris for image.src resolution in loadTexture.
  for (const path of texturePaths) {
    const url = blobUrls[path]
    if (!url)
      continue
    downloader.rawDataUris[path] = url
    const slash = path.lastIndexOf('/')
    if (slash !== -1)
      downloader.rawDataUris[path.slice(slash + 1)] = url
  }
}

function applyTransformFromStore() {
  if (!skeleton || !canvas.value)
    return

  // Centre the skeleton roughly at the bottom-middle of the canvas, then
  // apply user offsets/scale on top. This mirrors the Live2D anchor.
  const w = canvas.value.width
  const h = canvas.value.height
  skeleton.x = w / 2 + position.value.x
  skeleton.y = h * 0.05 + position.value.y
  skeleton.scaleX = scale.value
  skeleton.scaleY = scale.value
}

function applyCurrentAnimation() {
  if (!animationManager)
    return
  const desired = currentAnimation.value?.name ?? SpineAnimationName.Idle
  animationManager.setIdle(desired)
}

function applyActiveAnimations(activeAnims: Record<string, boolean>) {
  if (!animationState || !availableAnimations.value)
    return

  availableAnimations.value.forEach((anim, index) => {
    const trackIndex = 10 + index
    const isActive = activeAnims[anim.name] || false

    // Skip the animation that is currently set as the base idle animation
    if (anim.name === currentAnimation.value?.name) {
      const currentTrack = animationState.getCurrent(trackIndex)
      if (currentTrack && currentTrack.animation.name === anim.name) {
        animationState.setEmptyAnimation(trackIndex, props.defaultMixDuration)
      }
      return
    }

    const currentTrack = animationState.getCurrent(trackIndex)
    const motionConfig = model0Motions[anim.name]

    if (isActive) {
      // model0 mapped motion — one-shot with random audio
      if (motionConfig && motionConfig.length > 0) {
        // Already fired this activation cycle — do nothing until toggled off and on
        if (triggeredMotions.has(anim.name))
          return

        triggeredMotions.add(anim.name)

        const randomIndex = Math.floor(Math.random() * motionConfig.length)
        const config = motionConfig[randomIndex]

        animationState.setAnimation(trackIndex, config.file, false)

        if (config.sound && loadedBlobUrls && loadedBlobUrls[config.sound]) {
          // Leadership Election: Only the "Stage" window handles audio playback
          const hash = window.location.hash || '#/'
          const isStage = hash === '#/' || hash.startsWith('#/stage')

          if (isStage) {
            // Stop any previously playing audio first
            if (currentSpineAudio) {
              currentSpineAudio.pause()
              currentSpineAudio.currentTime = 0
            }
            currentSpineAudio = new Audio(loadedBlobUrls[config.sound])
            currentSpineAudio.play().catch(e => console.error('[Spine] Failed to play audio:', e))
          }
        }
        else {
          console.warn(`[Spine] Audio file not found or blob URL missing for: ${config.sound}`)
        }
      }
      // Regular skeleton animation — loop as usual
      else {
        const isPlaying = currentTrack && currentTrack.animation.name === anim.name
        if (!isPlaying)
          animationState.setAnimation(trackIndex, anim.name, true)
      }
    }
    else {
      // Motion was deactivated — clear trigger state so it can fire again next time
      triggeredMotions.delete(anim.name)

      const expectedName = (motionConfig && motionConfig[0]) ? motionConfig[0].file : anim.name
      const isPlaying = currentTrack && currentTrack.animation.name === expectedName
      if (isPlaying) {
        animationState.setEmptyAnimation(trackIndex, props.defaultMixDuration)
        skeleton.setToSetupPose()
      }
    }
  })
}

function applySkin(skinName: string) {
  if (!skeleton)
    return

  if (!skinName) {
    skeleton.setSkinByName(skeleton.data.defaultSkin?.name ?? skeleton.data.skins[0]?.name ?? 'default')
    skeleton.setSlotsToSetupPose()
    return
  }

  const skin = skeleton.data.findSkin(skinName)
  if (skin) {
    skeleton.setSkin(skin)
    skeleton.setSlotsToSetupPose()
  }
}

/**
 * Plays an emotion-tagged animation on the dedicated emotion track.
 *
 * Use when:
 * - The chat orchestrator emits an `EmotionPayload`. The Stage component
 *   forwards the emotion name here so the model can react in real time
 *   without disturbing the persistent idle loop on track 0.
 *
 * Expects:
 * - The skeleton has loaded (`componentState === 'mounted'`). The call is
 *   a no-op if invoked before then.
 *
 * Returns:
 * - The resolved animation name when one was found, otherwise `undefined`.
 */
function setEmotion(emotion: Emotion, _intensity: number = 1): string | undefined {
  if (!animationManager)
    return undefined
  const animationName = EMOTION_SpineAnimationName_value[emotion] || emotion
  const entry = animationManager.playEmotion(animationName)
  return entry?.animation?.name
}

watch(modelSrc, async () => await loadModel(), { immediate: true })
watch(canvas, async (next, prev) => {
  if (next && next !== prev)
    await loadModel()
})

watch([() => props.width, () => props.height, position, scale], () => {
  applyTransformFromStore()
}, { deep: true })

watch(currentAnimation, () => {
  applyCurrentAnimation()
}, { deep: true })

watch(activeAnimations, (newVal) => {
  const current = newVal[props.modelId] || {}

  for (const name in prevActiveAnimations) {
    if (prevActiveAnimations[name] && !current[name]) {
      console.log(`[Spine] Animation removed: ${name}`)
      if (skeleton) {
        skeleton.setToSetupPose()
      }
    }
  }

  prevActiveAnimations = { ...current }
  applyActiveAnimations(current)
}, { deep: true })

watch(currentSkin, (skinName) => {
  applySkin(skinName)
})

watch(currentVariant, async () => {
  if (loadedVariants.length > 1)
    await loadModel()
})

watch(() => props.idleAnimationEnabled, () => {
  if (!animationManager || !skeleton || !animationState)
    return
  if (props.idleAnimationEnabled)
    applyCurrentAnimation()
  else
    animationState.setEmptyAnimation(0, props.defaultMixDuration)
})

watch(() => props.defaultMixDuration, (mix) => {
  if (animationState)
    animationState.data.defaultMix = mix
})

watch(paused, () => {
  // SpineCanvas does not expose a built-in pause; we toggle by stopping
  // the update step from advancing time (handled in the update callback).
  // We still let render run so the last frame remains visible.
})

onMounted(async () => {
  // First load is triggered by the immediate watch above when the canvas
  // becomes available.
})

onUnmounted(() => {
  isUnmounted = true
  disposeSpine()
})

defineExpose({
  setEmotion,
  listAnimations: () => animationManager?.listAnimations() ?? [],
  listSkins: () => availableSkins.value.map(s => s.name),
})

import.meta.hot?.dispose(() => {
  console.warn('[Dev] Reload on HMR dispose is active for this component. Performing a full reload.')
  window.location.reload()
})
</script>

<template>
  <slot />
</template>
