<script setup lang="ts">
import { useSpine } from '@proj-airi/stage-ui-spine'
import { Button, FieldRange, Select, SelectTab } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSettingsSpine } from '../../../../stores/settings/spine'
import { Section } from '../../../layouts'
import { ColorPalette } from '../../../widgets'

const props = withDefaults(defineProps<{
  palette: string[]
  allowExtractColors?: boolean
}>(), {
  allowExtractColors: true,
})

defineEmits<{
  (e: 'extractColorsFromModel'): void
}>()

const { t } = useI18n()

const settingsSpine = useSettingsSpine()
const {
  spineDefaultMixDuration,
  spineMaxFps,
  spineRenderScale,
} = storeToRefs(settingsSpine)

const spineStore = useSpine()
const {
  scale,
  position,
  currentAnimation,
  availableAnimations,
  currentSkin,
  availableSkins,
  availableVariants,
  currentVariant,
  animationSpeed,
} = storeToRefs(spineStore)

// canExtractColors removed as it is unused in Phase 1
const hasMultipleVariants = computed(() => availableVariants.value.length > 1)

const variantOptions = computed(() => availableVariants.value.map(v => ({
  label: v.name,
  value: v.name,
  description: '',
})))

const animationOptions = computed(() => availableAnimations.value.map(animation => ({
  label: animation.name,
  value: animation.name,
  description: `${animation.duration.toFixed(2)}s`,
})))

const skinOptions = computed(() => availableSkins.value.map(skin => ({
  label: skin.name,
  value: skin.name,
  description: '',
})))

const fpsOptions = computed(() => [
  { value: 0, label: t('settings.spine.fps.options.unlimited') },
  { value: 60, label: '60' },
  { value: 30, label: '30' },
])

function handleVariantSelect(variantName: string | number | undefined) {
  if (typeof variantName !== 'string')
    return
  currentVariant.value = variantName
}

function handleAnimationSelect(animationName: string | number | undefined) {
  if (typeof animationName !== 'string')
    return
  currentAnimation.value = { ...currentAnimation.value, name: animationName }
}

function handleSkinSelect(skinName: string | number | undefined) {
  if (typeof skinName !== 'string')
    return
  currentSkin.value = skinName
}
</script>

<template>
  <!-- Block 1: Character Customizations -->
  <Section
    title="Character Customizations"
    icon="i-solar:user-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80  dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="true"
  >
    <!-- Animation -->
    <Select
      :model-value="currentAnimation.name"
      :options="animationOptions"
      class="w-full"
      @update:model-value="handleAnimationSelect"
    />
    <FieldRange v-model="spineDefaultMixDuration" as="div" :min="0" :max="2" :step="0.05" :label="t('settings.spine.animation.mix-duration')">
      <template #label>
        <div flex items-center>
          <div>{{ t('settings.spine.animation.mix-duration') }}</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => spineDefaultMixDuration = 0.2">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="animationSpeed" as="div" :min="0.1" :max="3" :step="0.05" :label="t('settings.spine.animation.speed')">
      <template #label>
        <div flex items-center>
          <div>{{ t('settings.spine.animation.speed') }}</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => animationSpeed = 1">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>

    <!-- Variant -->
    <div v-if="hasMultipleVariants" class="mt-4">
      <Select
        :model-value="currentVariant"
        :options="variantOptions"
        class="w-full"
        @update:model-value="handleVariantSelect"
      />
    </div>

    <!-- Skin -->
    <div class="mt-4">
      <Select
        :model-value="currentSkin"
        :options="skinOptions"
        class="w-full"
        @update:model-value="handleSkinSelect"
      />
    </div>
  </Section>

  <!-- Block 2: Scene -->
  <Section
    title="Scene"
    icon="i-solar:clapperboard-edit-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80  dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="true"
  >
    <FieldRange v-model="scale" as="div" :min="0.1" :max="3" :step="0.01" :label="t('settings.spine.scale-and-position.scale')">
      <template #label>
        <div flex items-center>
          <div>{{ t('settings.spine.scale-and-position.scale') }}</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => scale = 1">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="position.x" as="div" :min="-3000" :max="3000" :step="1" :label="t('settings.spine.scale-and-position.x')">
      <template #label>
        <div flex items-center>
          <div>{{ t('settings.spine.scale-and-position.x') }}</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => position.x = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="position.y" as="div" :min="-3000" :max="3000" :step="1" :label="t('settings.spine.scale-and-position.y')">
      <template #label>
        <div flex items-center>
          <div>{{ t('settings.spine.scale-and-position.y') }}</div>
          <button px-2 text-xs outline-none title="Reset value to default" @click="() => position.y = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
  </Section>

  <!-- Block 3: Advanced -->
  <Section
    title="Advanced"
    icon="i-solar:settings-bold-duotone"
    :class="[
      'rounded-xl',
      'bg-white/80  dark:bg-black/75',
      'backdrop-blur-lg',
    ]"
    size="sm"
    :expand="false"
  >
    <!-- Theme Extraction -->
    <div flex="~ col gap-2" class="mb-4">
      <div class="px-1 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">
        Theme Extraction
      </div>
      <ColorPalette class="mb-2 mt-2" :colors="palette.map(hex => ({ hex, name: hex }))" mx-auto />
      <Button variant="secondary" :disabled="true" @click="$emit('extractColorsFromModel')">
        {{ t('settings.spine.theme-color-from-model.button-extract.title') }}
      </Button>
      <p class="px-1 text-[10px] text-neutral-400">
        (Disabled for Phase 1)
      </p>
    </div>

    <!-- Rendering -->
    <div flex="~ col gap-2">
      <div class="px-1 text-[10px] text-neutral-400 font-bold tracking-wider uppercase">
        Rendering
      </div>
      <div :class="['flex', 'items-center', 'justify-between', 'gap-2']">
        <div :class="['text-sm', 'font-medium']">
          {{ t('settings.spine.rendering.max-fps') }}
        </div>
        <SelectTab v-model="spineMaxFps" :options="fpsOptions" size="sm" :class="['shrink-0']" :disabled="true" />
      </div>
      <div class="mt-2">
        <FieldRange v-model="spineRenderScale" as="div" :min="0.5" :max="3" :step="0.1" :label="t('settings.spine.rendering.render-scale')">
          <template #label>
            <div flex items-center>
              <div>{{ t('settings.spine.rendering.render-scale') }}</div>
              <button px-2 text-xs outline-none title="Reset value to default" :disabled="true" @click="() => spineRenderScale = 1">
                <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
              </button>
            </div>
          </template>
        </FieldRange>
      </div>
      <p class="px-1 text-[10px] text-neutral-400">
        (Rendering controls disabled for Phase 1)
      </p>
    </div>
  </Section>
</template>
