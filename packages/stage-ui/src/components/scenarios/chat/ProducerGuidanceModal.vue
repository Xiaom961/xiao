<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { ref, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  characterName: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'submit', payload: { guidance: string, contextDepth: number, count: number, shortReplies: boolean }): void
}>()

const guidance = ref('')
const contextDepth = useLocalStorage('airi:producer:context-depth', 6)
const autoSend = useLocalStorage('airi:producer:auto-send', true)
const suggestionCount = useLocalStorage('airi:producer:suggestion-count', 4)
const shortReplies = useLocalStorage('airi:producer:short-replies', true)

watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    guidance.value = ''
  }
})

function close() {
  emit('update:modelValue', false)
}

function handleGenerate() {
  emit('submit', {
    guidance: guidance.value.trim(),
    contextDepth: contextDepth.value,
    count: suggestionCount.value,
    shortReplies: shortReplies.value,
  })
  close()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        @click.self="close"
      >
        <div
          :class="[
            'relative max-w-md w-full overflow-hidden rounded-2xl border',
            'bg-white shadow-2xl dark:bg-neutral-900 border-neutral-200/50 dark:border-neutral-700/50',
            'animate-scale-in',
          ]"
        >
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-neutral-200/50 px-5 py-4 dark:border-neutral-700/50">
            <div class="flex items-center gap-2 text-base text-neutral-800 font-bold dark:text-neutral-100">
              <div class="i-solar:magic-stick-3-bold-duotone text-lg text-primary-500" />
              <span>Prompt the Producer</span>
            </div>
            <button
              class="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              @click="close"
            >
              <div class="i-solar:close-square-outline text-lg" />
            </button>
          </div>

          <!-- Body -->
          <div class="flex flex-col gap-4 p-5">
            <!-- Guidance Textarea -->
            <div class="flex flex-col gap-1.5">
              <label class="text-xs text-neutral-500 font-semibold tracking-wider uppercase dark:text-neutral-400">
                Direction / Style (Optional)
              </label>
              <textarea
                v-model="guidance"
                rows="3"
                placeholder="e.g. 'something teasing', 'acknowledge her feelings', 'be vulnerable'..."
                class="w-full resize-none border border-neutral-200 rounded-xl bg-neutral-50/50 p-3 text-sm text-neutral-800 outline-none transition-all dark:border-neutral-700 focus:border-primary-500 dark:bg-neutral-900/50 dark:text-neutral-100 dark:focus:border-primary-400"
                @keydown.enter.ctrl.prevent="handleGenerate"
              />
            </div>

            <!-- Context Depth Slider -->
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <label class="text-xs text-neutral-500 font-semibold tracking-wider uppercase dark:text-neutral-400">
                  Context Depth
                </label>
                <span class="rounded bg-primary-500/10 px-2 py-0.5 text-xs text-primary-500 font-bold font-mono">
                  {{ contextDepth }} messages
                </span>
              </div>
              <input
                v-model.number="contextDepth"
                type="range"
                min="5"
                max="30"
                step="1"
                class="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-primary-500 dark:bg-neutral-700"
              >
              <span class="text-[10px] text-neutral-400 dark:text-neutral-500">
                How many recent messages to include as context for the dialogue generation.
              </span>
            </div>

            <!-- Suggestion Count Slider -->
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <label class="text-xs text-neutral-500 font-semibold tracking-wider uppercase dark:text-neutral-400">
                  Suggestions Count
                </label>
                <span class="rounded bg-primary-500/10 px-2 py-0.5 text-xs text-primary-500 font-bold font-mono">
                  {{ suggestionCount }} choices
                </span>
              </div>
              <input
                v-model.number="suggestionCount"
                type="range"
                min="2"
                max="6"
                step="1"
                class="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-primary-500 dark:bg-neutral-700"
              >
              <span class="text-[10px] text-neutral-400 dark:text-neutral-500">
                Number of response choices to generate.
              </span>
            </div>

            <!-- Generate short replies Checkbox -->
            <label class="flex cursor-pointer select-none items-center gap-2.5 py-1">
              <input
                v-model="shortReplies"
                type="checkbox"
                class="h-4 w-4 border-neutral-300 rounded text-primary-500 accent-primary-500 focus:ring-primary-500"
              >
              <div class="flex flex-col">
                <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">Generate short replies</span>
                <span class="text-[10px] text-neutral-400 dark:text-neutral-500">Keep generated options short (1-2 sentences)</span>
              </div>
            </label>

            <!-- Auto-Send Checkbox -->
            <label class="flex cursor-pointer select-none items-center gap-2.5 py-1">
              <input
                v-model="autoSend"
                type="checkbox"
                class="h-4 w-4 border-neutral-300 rounded text-primary-500 accent-primary-500 focus:ring-primary-500"
              >
              <div class="flex flex-col">
                <span class="text-xs text-neutral-700 font-semibold dark:text-neutral-300">Auto-send on click</span>
                <span class="text-[10px] text-neutral-400 dark:text-neutral-500">Immediately send the choice upon clicking it</span>
              </div>
            </label>
          </div>

          <!-- Footer -->
          <div class="flex justify-end gap-2 border-t border-neutral-200/50 bg-neutral-50/50 px-5 py-3.5 dark:border-neutral-700/50 dark:bg-neutral-900/30">
            <button
              class="rounded-lg px-4 py-2 text-xs text-neutral-600 font-semibold transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              @click="close"
            >
              Cancel
            </button>
            <button
              class="rounded-lg bg-primary-500 px-4 py-2 text-xs text-white font-semibold shadow-sm transition-colors hover:bg-primary-600"
              @click="handleGenerate"
            >
              Inspire me
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
