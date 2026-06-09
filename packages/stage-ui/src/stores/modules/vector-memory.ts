import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { onUnmounted, ref } from 'vue'

import { storage } from '../../database/storage'
import { useLLM } from '../llm'
import { useShortTermMemoryStore } from '../memory-short-term'
import { useProvidersStore } from '../providers'
import { useSettingsChat } from '../settings/chat'
import { useAiriCardStore } from './airi-card'
import { useConsciousnessStore } from './consciousness'
import { useVisionStore } from './vision'

export interface EpisodicMemory {
  id: string
  userId: string
  sessionId: string
  text: string
  rawDialogue: string[]
  imageRefs: string[]
  audioRefs: string[]
  embedding: number[]
  tags: string[]
  topic: string
  emotion: string
  salience: number
  timestamp: number
  platform: 'desktop' | 'discord' | 'voice'
  appContext?: string
  recallCount: number
  lastRecalledAt: number
  linkedMemoryIds: string[]
}

// 1. Fallback TF-IDF L2-normalized vectorizer (384-dimensional)
function generateFallbackEmbedding(text: string): number[] {
  const size = 384
  const vector = new Array(size).fill(0)
  const words = text.toLowerCase().match(/\w+/g) || []
  if (words.length === 0)
    return vector

  words.forEach((word) => {
    let hash = 0
    for (let i = 0; i < word.length; i++) {
      hash = (hash << 5) - hash + word.charCodeAt(i)
      hash |= 0 // 32bit integer conversion
    }
    const index = Math.abs(hash) % size
    vector[index] += 1
  })

  // L2 Normalize
  let magnitude = 0
  for (let i = 0; i < size; i++) magnitude += vector[i] * vector[i]
  magnitude = Math.sqrt(magnitude)
  if (magnitude > 0) {
    for (let i = 0; i < size; i++) vector[i] /= magnitude
  }
  return vector
}

// 2. Cosine Similarity Calculation
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length)
    return 0
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }
  if (normA === 0 || normB === 0)
    return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

export const useVectorMemoryStore = defineStore('vector-memory', () => {
  const settingsChat = useSettingsChat()
  const providersStore = useProvidersStore()
  const visionStore = useVisionStore()
  const llmStore = useLLM()
  const consciousnessStore = useConsciousnessStore()
  const airiCardStore = useAiriCardStore()

  // State
  const memories = ref<EpisodicMemory[]>([])
  const isConsolidating = ref(false)
  const sessionConsolidationMeta = ref<Record<string, { lastCount: number, lastTime: number }>>({})

  // Load memories from unstorage
  async function loadMemories() {
    try {
      const data = await storage.getItem('local:vector-memories')
      if (data && Array.isArray(data)) {
        memories.value = data as EpisodicMemory[]
        console.log(`[Vector Memory] Loaded ${memories.value.length} episodic memories from storage.`)
      }
      else {
        memories.value = []
      }
    }
    catch (e) {
      console.error('[Vector Memory] Failed to load memories:', e)
      memories.value = []
    }
  }

  // Save memories to unstorage
  async function saveMemories() {
    try {
      await storage.setItem('local:vector-memories', memories.value)
      broadcast('update')
    }
    catch (e) {
      console.error('[Vector Memory] Failed to save memories:', e)
    }
  }

  // Get high-dimensional embedding for memory query
  async function getEmbedding(text: string): Promise<number[]> {
    const providerId = settingsChat.embeddingActiveProvider || settingsChat.msfActiveProvider || consciousnessStore.activeProvider
    const modelId = settingsChat.embeddingActiveModel || settingsChat.msfActiveModel || consciousnessStore.activeModel

    if (!providerId || !modelId) {
      console.log('[Vector Memory] Embedding provider not set, using L2 TF-IDF fallback.')
      return generateFallbackEmbedding(text)
    }

    try {
      const config = providersStore.getProviderConfig(providerId)
      let baseURL = (config?.baseUrl as string) || ''
      const apiKey = (config?.apiKey as string) || ''

      if (!baseURL) {
        return generateFallbackEmbedding(text)
      }

      if (!baseURL.endsWith('/')) {
        baseURL += '/'
      }

      const response = await fetch(`${baseURL}embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          input: text,
          model: modelId,
        }),
      })

      if (!response.ok) {
        throw new Error(`Embedding API failed with status: ${response.status}`)
      }

      const resData = await response.json()
      const emb = resData?.data?.[0]?.embedding
      if (Array.isArray(emb) && emb.length > 0) {
        console.log(`[Vector Memory] Remote embedding generated successfully. Size: ${emb.length}`)
        return emb
      }
      throw new Error('API returned invalid embedding array.')
    }
    catch (e) {
      console.warn('[Vector Memory] Remote embedding generation failed, using TF-IDF fallback:', e)
      return generateFallbackEmbedding(text)
    }
  }

  // Search memories based on cosine similarity + recency + salience ranking
  async function searchMemories(queryText: string, limit = 5): Promise<EpisodicMemory[]> {
    if (!settingsChat.vectorMemoryEnabled || memories.value.length === 0) {
      return []
    }

    console.log(`[Vector Memory] Searching for semantic matches for: "${queryText}"`)
    const queryEmb = await getEmbedding(queryText)

    const now = Date.now()
    const DAY_MS = 24 * 60 * 60 * 1000

    // Defensive scope filter: only consider records explicitly tagged
    // as belonging to the local desktop chat. Other scopes (e.g.
    // Discord users) may have been written into this store by
    // unaware modules (proactivity, agency) and would leak cross-scope
    // context into Xhar's personal chat. This filter is the read-side
    // defense; the write-side fix is tracked as a follow-up.
    const scopedMemories = memories.value.filter(m =>
      m.userId === 'local' && m.platform === 'desktop',
    )
    if (scopedMemories.length < memories.value.length) {
      console.warn(
        `[Vector Memory] Scope filter excluded ${memories.value.length - scopedMemories.length} non-local records from search. `
        + `This indicates possible cross-scope contamination of the main memory store.`,
      )
    }
    const candidates = scopedMemories.map((m) => {
      const similarity = cosineSimilarity(queryEmb, m.embedding)

      // Recency score decay: 1.0 for new, decaying over 30 days to 0
      const daysOld = (now - m.timestamp) / DAY_MS
      const recency = Math.max(0, 1 - daysOld / 30)

      // Recall boost: higher count yields up to 0.2 boost
      const recallBoost = Math.min(0.2, m.recallCount * 0.05)

      // Combined score
      const finalScore = 0.5 * similarity + 0.2 * recency + 0.2 * m.salience + 0.1 * recallBoost

      return {
        memory: m,
        score: finalScore,
        similarity,
      }
    })

    // Filter by relevance threshold and sort
    const ranked = candidates
      .filter(c => c.similarity > 0.15) // Minimum semantic matching threshold
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(c => c.memory)

    // Log the recalled memories and trigger reinforcement
    if (ranked.length > 0) {
      console.log(`[Vector Memory] Recalled ${ranked.length} memories. Reinforcing access counts.`)
      ranked.forEach((m) => {
        m.recallCount += 1
        m.lastRecalledAt = now
      })
      await saveMemories()
    }

    return ranked
  }

  // Insert a new manual memory explicitly
  async function addManualMemory(text: string, tags: string[] = ['manual']) {
    await loadMemories()

    console.log(`[Vector Memory] Inserting manual memory: "${text}"`)
    const embedding = await getEmbedding(text)

    const newMemory: EpisodicMemory = {
      id: nanoid(),
      userId: 'local',
      sessionId: 'manual',
      text,
      rawDialogue: [text],
      imageRefs: visionStore.lastCaptureDataUrl ? [visionStore.lastCaptureDataUrl] : [],
      audioRefs: [],
      embedding,
      tags,
      topic: 'user_note',
      emotion: 'neutral',
      salience: 0.8, // High salience for user manual memories
      timestamp: Date.now(),
      platform: 'desktop',
      recallCount: 0,
      lastRecalledAt: Date.now(),
      linkedMemoryIds: [],
    }

    memories.value.unshift(newMemory)
    await saveMemories()
    console.log('[Vector Memory] Memory inserted successfully.')
  }

  // Consolidate raw conversation into episodic memories
  async function consolidateConversation(sessionId: string, messages: any[]) {
    if (isConsolidating.value || messages.length < 4)
      return

    const now = Date.now()
    const meta = sessionConsolidationMeta.value[sessionId] || { lastCount: 0, lastTime: 0 }

    // 5 minutes cooldown (300,000 ms)
    const COOLDOWN_MS = 5 * 60 * 1000
    const timeElapsed = now - meta.lastTime
    const messagesSinceLast = messages.length - meta.lastCount
    const isFirstConsolidation = meta.lastTime === 0
    const minNewMessages = isFirstConsolidation ? 4 : 10

    if (!isFirstConsolidation && timeElapsed < COOLDOWN_MS) {
      console.log(`[Vector Memory] Consolidation throttled: cooldown active (${Math.round((COOLDOWN_MS - timeElapsed) / 1000)}s remaining)`)
      return
    }

    if (messagesSinceLast < minNewMessages) {
      console.log(`[Vector Memory] Consolidation throttled: only ${messagesSinceLast}/${minNewMessages} new messages since last run.`)
      return
    }

    // Auto-trigger: Length filter
    const dialogueMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant')
    if (settingsChat.autoTriggerLength && dialogueMessages.length < 10) {
      console.log(`[Vector Memory] Consolidation skipped: autoTriggerLength enabled and dialog has only ${dialogueMessages.length}/10 messages.`)
      return
    }

    const activeApp = visionStore.lastScrapeResult?.appName || 'N/A'
    const activeTitle = visionStore.lastScrapeResult?.windowTitle || 'N/A'

    // Auto-trigger: Gameplay filter
    const isGameActive = () => {
      const app = activeApp.toLowerCase()
      const title = activeTitle.toLowerCase()
      if (!app || app === 'n/a')
        return false

      const commonNonGames = ['explorer', 'chrome', 'msedge', 'firefox', 'brave', 'opera', 'code', 'visual studio code', 'cmd', 'powershell', 'terminal', 'electron', 'stage-ui', 'node']
      const hasNonGameApp = commonNonGames.some(pg => app.includes(pg))

      const knownGames = ['minecraft', 'factorio', 'steam', 'epicgames', 'league of legends', 'valorant', 'cyberpunk', 'roblox', 'genshin', 'unity', 'unreal']
      const hasGameKeyword = knownGames.some(gk => app.includes(gk) || title.includes(gk))

      return hasGameKeyword || !hasNonGameApp
    }

    if (settingsChat.autoTriggerGameplay && !isGameActive()) {
      console.log(`[Vector Memory] Consolidation skipped: autoTriggerGameplay enabled but no active gameplay detected (App: ${activeApp}, Title: ${activeTitle})`)
      return
    }

    const providerId = settingsChat.msfActiveProvider || consciousnessStore.activeProvider
    const modelId = settingsChat.msfActiveModel || consciousnessStore.activeModel

    if (!providerId || !modelId) {
      console.log('[Vector Memory] VLM settings not configured. Consolidation skipped.')
      return
    }

    isConsolidating.value = true
    console.log('[Vector Memory] Starting consolidation job...')

    try {
      // Load short-term memory blocks as additional context for consolidation
      let shortTermContext = ''
      try {
        const shortTermStore = useShortTermMemoryStore()
        await shortTermStore.load()
        const targetCardId = airiCardStore.activeCardId || ''
        if (targetCardId) {
          const blocks = shortTermStore.getCharacterBlocks(targetCardId).slice(0, 3)
          if (blocks.length > 0) {
            shortTermContext = blocks.map(b => `[Summary for ${b.date}]: ${b.summary}`).join('\n')
          }
        }
      }
      catch (err) {
        console.warn('[Vector Memory] Failed to load short-term memories for consolidation context:', err)
      }

      // 1. Format the conversation dialogue
      const dialogText = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-10) // analyze the last 10 messages
        .map(m => `${m.role}: ${m.content}`)
        .join('\n')

      const prompt = `
You are analyzing a recent chat history between a user and an AI character named Airi.
Your job is to determine if this exchange contains a memorable moment or significant context that should be recorded in Airi's episodic memory.
If it is memorable, you must summarize what happened in a single sentence and evaluate semantic tags, dominant emotion, and a salience rating (0.0 to 1.0).

${shortTermContext ? `Past Daily Summaries for Context:\n${shortTermContext}\n` : ''}

Chat History:
${dialogText}

Active App Context:
- App: ${activeApp}
- Title: ${activeTitle}
- Visual Screen Context: "${visionStore.lastVisualAnalysis || 'None'}"

Analyze the conversation. You must return a JSON object with this exact schema:
{
  "isMemorable": boolean,
  "summary": "dense 1-sentence narrative describing what occurred",
  "topic": "main topic discussed",
  "tags": ["extracted", "words", "or", "activities"],
  "emotion": "happy | sad | curious | excited | frustrated | neutral",
  "salience": number
}
`

      console.log('[Vector Memory] Querying LLM for consolidation analysis...')
      const providerInstance = await providersStore.getProviderInstance(providerId)
      const headers = (providersStore.getProviderConfig(providerId)?.headers || {}) as Record<string, string>

      const response = await llmStore.generate(modelId, providerInstance as any, [
        { role: 'user', content: prompt },
      ], {
        headers,
        requestOverrides: { response_format: { type: 'json_object' } },
      })

      const textRes = response.text?.trim() || '{}'
      const parsed = JSON.parse(textRes)

      if (parsed.isMemorable && parsed.summary) {
        // Auto-trigger: Spikes filter (high salience or strong emotion)
        if (settingsChat.autoTriggerSpikes && parsed.salience < 0.7 && parsed.emotion === 'neutral') {
          console.log('[Vector Memory] Skipping consolidation: Spikes trigger enabled but no high salience (>= 0.7) or strong emotion (non-neutral) detected.')
          isConsolidating.value = false
          return
        }

        console.log('[Vector Memory] Consolidation triggered memorable event:', parsed.summary)

        await loadMemories()

        // Generate vector embedding of the narrative summary
        const embedding = await getEmbedding(parsed.summary)

        // Deduplication by similarity
        const duplicateThreshold = 0.85
        let isDuplicate = false
        for (const existing of memories.value) {
          const sim = cosineSimilarity(embedding, existing.embedding)
          if (sim > duplicateThreshold) {
            console.log(`[Vector Memory] Consolidation skipped: similar memory already exists (similarity: ${sim.toFixed(2)}, existing: "${existing.text}")`)
            isDuplicate = true
            break
          }
        }

        if (isDuplicate) {
          isConsolidating.value = false
          return
        }

        const newMemory: EpisodicMemory = {
          id: nanoid(),
          userId: 'local',
          sessionId,
          text: parsed.summary,
          rawDialogue: messages.slice(-10).map(m => `${m.role}: ${m.content}`),
          imageRefs: visionStore.lastCaptureDataUrl ? [visionStore.lastCaptureDataUrl] : [],
          audioRefs: [],
          embedding,
          tags: parsed.tags || ['consolidation'],
          topic: parsed.topic || 'chat',
          emotion: parsed.emotion || 'neutral',
          salience: parsed.salience ?? 0.5,
          timestamp: Date.now(),
          platform: 'desktop',
          appContext: activeApp !== 'N/A' ? `${activeApp}:${activeTitle}` : undefined,
          recallCount: 0,
          lastRecalledAt: Date.now(),
          linkedMemoryIds: [],
        }

        memories.value.unshift(newMemory)
        await saveMemories()

        // Update consolidation meta only after successful creation
        sessionConsolidationMeta.value[sessionId] = {
          lastCount: messages.length,
          lastTime: Date.now(),
        }

        console.log('[Vector Memory] Episodic consolidated memory successfully saved.')
      }
      else {
        console.log('[Vector Memory] Conversation not deemed memorable. Skipping consolidation.')
      }
    }
    catch (e) {
      console.error('[Vector Memory] Consolidation failed:', e)
    }
    finally {
      isConsolidating.value = false
    }
  }

  // Daily Memory Decay Job
  async function runDecayJob() {
    await loadMemories()
    const now = Date.now()
    const DAY_MS = 24 * 60 * 60 * 1000

    console.log('[Vector Memory] Running natural memory decay schedules...')
    const beforeCount = memories.value.length

    // Filter out low-salience memories older than 30 days that have never been recalled
    memories.value = memories.value.filter((m) => {
      const daysOld = (now - m.timestamp) / DAY_MS
      if (daysOld > settingsChat.memoryRetentionDays && m.recallCount === 0 && m.salience < settingsChat.memoryMinSalience) {
        console.log(`[Vector Memory] Decay: Removing weak memory: "${m.text}"`)
        return false
      }
      return true
    })

    const afterCount = memories.value.length
    if (beforeCount !== afterCount) {
      await saveMemories()
      console.log(`[Vector Memory] Decay complete. Cleaned up ${beforeCount - afterCount} weak memories.`)
    }
    else {
      console.log('[Vector Memory] Decay check complete. No memories required cleaning.')
    }
  }

  // BroadcastChannel for cross-window synchronization
  let channel: BroadcastChannel | null = null
  if (typeof window !== 'undefined') {
    channel = new BroadcastChannel('airi-vector-memory-sync')
    channel.onmessage = async (event) => {
      if (event.data === 'clear') {
        console.log('[Vector Memory] Received clear broadcast. Clearing in-memory state.')
        memories.value = []
      }
      else if (event.data === 'update') {
        console.log('[Vector Memory] Received update broadcast. Reloading memories.')
        await loadMemories()
      }
    }
  }

  function broadcast(msg: 'clear' | 'update') {
    if (channel) {
      try {
        channel.postMessage(msg)
      }
      catch (e) {
        console.warn('[Vector Memory] Failed to broadcast message:', e)
      }
    }
  }

  // Clear all database memories
  async function clearDatabase() {
    memories.value = []
    await storage.removeItem('local:vector-memories')
    broadcast('clear')
    console.log('[Vector Memory] Database cleared.')
  }

  // Scheduler for automatic memory decay (every 24 hours)
  let decayInterval: any = null
  function setupDecayScheduler() {
    if (typeof window === 'undefined')
      return

    const DECAY_COOLDOWN_MS = 24 * 60 * 60 * 1000 // 24 hours

    const runDecayIfNeeded = async () => {
      const lastRunStr = localStorage.getItem('settings/vector-memory/last-decay-at')
      const lastRun = lastRunStr ? Number.parseInt(lastRunStr, 10) : 0
      const now = Date.now()

      if (now - lastRun >= DECAY_COOLDOWN_MS) {
        await runDecayJob()
        localStorage.setItem('settings/vector-memory/last-decay-at', now.toString())
      }
    }

    // Run immediately on startup (throttled by localStorage)
    void runDecayIfNeeded()

    // Check every hour
    decayInterval = setInterval(runDecayIfNeeded, 60 * 60 * 1000)
  }

  onUnmounted(() => {
    if (decayInterval) {
      clearInterval(decayInterval)
      decayInterval = null
    }
    if (channel) {
      channel.close()
      channel = null
    }
  })

  // Load on init
  loadMemories()
  setupDecayScheduler()

  return {
    memories,
    isConsolidating,
    sessionConsolidationMeta,
    loadMemories,
    saveMemories,
    getEmbedding,
    searchMemories,
    addManualMemory,
    consolidateConversation,
    runDecayJob,
    clearDatabase,
  }
})
