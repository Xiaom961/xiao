<script setup lang="ts">
import { useBackgroundStore } from '@proj-airi/stage-ui/stores/background'
import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useArtistryStore } from '@proj-airi/stage-ui/stores/modules/artistry'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { Button, FieldInput, Select } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed, ref, watch } from 'vue'

interface ConceptData {
  description: string
  prompt: string
  isBase?: boolean
  artistry?: {
    provider?: string
    model?: string
    options?: any
  }
  manifestation?: {
    modelId?: string
    mood?: string
    backgroundId?: string
    active_expressions?: Record<string, number>
  }
  speech?: {
    provider?: string
    model?: string
    voice_id?: string
  }
}

interface Props {
  modelValue: boolean
  conceptId?: string
  initialData?: ConceptData
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'save', payload: { id: string, data: ConceptData }): void
}>()

const artistryStore = useArtistryStore()
const displayModelsStore = useDisplayModelsStore()
const providersStore = useProvidersStore()
const speechStore = useSpeechStore()
const backgroundStore = useBackgroundStore()
const airiCardStore = useAiriCardStore()

const { activeSpeechProvider } = storeToRefs(speechStore)

const activeTab = ref('identity')
const id = ref('')
const description = ref('')
const prompt = ref('')

// Concept Type
const isBase = ref(false)

// Artistry Overrides
const selectedProvider = ref<string>('inherit')
const selectedModel = ref<string>('')
const selectedOptionsStr = ref<string>('{\n  \n}')

// Manifestation Overrides
const selectedModelId = ref<string>('inherit')
const selectedMood = ref<string>('')
const selectedExpressions = ref<Record<string, number>>({})

// Speech Overrides
const selectedSpeechProvider = ref<string>('inherit')
const selectedSpeechModel = ref<string>('')
const selectedSpeechVoiceId = ref<string>('')

// Scene Overrides
const selectedBackgroundId = ref<string>('inherit')

// Director status (determines if Scene tab is functional)
const isDirectorActive = computed(() => {
  return airiCardStore.activeCard?.extensions?.airi?.artistry?.autonomousEnabled ?? false
})

// Initialize when modal opens or props change
watch(() => [props.modelValue, props.conceptId, props.initialData], () => {
  if (props.modelValue) {
    activeTab.value = 'identity'
    id.value = props.conceptId || ''
    description.value = props.initialData?.description || ''
    prompt.value = props.initialData?.prompt || ''

    isBase.value = props.initialData?.isBase ?? false

    selectedProvider.value = props.initialData?.artistry?.provider || 'inherit'
    selectedModel.value = props.initialData?.artistry?.model || ''
    selectedOptionsStr.value = props.initialData?.artistry?.options
      ? JSON.stringify(props.initialData.artistry.options, null, 2)
      : '{\n  \n}'

    selectedModelId.value = props.initialData?.manifestation?.modelId || 'inherit'
    selectedMood.value = props.initialData?.manifestation?.mood || ''
    selectedSpeechProvider.value = props.initialData?.speech?.provider || 'inherit'
    selectedSpeechModel.value = props.initialData?.speech?.model || ''
    selectedSpeechVoiceId.value = props.initialData?.speech?.voice_id || ''

    selectedBackgroundId.value = props.initialData?.manifestation?.backgroundId || 'inherit'

    selectedExpressions.value = props.initialData?.manifestation?.active_expressions
      ? { ...props.initialData.manifestation.active_expressions }
      : {}
  }
}, { immediate: true })

const manifestationSearch = ref('')
const manifestationFormatFilter = ref<'all' | 'live2d' | 'vrm' | 'spine' | 'mmd'>('all')

const mapFormatRenderer: Record<string, string> = {
  'live2d-zip': 'Live2D',
  'live2d-directory': 'Live2D',
  'vrm': 'VRM',
  'spine-zip': 'Spine',
  'pmx-directory': 'MMD',
  'pmx-zip': 'MMD',
  'pmd': 'MMD',
}

const filteredManifestationModels = computed(() => {
  let result = [...displayModelsStore.displayModels]

  if (manifestationSearch.value.trim()) {
    const q = manifestationSearch.value.toLowerCase()
    result = result.filter(m => m.name.toLowerCase().includes(q))
  }

  if (manifestationFormatFilter.value !== 'all') {
    result = result.filter((m) => {
      const fmt = m.format.toLowerCase()
      if (manifestationFormatFilter.value === 'live2d')
        return fmt.includes('live2d')
      if (manifestationFormatFilter.value === 'vrm')
        return fmt === 'vrm'
      if (manifestationFormatFilter.value === 'spine')
        return fmt.includes('spine')
      if (manifestationFormatFilter.value === 'mmd')
        return fmt.includes('pmx') || fmt === 'pmd'
      return true
    })
  }

  // Sort: Put the currently selected model first in the grid list
  if (selectedModelId.value && selectedModelId.value !== 'inherit') {
    const selectedIdx = result.findIndex(m => m.id === selectedModelId.value)
    if (selectedIdx > -1) {
      const [selectedItem] = result.splice(selectedIdx, 1)
      result.unshift(selectedItem)
    }
  }

  return result
})

// Helper to determine if the currently selected model is missing from displayModels
const isSelectedModelMissing = computed(() => {
  if (!selectedModelId.value || selectedModelId.value === 'inherit')
    return false
  return !displayModelsStore.displayModels.some(m => m.id === selectedModelId.value)
})

const providerOptions = [
  { value: 'inherit', label: 'Inherit Global' },
  { value: 'replicate', label: 'Replicate' },
  { value: 'comfyui', label: 'ComfyUI' },
  { value: 'none', label: 'Disable Artistry' },
]

const speechProviderOptions = computed(() => [
  { value: 'inherit', label: 'Inherit Global' },
  { value: 'none', label: 'Disable Speech' },
  ...providersStore.configuredSpeechProvidersMetadata.map(p => ({
    value: p.id,
    label: p.localizedName || p.name,
  })),
])

const speechModelOptions = computed(() => {
  const provider = selectedSpeechProvider.value === 'inherit' ? activeSpeechProvider.value : selectedSpeechProvider.value
  if (!provider || provider === 'none')
    return []
  return providersStore.getModelsForProvider(provider).map(m => ({
    value: m.id,
    label: m.name || m.id,
  }))
})

const speechVoiceOptions = computed(() => {
  const provider = selectedSpeechProvider.value === 'inherit' ? activeSpeechProvider.value : selectedSpeechProvider.value
  if (!provider || provider === 'none')
    return []
  return speechStore.getVoicesForProvider(provider).map(v => ({
    value: v.id,
    label: v.name || v.id,
  }))
})

const backgroundOptions = computed(() => {
  const bgs = backgroundStore.availableBackgrounds || []
  return [
    { value: 'inherit', label: 'No Override' },
    ...bgs.map(bg => ({
      value: bg.id,
      label: bg.title || bg.id,
    })),
  ]
})

// Watchers for speech provider changes
watch(selectedSpeechProvider, async (newProvider) => {
  const provider = newProvider === 'inherit' ? activeSpeechProvider.value : newProvider
  if (provider && provider !== 'none') {
    await speechStore.loadVoicesForProvider(provider)
    const metadata = providersStore.getProviderMetadata(provider)
    if (metadata?.capabilities.listModels) {
      await providersStore.fetchModelsForProvider(provider)
    }
  }
})
function handleSave() {
  if (!id.value.trim())
    return

  let options
  try {
    options = selectedOptionsStr.value.trim() ? JSON.parse(selectedOptionsStr.value) : undefined
  }
  catch (e) {
    // Ignore invalid JSON for now
  }

  emit('save', {
    id: id.value.trim(),
    data: {
      description: description.value.trim(),
      prompt: prompt.value.trim(),
      isBase: isBase.value,
      artistry: selectedProvider.value !== 'inherit'
        ? {
            provider: selectedProvider.value,
            model: selectedModel.value.trim(),
            options,
          }
        : undefined,
      manifestation: {
        modelId: selectedModelId.value !== 'inherit' ? selectedModelId.value : undefined,
        mood: selectedMood.value.trim() || undefined,
        backgroundId: selectedBackgroundId.value !== 'inherit' ? selectedBackgroundId.value : undefined,
        active_expressions: Object.keys(selectedExpressions.value).length > 0
          ? { ...selectedExpressions.value }
          : undefined,
      },
      speech: selectedSpeechProvider.value !== 'inherit'
        ? {
            provider: selectedSpeechProvider.value,
            model: selectedSpeechModel.value.trim(),
            voice_id: selectedSpeechVoiceId.value.trim(),
          }
        : undefined,
    },
  })
  emit('update:modelValue', false)
}
</script>

<template>
  <DialogRoot :open="modelValue" @update:open="emit('update:modelValue', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-110 bg-black/60 backdrop-blur-md data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn" />
      <DialogContent class="fixed left-1/2 top-1/2 z-110 m-0 max-h-[90vh] max-w-xl w-[90vw] flex flex-col overflow-hidden border border-neutral-200 rounded-2xl bg-white shadow-2xl -translate-x-1/2 -translate-y-1/2 data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow dark:border-neutral-700 dark:bg-neutral-900">
        <!-- Modal Header -->
        <div class="border-b border-neutral-100 p-6 pb-4 dark:border-neutral-800 sm:p-8">
          <div class="flex items-center gap-3">
            <div class="rounded-xl bg-primary-500/10 p-2 text-primary-500 shadow-primary-500/10 shadow-sm">
              <div class="i-solar:magic-stick-3-bold-duotone text-2xl" />
            </div>
            <div>
              <DialogTitle class="text-xl text-neutral-800 font-bold dark:text-neutral-100">
                {{ conceptId ? 'Concept Studio' : 'New Concept' }}
              </DialogTitle>
              <code v-if="conceptId" class="rounded bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500 font-mono dark:bg-black/40">
                ID: {{ conceptId }}
              </code>
            </div>
          </div>

          <!-- Tab Navigation -->
          <div class="mt-6 flex gap-1">
            <button
              v-for="t in ['identity', 'artistry', 'manifestation', 'scene', 'speech']"
              :key="t"
              class="rounded-lg px-4 py-2 text-xs font-bold transition-all"
              :class="activeTab === t ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/20' : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'"
              @click="activeTab = t"
            >
              {{ t.charAt(0).toUpperCase() + t.slice(1) }}
            </button>
          </div>
        </div>

        <!-- Modal Content -->
        <div class="flex-1 overflow-y-auto p-6 sm:p-8">
          <!-- Identity Tab -->
          <div v-if="activeTab === 'identity'" class="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
            <FieldInput
              v-model="id"
              label="Concept ID"
              placeholder="e.g. silver_performance"
              description="A unique identifier the Director will use to trigger this state."
              :disabled="!!conceptId"
            />

            <FieldInput
              v-model="description"
              label="Narrative Description"
              placeholder="When should this be used?"
              description="Helps the Director understand the context for this concept."
              :single-line="false"
              :rows="3"
            />

            <FieldInput
              v-model="prompt"
              label="Prompt Snippet"
              placeholder=", (iridescent silver tape:1.4), high contrast"
              description="Keywords or modifiers to inject into the final image prompt."
              :single-line="false"
              :rows="3"
            />

            <!-- Base vs Layer toggle -->
            <div class="flex items-center justify-between border border-neutral-200 rounded-xl bg-neutral-50/50 p-4 dark:border-neutral-700 dark:bg-black/20">
              <div>
                <span class="text-sm text-neutral-700 font-bold dark:text-neutral-300">Base Concept (Exclusionary)</span>
                <p class="mt-0.5 text-[10px] text-neutral-500 leading-relaxed">
                  When active, clears the stack first. Use for outfits, character swaps, or any state that can't overlap.
                </p>
              </div>
              <button
                :class="[
                  'relative h-6 w-11 rounded-full transition-colors duration-200',
                  isBase ? 'bg-primary-500' : 'bg-neutral-300 dark:bg-neutral-600',
                ]"
                @click="isBase = !isBase"
              >
                <span
                  :class="[
                    'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200',
                    isBase ? 'translate-x-5' : 'translate-x-0',
                  ]"
                />
              </button>
            </div>
          </div>

          <!-- Artistry Tab -->
          <div v-if="activeTab === 'artistry'" class="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
            <div class="flex flex-col gap-2">
              <label class="text-sm text-neutral-700 font-bold dark:text-neutral-300">Generation Provider</label>
              <Select v-model="selectedProvider" :options="providerOptions" />
              <p class="text-[10px] text-neutral-500 italic">
                The visual engine used for this concept.
              </p>
            </div>

            <div v-if="selectedProvider !== 'inherit' && selectedProvider !== 'none'" class="border-t border-neutral-100 pt-4 space-y-6 dark:border-neutral-800">
              <div v-if="selectedProvider === 'comfyui'" class="flex flex-col gap-2">
                <label class="text-sm text-neutral-700 font-bold dark:text-neutral-300">Select Workflow</label>
                <Select
                  v-model="selectedModel"
                  :options="artistryStore.comfyuiSavedWorkflows.map(w => ({ value: w.id, label: w.name || w.id }))"
                />
                <p class="text-[10px] text-neutral-500 italic">
                  Choose from your registered ComfyUI templates.
                </p>
              </div>

              <FieldInput
                v-else
                v-model="selectedModel"
                label="Model ID"
                placeholder="e.g. black-forest-labs/flux-schnell"
              />

              <FieldInput
                v-model="selectedOptionsStr"
                label="Advanced Options (JSON)"
                description="Custom parameters for the specific provider."
                :single-line="false"
                :rows="6"
              />
            </div>
          </div>

          <!-- Manifestation Tab -->
          <div v-if="activeTab === 'manifestation'" class="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-4">
            <div class="flex flex-col gap-2">
              <label class="text-sm text-neutral-700 font-bold dark:text-neutral-300">Physical Model Override</label>

              <!-- Search & Filter Controls -->
              <div class="flex items-center gap-2">
                <div class="relative flex-1">
                  <span class="i-solar:magnifer-linear absolute left-2.5 top-1/2 translate-y-[-50%] text-xs text-neutral-400" />
                  <input
                    v-model="manifestationSearch"
                    type="text"
                    placeholder="Search models..."
                    class="w-full border border-neutral-200 rounded-lg bg-neutral-50 py-1.5 pl-8 pr-2.5 text-[11px] text-neutral-700 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-300 focus:outline-none focus:ring-1 focus:ring-primary-500/50"
                  >
                </div>
                <select
                  v-model="manifestationFormatFilter"
                  class="cursor-pointer border border-neutral-200 rounded-lg bg-neutral-50 px-2 py-1.5 text-[11px] font-medium outline-none dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  <option value="all">
                    All Formats
                  </option>
                  <option value="live2d">
                    Live2D
                  </option>
                  <option value="vrm">
                    VRM
                  </option>
                  <option value="spine">
                    Spine
                  </option>
                  <option value="mmd">
                    MMD
                  </option>
                </select>
              </div>

              <!-- Compact Models Grid -->
              <div class="max-h-64 overflow-y-auto pr-1">
                <div class="grid grid-cols-3 gap-2">
                  <!-- Inherit Default Card -->
                  <div
                    :class="[
                      'group relative aspect-square border rounded-xl overflow-hidden cursor-pointer flex flex-col items-center justify-center p-2 text-center transition-all duration-200',
                      selectedModelId === 'inherit'
                        ? 'border-primary-500 ring-2 ring-primary-500/40 bg-primary-500/5 dark:bg-primary-500/10'
                        : 'border-neutral-200/40 dark:border-neutral-800/40 hover:ring-2 hover:ring-primary-500/50 bg-neutral-50/50 dark:bg-neutral-800/40',
                    ]"
                    @click="selectedModelId = 'inherit'"
                  >
                    <span class="i-solar:restart-bold-duotone mb-1 text-2xl text-neutral-400" />
                    <span class="text-[9px] text-neutral-600 font-bold dark:text-neutral-300">Inherit Default</span>
                  </div>

                  <!-- Missing Model Card -->
                  <div
                    v-if="isSelectedModelMissing"
                    :class="[
                      'group relative aspect-square border rounded-xl overflow-hidden cursor-pointer flex flex-col items-center justify-center p-2 text-center transition-all duration-200 border-red-500 ring-2 ring-red-500/40 bg-red-500/10',
                    ]"
                  >
                    <span class="i-solar:danger-triangle-bold-duotone mb-1 text-2xl text-red-500" />
                    <span class="text-[9px] text-red-600 font-bold dark:text-red-400">Missing Model</span>
                    <span class="absolute bottom-0 left-0 right-0 truncate bg-red-950/80 px-1 py-0.5 text-center text-[7px] text-white font-mono">
                      {{ selectedModelId }}
                    </span>
                  </div>

                  <!-- Display Models Cards -->
                  <div
                    v-for="model in filteredManifestationModels"
                    :key="model.id"
                    :class="[
                      'group relative aspect-square border rounded-xl overflow-hidden cursor-pointer bg-neutral-200/10 dark:bg-neutral-800/10 transition-all duration-200',
                      selectedModelId === model.id
                        ? 'border-primary-500 ring-2 ring-primary-500/40'
                        : 'border-neutral-200/40 dark:border-neutral-800/40 hover:ring-2 hover:ring-primary-500/50',
                    ]"
                    @click="selectedModelId = model.id"
                  >
                    <img
                      v-if="model.previewImage"
                      :src="model.previewImage"
                      class="h-full w-full object-cover"
                      loading="lazy"
                    >
                    <div v-else class="h-full w-full flex items-center justify-center bg-neutral-500/10 text-neutral-400">
                      <span class="i-solar:user-bold-duotone text-lg" />
                    </div>
                    <div class="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-center text-[8px] text-white">
                      <div class="truncate font-semibold">
                        {{ model.name }}
                      </div>
                      <div class="text-[6px] font-mono opacity-75">
                        {{ mapFormatRenderer[model.format] }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <p class="mt-1 text-[10px] text-neutral-500 italic">
                Forces a base model swap (Live2D/VRM/Spine/MMD) when this concept is active.
              </p>
            </div>
          </div>

          <!-- Speech Tab -->
          <div v-if="activeTab === 'speech'" class="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
            <div class="flex flex-col gap-2">
              <label class="text-sm text-neutral-700 font-bold dark:text-neutral-300">Speech Provider Override</label>
              <Select v-model="selectedSpeechProvider" :options="speechProviderOptions" />
              <p class="text-[10px] text-neutral-500 italic">
                Forces a specific TTS provider for this concept.
              </p>
            </div>

            <div v-if="selectedSpeechProvider !== 'none' && (selectedSpeechProvider !== 'inherit' || activeSpeechProvider)" class="border-t border-neutral-100 pt-4 space-y-6 dark:border-neutral-800">
              <div class="flex flex-col gap-2">
                <label class="text-sm text-neutral-700 font-bold dark:text-neutral-300">Vocal Model</label>
                <Select v-model="selectedSpeechModel" :options="speechModelOptions" />
                <p class="text-[10px] text-neutral-500 italic">
                  Choose the TTS engine version.
                </p>
              </div>

              <div class="flex flex-col gap-2">
                <label class="text-sm text-neutral-700 font-bold dark:text-neutral-300">Persona Voice</label>
                <Select v-model="selectedSpeechVoiceId" :options="speechVoiceOptions" />
                <p class="text-[10px] text-neutral-500 italic">
                  The unique voice assigned to this concept/actress.
                </p>
              </div>
            </div>
          </div>

          <!-- Scene Tab -->
          <div v-if="activeTab === 'scene'" class="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
            <!-- Director Active Disclaimer -->
            <div v-if="isDirectorActive" class="flex items-start gap-3 border border-amber-300/40 rounded-xl bg-amber-50/80 p-4 dark:border-amber-600/30 dark:bg-amber-900/20">
              <div class="i-solar:danger-triangle-bold mt-0.5 shrink-0 text-lg text-amber-500" />
              <div>
                <span class="text-sm text-amber-800 font-bold dark:text-amber-300">Scene Control Disabled</span>
                <p class="mt-1 text-[11px] text-amber-700 leading-relaxed dark:text-amber-400">
                  The Autonomous Director is currently active for this character. Scene overrides defined here will be ignored while the Director manages the visual environment. Disable the Director in the Artistry settings to enable manual scene control.
                </p>
              </div>
            </div>

            <!-- Explanatory Header -->
            <div class="flex items-start gap-3 border border-neutral-200 rounded-xl bg-neutral-50/50 p-4 dark:border-neutral-700 dark:bg-black/20">
              <div class="i-solar:clapperboard-open-play-bold-duotone mt-0.5 shrink-0 text-lg text-primary-500" />
              <div>
                <span class="text-sm text-neutral-700 font-bold dark:text-neutral-300">How Scene Overrides Work</span>
                <p class="mt-1 text-[11px] text-neutral-500 leading-relaxed">
                  When the <code class="rounded bg-neutral-200 px-1 py-0.5 text-[10px] font-mono dark:bg-neutral-700">&lt;|ACTOR:{{ id || 'ID' }}|&gt;</code> token is triggered during a conversation, the background will automatically switch to the one selected below.
                  This lets each character or costume maintain their own unique stage set.
                </p>
              </div>
            </div>

            <!-- Background Selector -->
            <div class="flex flex-col gap-2" :class="{ 'pointer-events-none opacity-40': isDirectorActive }">
              <label class="text-sm text-neutral-700 font-bold dark:text-neutral-300">Stage Background</label>
              <Select v-model="selectedBackgroundId" :options="backgroundOptions" />
              <p class="text-[10px] text-neutral-500 italic">
                Choose a background from your gallery. Add more via the Image Gallery.
              </p>
            </div>

            <!-- Background Preview -->
            <div v-if="selectedBackgroundId !== 'inherit'" class="mt-2">
              <div
                v-if="backgroundStore.getBackgroundUrl(selectedBackgroundId)"
                class="overflow-hidden border border-neutral-200 rounded-xl shadow-sm dark:border-neutral-700"
              >
                <img
                  :src="backgroundStore.getBackgroundUrl(selectedBackgroundId)!"
                  :alt="backgroundOptions.find(o => o.value === selectedBackgroundId)?.label || 'Preview'"
                  class="h-40 w-full object-cover"
                >
                <div class="bg-neutral-50/80 px-3 py-2 dark:bg-black/30">
                  <p class="truncate text-[10px] text-neutral-500 font-medium">
                    {{ backgroundOptions.find(o => o.value === selectedBackgroundId)?.label }}
                  </p>
                </div>
              </div>
              <div v-else class="border border-neutral-200 rounded-xl border-dashed bg-neutral-50/50 p-6 text-center dark:border-neutral-700 dark:bg-black/20">
                <div class="i-solar:gallery-broken mx-auto mb-2 text-2xl text-neutral-300" />
                <p class="text-xs text-neutral-400">
                  Preview unavailable — background may still be loading.
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Modal Footer -->
        <div class="flex items-center justify-end gap-3 border-t border-neutral-100 bg-neutral-50/50 p-6 pt-4 dark:border-neutral-800 dark:bg-black/20 sm:p-8">
          <Button
            variant="secondary"
            label="Cancel"
            @click="emit('update:modelValue', false)"
          />
          <Button
            variant="primary"
            :label="conceptId ? 'Save Changes' : 'Create Concept'"
            icon="i-solar:check-read-linear"
            :disabled="!id.trim()"
            @click="handleSave"
          />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
