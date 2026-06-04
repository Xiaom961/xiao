<script setup lang="ts">
import { useBroadcastChannel } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import CaptionPanel from './CaptionPanel.vue'
import StorySelectorModal from './StorySelectorModal.vue'

import { useDatingSimStore } from '../../stores/dating-sim'
import { useAiriCardStore } from '../../stores/modules/airi-card'

const datingSimStore = useDatingSimStore()
const cardStore = useAiriCardStore()
const { post: postChatInput } = useBroadcastChannel({ name: 'airi-chat-input-bridge' })

const visibleChoices = computed(() => {
  return datingSimStore.choices.filter((c: any) => datingSimStore.evaluateCondition(c.condition))
})

const autonomousEnabled = computed(() => {
  return cardStore.activeCard?.extensions?.airi?.artistry?.autonomousEnabled ?? false
})

const timerPercentage = computed(() => {
  return Math.min(100, Math.max(0, (datingSimStore.getVariable('Timer') / 10) * 100))
})

const containerBottomClass = computed(() => {
  return (datingSimStore.settings.inlineCaption && datingSimStore.currentSubtitle)
    ? 'bottom-[240px]'
    : 'bottom-[40px]'
})

function handleChoiceClick(choice: any) {
  if (choice.cost && datingSimStore.getVariable('ActionPoints') >= choice.cost) {
    datingSimStore.setVariable('ActionPoints', datingSimStore.getVariable('ActionPoints') - choice.cost)
  }

  if (choice.action === 'llm_topic') {
    datingSimStore.setVariable('Intimacy', Math.min(100, datingSimStore.getVariable('Intimacy') + 2))
    postChatInput({ sendingMessage: choice.text, options: { skipAssistant: false, metadata: { source: 'dating-sim' } } })
    datingSimStore.evaluateParameters(`I want to talk about: ${choice.text}`)
  }
  else if (choice.action === 'llm_item') {
    datingSimStore.setVariable('Intimacy', Math.min(100, datingSimStore.getVariable('Intimacy') + 5))
    postChatInput({ sendingMessage: `*I give you a gift:* ${choice.text}`, options: { skipAssistant: false, metadata: { source: 'dating-sim' } } })
    datingSimStore.evaluateParameters(`*I give you a gift:* ${choice.text}`)
  }
  else {
    datingSimStore.setVariable('Intimacy', Math.min(100, datingSimStore.getVariable('Intimacy') + 1))
    postChatInput({ sendingMessage: choice.text, options: { skipAssistant: false, metadata: { source: 'dating-sim' } } })
    datingSimStore.evaluateParameters(choice.text)
  }

  datingSimStore.setVariable('Timer', 0)
  datingSimStore.choices = []
  datingSimStore.currentSubtitle = ''
}

const customPrompt = ref('')
function submitCustomPrompt() {
  if (!customPrompt.value.trim())
    return
  datingSimStore.setVariable('Intimacy', Math.min(100, datingSimStore.getVariable('Intimacy') + 1))
  postChatInput({ sendingMessage: customPrompt.value, options: { skipAssistant: false, metadata: { source: 'dating-sim' } } })
  datingSimStore.evaluateParameters(customPrompt.value)
  customPrompt.value = ''
  datingSimStore.setVariable('Timer', 0)
  datingSimStore.choices = []
  datingSimStore.currentSubtitle = ''
}

const showSelector = ref(false)

watch(() => [datingSimStore.enabled, datingSimStore.settings.gameMode], ([enabled, mode]) => {
  if (enabled && mode === 'goal_driven' && !datingSimStore.activeStoryline) {
    showSelector.value = true
  }
  else {
    showSelector.value = false
  }
}, { immediate: true })

function handleStorySelect(story: any, customPromptVal: string) {
  showSelector.value = false
  datingSimStore.activeStoryline = story

  const initialChoices = [
    { id: 'sc1', text: 'Introduce yourself and start the date', icon: 'i-solar:chat-round-dots-bold', action: 'llm_topic' },
    { id: 'sc2', text: 'Break the ice with something playful', icon: 'i-solar:magic-stick-bold', action: 'llm_topic' },
    { id: 'sc3', text: 'Focus on the task at hand', icon: 'i-solar:star-bold', action: 'llm_topic' },
    { id: 'sc4', text: 'Stare in silent anticipation', icon: 'i-solar:eye-bold', action: 'llm_topic' },
  ]

  datingSimStore.triggerTestSyncCustom(initialChoices, customPromptVal)
}
</script>

<template>
  <div v-if="datingSimStore.enabled" class="pointer-events-none absolute inset-0 z-50 flex flex-col justify-end overflow-hidden pb-8">
    <!-- Background cover image (Goal-Driven initial phase) -->
    <div
      v-if="datingSimStore.settings.gameMode === 'goal_driven' && datingSimStore.activeStoryline && (datingSimStore.resolvedSceneryRoute === 'background' || datingSimStore.resolvedSceneryRoute === 'bg_widget')"
      class="absolute inset-0 h-full w-full transition-opacity duration-1000 -z-10"
    >
      <img
        :src="datingSimStore.activeStoryline.coverImage"
        class="h-full w-full object-cover opacity-100"
        alt="Storyline Background"
      >
    </div>

    <!-- Top-Right Floating Stats -->
    <div class="pointer-events-auto absolute right-8 top-6 flex flex-col gap-4">
      <!-- Intimacy Badge -->
      <div class="min-w-[220px] flex flex-col gap-3 border border-white/20 rounded-2xl bg-white/10 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.15)] backdrop-blur-[12px] backdrop-saturate-[180%] transition-all dark:bg-black/30 hover:bg-white/20">
        <div class="flex items-center justify-between text-sm text-white font-semibold tracking-wide">
          <span>Intimacy</span>
          <div class="i-solar:heart-bold text-xl text-rose-400 drop-shadow-[0_0_8px_rgba(251,113,133,0.8)]" />
        </div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-black/40 shadow-inner">
          <div class="h-full rounded-full from-rose-400 to-pink-500 bg-gradient-to-r shadow-[0_0_10px_rgba(244,63,94,0.6)] transition-all duration-300 ease-out" :style="{ width: `${Math.min(100, datingSimStore.getVariable('Intimacy'))}%` }" />
        </div>
        <div class="text-right text-xs text-white/80 font-mono">
          {{ datingSimStore.getVariable('Intimacy') }} / 100
        </div>
      </div>

      <!-- Mood & AP Badge -->
      <div class="min-w-[220px] flex flex-col gap-3 border border-white/20 rounded-2xl bg-white/10 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.15)] backdrop-blur-[12px] backdrop-saturate-[180%] transition-all dark:bg-black/30 hover:bg-white/20">
        <div class="flex items-center justify-between text-sm text-white font-semibold tracking-wide">
          <span>Mood</span>
          <span class="border border-blue-400/50 rounded-full bg-blue-500/30 px-2.5 py-0.5 text-white font-medium shadow-[0_0_10px_rgba(59,130,246,0.3)] backdrop-blur-md">{{ datingSimStore.mood }}</span>
        </div>
        <div v-if="datingSimStore.currentPhase === 'conversation'" class="mt-2 flex items-center justify-between text-sm text-white font-semibold tracking-wide">
          <span>AP</span>
          <div class="flex gap-1.5">
            <div v-for="i in 5" :key="i" class="h-3 w-3 rounded-full transition-all duration-300" :class="i <= datingSimStore.getVariable('ActionPoints') ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]' : 'bg-black/40'" />
          </div>
        </div>
      </div>

      <!-- Timer Badge (Lightning Round Mode) -->
      <div v-if="datingSimStore.settings.lightningRounds && datingSimStore.getVariable('Timer') > 0" class="min-w-[220px] flex flex-col gap-3 border border-white/20 rounded-2xl bg-white/10 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.15)] backdrop-blur-[12px] backdrop-saturate-[180%] transition-all dark:bg-black/30 hover:bg-white/20">
        <div class="flex items-center justify-between text-sm text-white font-semibold tracking-wide">
          <span>Time Remaining</span>
          <div class="i-solar:clock-circle-bold-duotone text-xl text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
        </div>
        <div class="h-2 w-full overflow-hidden rounded-full bg-black/40 shadow-inner">
          <div class="h-full animate-pulse rounded-full transition-all duration-100 ease-linear" :class="timerPercentage < 30 ? 'bg-gradient-to-r from-red-500 to-rose-600 shadow-[0_0_10px_rgba(225,29,72,0.8)]' : 'bg-gradient-to-r from-cyan-400 to-blue-500 shadow-[0_0_10px_rgba(56,189,248,0.8)]'" :style="{ width: `${timerPercentage}%` }" />
        </div>
      </div>
    </div>

    <!-- Center Floating Branching Choices & Input -->
    <div :class="['pointer-events-none absolute inset-x-0 top-[20px] flex flex-col items-center justify-center', containerBottomClass]">
      <!-- Choices/Input Stack -->
      <div class="custom-scrollbar pointer-events-auto max-h-full max-w-[90vw] w-[650px] flex flex-col gap-4 overflow-y-auto pr-4">
        <!-- AA Upsell Tip -->
        <div v-if="visibleChoices.length === 0 && !autonomousEnabled" class="pointer-events-auto border border-yellow-400/20 rounded-2xl bg-yellow-500/10 p-4 text-center shadow-[0_8px_32px_rgba(0,0,0,0.15)] backdrop-blur-[12px] transition-all hover:bg-yellow-500/15">
          <p class="text-sm text-yellow-100/90 font-semibold tracking-wide drop-shadow-md">
            Want options automatically generated? Enable <span class="text-yellow-300 font-bold underline">Autonomous Artistry</span> in your companion settings, or click the <span class="text-purple-300 font-bold">Sparkle ✨</span> button below to generate choices manually.
          </p>
        </div>

        <!-- Choices Stack -->
        <template v-if="visibleChoices.length > 0">
          <button
            v-for="choice in visibleChoices"
            :key="choice.id"
            class="group relative flex flex-shrink-0 items-center gap-5 overflow-hidden border border-white/20 rounded-2xl bg-white/10 px-6 py-4 text-left shadow-[0_8px_32px_rgba(0,0,0,0.15)] backdrop-blur-[12px] backdrop-saturate-[180%] transition-all duration-300 active:scale-[0.98] hover:scale-[1.02] hover:border-white/40 dark:bg-black/30 hover:bg-white/20"
            @click="handleChoiceClick(choice)"
          >
            <!-- Hover light reflection effect -->
            <div class="absolute inset-0 from-transparent via-white/10 to-transparent bg-gradient-to-r transition-transform duration-700 ease-in-out -translate-x-[150%] group-hover:translate-x-[150%]" />

            <div v-if="choice.icon" :class="[choice.icon, 'text-3xl text-blue-300 drop-shadow-[0_0_8px_rgba(147,197,253,0.5)] transition-transform group-hover:scale-110']" />
            <div v-else class="i-solar:chat-round-dots-bold-duotone text-3xl text-blue-300 drop-shadow-[0_0_8px_rgba(147,197,253,0.5)] transition-transform group-hover:scale-110" />

            <span class="flex-1 text-xl text-white font-medium tracking-wide drop-shadow-md">{{ choice.text }}</span>

            <div v-if="choice.cost" class="flex items-center gap-1.5 border border-white/10 rounded-full bg-black/40 px-3 py-1.5">
              <div class="i-solar:lightning-bold text-base text-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.8)]" />
              <span class="text-sm text-white/90 font-bold">{{ choice.cost }} AP</span>
            </div>
          </button>
        </template>

        <!-- Custom Prompt Input -->
        <div class="group relative flex flex-shrink-0 items-center gap-4 border border-white/20 rounded-2xl bg-white/10 px-6 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.15)] backdrop-blur-[12px] backdrop-saturate-[180%] transition-all duration-300 focus-within:border-white/40 dark:bg-black/30 focus-within:bg-white/20">
          <div class="i-solar:keyboard-bold-duotone text-3xl text-purple-300 drop-shadow-[0_0_8px_rgba(216,180,254,0.5)] transition-transform group-focus-within:scale-110" />
          <input
            v-model="customPrompt"
            type="text"
            placeholder="Or say something else..."
            class="w-full flex-1 bg-transparent text-xl text-white font-medium tracking-wide outline-none drop-shadow-md placeholder:text-white/40"
            @keydown.enter="submitCustomPrompt"
          >
          <div class="flex gap-2">
            <!-- Sparkle Button (Generate Choices manually / Retry) -->
            <button
              class="border border-purple-400/50 rounded-xl bg-purple-500/30 p-2 transition-all active:scale-95 hover:scale-105 hover:bg-purple-500/50"
              title="Generate suggestions/Retry choices"
              :disabled="datingSimStore.isGenerating"
              @click="datingSimStore.generateLiveChoices()"
            >
              <div v-if="datingSimStore.isGenerating" class="i-solar:restart-square-bold animate-spin text-xl text-white" />
              <div v-else class="i-solar:magic-stick-3-bold-duotone text-xl text-white" />
            </button>
            <button class="border border-purple-400/50 rounded-xl bg-purple-500/30 p-2 transition-colors hover:bg-purple-500/50" @click="submitCustomPrompt">
              <div class="i-solar:plain-2-bold text-xl text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom Dialogue -->
    <div v-if="datingSimStore.settings.inlineCaption && datingSimStore.currentSubtitle" class="pointer-events-none mb-4 w-full flex justify-center px-12">
      <div class="pointer-events-auto relative max-w-4xl w-full">
        <!-- Main Dialogue Box -->
        <div class="group relative min-h-[180px] flex flex-col justify-center overflow-hidden border border-white/20 rounded-3xl bg-white/10 p-10 shadow-[0_16px_40px_rgba(0,0,0,0.3)] backdrop-blur-[16px] backdrop-saturate-[200%] transition-all dark:bg-black/40 hover:bg-white/15">
          <!-- Subtle top gradient border effect -->
          <div class="absolute left-0 right-0 top-0 h-[1px] from-transparent via-white/40 to-transparent bg-gradient-to-r" />

          <!-- Nameplate integrated smoothly -->
          <div class="absolute left-10 top-6 flex items-center gap-2 opacity-80">
            <div class="i-solar:user-bold text-lg text-blue-400" />
            <span class="text-sm text-blue-200 font-bold tracking-widest uppercase drop-shadow-md">Character</span>
          </div>

          <!-- Modular Real-Time Caption Panel inside original frame -->
          <div class="mt-8 w-full flex justify-center">
            <CaptionPanel
              :show-active-sentence-only="true"
              :transparent-bg="true"
              text-size="text-3xl"
              :fallback-text="datingSimStore.currentSubtitle"
            />
          </div>

          <!-- Auto-advance indicator -->
          <div class="i-solar:alt-arrow-down-bold absolute bottom-6 right-8 animate-bounce text-3xl text-white/50" />
        </div>
      </div>
    </div>

    <!-- Story Select Modal -->
    <StorySelectorModal
      :show="showSelector"
      @close="showSelector = false"
      @select="handleStorySelect"
    />
  </div>
</template>
