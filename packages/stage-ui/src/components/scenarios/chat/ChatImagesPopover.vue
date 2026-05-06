<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'

defineProps<{
  /** Tooltip for the main button */
  title?: string
  imagineMode?: boolean
}>()

const emit = defineEmits<{
  (e: 'attach'): void
  (e: 'screenshot'): void
  (e: 'view-journal'): void
  (e: 'toggle-imagine'): void
  (e: 'background-picker'): void
}>()
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger as-child>
      <button
        class="max-h-[10lh] min-h-[1lh] flex items-center justify-center rounded-md p-2 outline-none transition-colors transition-transform active:scale-95"
        bg="neutral-100 dark:neutral-800"
        text="lg neutral-500 dark:neutral-400"
        hover:text="primary-500 dark:primary-400"
        :title="title || 'Images & Screenshots'"
      >
        <div class="i-solar:camera-bold-duotone" />
      </button>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        side="top"
        :side-offset="8"
        align="end"
        class="animate-in fade-in zoom-in z-100 w-72 border border-neutral-200/50 rounded-2xl bg-white/90 p-3 shadow-2xl backdrop-blur-xl duration-200 dark:border-neutral-700/50 dark:bg-neutral-900/90"
      >
        <!-- Header -->
        <div class="mb-3 flex items-center justify-between border-b border-neutral-100 pb-2 dark:border-neutral-800">
          <span class="text-xs text-neutral-400 font-bold tracking-wider uppercase">Images & Screenshots</span>
          <div class="i-solar:camera-bold-duotone text-xs text-primary-500" />
        </div>

        <!-- Take Screenshot -->
        <button
          class="mb-2 w-full flex items-center gap-3 rounded-xl bg-primary-50/50 p-2.5 text-left transition-all dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-800/30"
          @click="emit('screenshot')"
        >
          <div class="i-solar:monitor-camera-bold-duotone text-lg text-primary-600 dark:text-primary-400" />
          <div class="flex flex-col">
            <span class="text-[13px] text-primary-900 font-semibold leading-none dark:text-primary-100">Take Screenshot</span>
            <span class="mt-1 text-[10px] text-primary-600/70 dark:text-primary-400/70">Capture and attach screen</span>
          </div>
        </button>

        <!-- Attach Image -->
        <button
          class="mb-2 w-full flex items-center gap-3 rounded-xl bg-neutral-50/50 p-2.5 text-left transition-all dark:bg-neutral-800/20 hover:bg-neutral-100 dark:hover:bg-neutral-800/30"
          @click="emit('attach')"
        >
          <div class="i-solar:camera-add-bold-duotone text-lg text-neutral-600 dark:text-neutral-400" />
          <div class="flex flex-col">
            <span class="text-[13px] text-neutral-900 font-semibold leading-none dark:text-neutral-100">Attach Image</span>
            <span class="mt-1 text-[10px] text-neutral-600/70 dark:text-neutral-400/70">Upload from your computer</span>
          </div>
        </button>

        <!-- Imagine Mode -->
        <button
          class="mb-2 w-full flex items-center gap-3 rounded-xl p-2.5 text-left transition-all"
          :class="imagineMode ? 'bg-primary-500/10 dark:bg-primary-900/30 ring-1 ring-primary-500/50' : 'bg-neutral-50/50 dark:bg-neutral-800/20 hover:bg-neutral-100 dark:hover:bg-neutral-800/30'"
          @click="emit('toggle-imagine')"
        >
          <div class="i-solar:magic-stick-3-bold-duotone text-lg" :class="imagineMode ? 'text-primary-500' : 'text-neutral-600 dark:text-neutral-400'" />
          <div class="flex flex-1 flex-col">
            <span class="text-[13px] font-semibold leading-none" :class="imagineMode ? 'text-primary-600 dark:text-primary-400' : 'text-neutral-900 dark:text-neutral-100'">Imagine Mode</span>
            <span class="mt-1 text-[10px]" :class="imagineMode ? 'text-primary-500/70' : 'text-neutral-600/70 dark:text-neutral-400/70'">Prompts director to imagine a new scene</span>
          </div>
          <div v-if="imagineMode" class="i-solar:check-circle-bold text-sm text-primary-500" />
        </button>

        <!-- Image Journal -->
        <button
          class="mb-1 w-full flex items-center justify-between rounded-xl p-2 text-left transition-all hover:bg-neutral-100 dark:hover:bg-neutral-800"
          @click="emit('view-journal')"
        >
          <div class="flex items-center gap-2">
            <div class="i-solar:gallery-bold-duotone text-neutral-400" />
            <div class="flex flex-col">
              <span class="text-xs text-neutral-600 font-medium dark:text-neutral-300">View Image Journal</span>
              <span class="mt-0.5 text-[10px] text-neutral-400/70">Gallery to see AI generated images history.</span>
            </div>
          </div>
          <div class="i-solar:alt-arrow-right-linear text-xs text-neutral-400" />
        </button>

        <!-- Change Background -->
        <button
          class="w-full flex items-center justify-between rounded-xl p-2 text-left transition-all hover:bg-neutral-100 dark:hover:bg-neutral-800"
          @click="emit('background-picker')"
        >
          <div class="flex items-center gap-2">
            <div class="i-solar:gallery-wide-bold-duotone text-neutral-400" />
            <div class="flex flex-col">
              <span class="text-xs text-neutral-600 font-medium dark:text-neutral-300">Change Background</span>
              <span class="mt-0.5 text-[10px] text-neutral-400/70">Pick a new background image.</span>
            </div>
          </div>
          <div class="i-solar:alt-arrow-right-linear text-xs text-neutral-400" />
        </button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
