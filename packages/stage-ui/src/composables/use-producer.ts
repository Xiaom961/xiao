import type { ChatProvider } from '@xsai-ext/providers/utils'

import type { ChatHistoryItem } from '../types/chat'

import { storeToRefs } from 'pinia'
import { ref } from 'vue'

import * as v from 'valibot'

import { useLLM } from '../stores/llm'
import { useConsciousnessStore } from '../stores/modules/consciousness'
import { useProvidersStore } from '../stores/providers'

const ChoiceSchema = v.object({
  title: v.string(),
  message: v.string(),
})

const ProducerResponseSchema = v.object({
  options: v.array(ChoiceSchema),
})

function sanitizeChatContent(text: string) {
  return text
    .replace(/<\|ACT:[^>]*\|>/g, ' ')
    .replace(/<\|[^>]+\|>/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractPartText(part: any): string {
  if (!part)
    return ''
  if (typeof part === 'string')
    return part
  if (typeof part.text === 'string')
    return part.text
  if (typeof part.input === 'string')
    return part.input
  if (typeof part.output === 'string')
    return part.output
  return ''
}

function extractMessageText(message: ChatHistoryItem): string {
  if (message.role === 'assistant' && Array.isArray((message as any).slices)) {
    const sliceText = (message as any).slices.filter((slice: any) => slice?.type === 'text' && typeof slice.text === 'string').map((slice: any) => slice.text).join(' ')

    if (sliceText.trim())
      return sanitizeChatContent(sliceText)
  }

  const content = (message as any).content
  if (typeof content === 'string')
    return sanitizeChatContent(content)

  if (Array.isArray(content)) {
    return sanitizeChatContent(content.map(extractPartText).join(' '))
  }

  return ''
}

export function useProducer() {
  const llmStore = useLLM()
  const consciousnessStore = useConsciousnessStore()
  const providersStore = useProvidersStore()
  const { activeProvider, activeModel } = storeToRefs(consciousnessStore)

  const loading = ref(false)
  const error = ref<string | null>(null)

  async function generateSuggestions(options: {
    characterName: string
    messages: ChatHistoryItem[]
    guidance?: string
    contextDepth: number
    count: number
    shortReplies: boolean
  }) {
    loading.value = true
    error.value = null

    try {
      const providerId = activeProvider.value
      const modelId = activeModel.value

      if (!providerId || !modelId) {
        throw new Error('No active AI provider/model configured.')
      }

      const provider = await providersStore.getProviderInstance<ChatProvider>(providerId)
      if (!provider) {
        throw new Error(`Failed to resolve provider instance for "${providerId}".`)
      }

      // Slice messages according to context depth
      const relevantMessages = options.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-options.contextDepth)

      const chatHistoryText = relevantMessages
        .map((m) => {
          const speaker = m.role === 'user' ? 'User' : options.characterName
          const content = extractMessageText(m)
          return `${speaker}: ${content}`
        })
        .join('\n')

      const systemPrompt = `You are a dialogue writing assistant for an interactive roleplay. 
Your job is to suggest ${options.count} things the USER could say next, written in the user's natural, personal voice, please ensure you follow their style of capitalization and punctuation and the way they say things including action brackets and asterisks to imitate the user as closely as possible.

The conversation so far involves the user chatting with ${options.characterName}.
${options.guidance ? `The user wants suggestions that feel like: "${options.guidance}"` : ''}

Rules:
- Each suggestion must sound like something the user would naturally say, not a formal prompt
${options.shortReplies ? '- Keep each message under 2 sentences' : ''}
- Vary the emotional register: curious, playful, sincere, bold — don't make all suggestions the same tone
- No meta-commentary, no "(OOC)" notes, no quotation marks around the message text
- Output exactly ${options.count} options matching the requested voice style.`

      const userPrompt = `Here is the conversation history so far:
${chatHistoryText}

Generate ${options.count} options for what the User could say next.`

      const res = await llmStore.generateObject<{ options: Array<{ title: string, message: string }> }>(
        modelId,
        provider,
        {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          schema: ProducerResponseSchema,
          normalize: (parsed: any) => {
            if (parsed && Array.isArray(parsed.options)) {
              parsed.options = parsed.options.map((opt: any) => ({
                title: String(opt.title || 'Option'),
                message: String(opt.message || ''),
              }))
            }
            return parsed
          },
        },
      )

      if (!res?.options || res.options.length === 0) {
        throw new Error('No suggestions generated.')
      }

      return res.options
    }
    catch (err: any) {
      error.value = err.message || 'Failed to generate suggestions'
      console.error('[useProducer] Error generating suggestions:', err)
      throw err
    }
    finally {
      loading.value = false
    }
  }

  return {
    generateSuggestions,
    loading,
    error,
  }
}
