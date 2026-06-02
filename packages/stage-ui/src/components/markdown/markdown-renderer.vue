<script setup lang="ts">
import DOMPurify from 'dompurify'

import { healMozibake } from '@proj-airi/stage-shared'
import { onMounted, ref, watch, watchPostEffect } from 'vue'

import { useMarkdown } from '../../composables/markdown'

interface Props {
  content: string
  class?: string
  activeText?: string
  activeColor?: string
}

const props = defineProps<Props>()

const processedContent = ref('')
const containerRef = ref<HTMLElement | null>(null)
const { process, processSync } = useMarkdown()

function formatActorName(id: string): string {
  const name = id.replace(/^(actress_|actor_)/i, '')
  const customNames: Record<string, string> = {
    cg1: 'Nia',
    cg2: 'Vara',
    juewa: 'Juewa',
    rumi: 'Rumi',
  }
  const lower = name.toLowerCase()
  if (customNames[lower])
    return customNames[lower]

  return name
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function postProcessActorColors(html: string): string {
  if (!html.includes('[ACTOR:'))
    return html

  // Match standard paragraph <p>...</p> or list item <li>...</li> blocks
  const blockRegex = /(<p>|<li>)([\s\S]*?)(<\/p>|<\/li>)/gi
  let activeActorId: string | null = null

  const result = html.replace(blockRegex, (match, openTag, innerContent, closeTag) => {
    // Check if this block contains an actor marker: [ACTOR:xxx]
    const markerRegex = /\[ACTOR:\s*([\w-]+)\s*\]/i
    const markerMatch = markerRegex.exec(innerContent)

    let isNewMarker = false
    if (markerMatch) {
      activeActorId = markerMatch[1].trim()
      // Strip the marker from the block content
      innerContent = innerContent.replace(markerRegex, '')
      isNewMarker = true
    }

    if (activeActorId) {
      // If this was a new marker block, prepend the polished pill badge!
      let chipHtml = ''
      if (isNewMarker) {
        const displayName = formatActorName(activeActorId)
        chipHtml = `<span class="actor-chip actor-chip-${activeActorId}">${displayName}</span>`
      }
      // Wrap only the inner content of this block in our inline styled class
      return `${openTag}${chipHtml}<span class="actor-color-${activeActorId}">${innerContent}</span>${closeTag}`
    }

    return match
  })

  return result
}

async function processContent() {
  if (!props.content) {
    processedContent.value = ''
    return
  }

  // const sample = props.content.slice(0, 10).split('').map(c => `${c} (0x${c.charCodeAt(0).toString(16)})`).join(', ')
  // console.debug(`[MarkdownRenderer] Healing input (sample: ${sample})...`)

  let healed = healMozibake(props.content)

  // FAILSAFE: Level 2 Literal Mappings directly in component to bypass potential shared-package cache stale
  const commonScrambles: Record<string, string> = {
    'Ê·': 'ʷ',
    'â—´': '◴',
    'â—•': '•',
    'á´¥': 'ᴥ',
    'â‰§': '≧',
    'ï¿£': '￣',
    'ãƒ˜': 'ヘ',
    'â¬½': '⬽',
    'Â¬': '¬',
    'â–½': '▽',
    'Ê•': 'ʕ',
    'Ê"': 'ʔ',
    'â‰¦': '≦',
  }

  for (const [key, val] of Object.entries(commonScrambles)) {
    healed = healed.replaceAll(key, val)
  }

  if (healed !== props.content) {
    // console.debug('[MarkdownRenderer] Scrambled Unicode healed successfully.')
  }
  else {
    // If it's still scrambled but healing failed, log the actual codes
    // console.debug('[MarkdownRenderer] No changes made by healer.')
  }

  try {
    const rawCompiled = await process(healed)
    processedContent.value = postProcessActorColors(DOMPurify.sanitize(rawCompiled))
  }
  catch (error) {
    console.warn('Failed to process markdown with syntax highlighting, using fallback:', error)
    processedContent.value = postProcessActorColors(DOMPurify.sanitize(processSync(healed)))
  }
}

function handleLinkClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const anchor = target.closest('a')
  if (!anchor)
    return

  const href = anchor.getAttribute('href')
  if (href && (href.startsWith('http') || href.startsWith('mailto:'))) {
    e.preventDefault()
    if (window.confirm(`Open external resource?\n\nThis will take you to:\n${href}`)) {
      window.open(href, '_blank')
    }
  }
}

function applyHighlight(el: HTMLElement, activeText: string, actorColor?: string) {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) {
    // Fallback if the CSS Highlights API is not supported in the runtime env
    return
  }

  const highlightsRegistry = (CSS as any).highlights

  // Clear previous highlights
  if (highlightsRegistry) {
    highlightsRegistry.delete('spoken-highlight')
  }

  if (actorColor && containerRef.value) {
    containerRef.value.style.setProperty('--active-highlight-color', actorColor)
  }
  else if (containerRef.value) {
    containerRef.value.style.removeProperty('--active-highlight-color')
  }

  if (!activeText || !activeText.trim())
    return

  const searchText = activeText.trim().replace(/\s+/g, ' ').toLowerCase()
  if (!searchText)
    return

  const textNodes: Text[] = []
  let accumulatedText = ''
  const offsets: { node: Text, start: number, end: number }[] = []

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue || ''
      const start = accumulatedText.length
      accumulatedText += text
      const end = accumulatedText.length
      textNodes.push(node as Text)
      offsets.push({ node: node as Text, start, end })
    }
    else if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = (node as Element).tagName.toLowerCase()
      if (tagName !== 'script' && tagName !== 'style') {
        for (let child = node.firstChild; child; child = child.nextSibling) {
          walk(child)
        }
      }
    }
  }

  walk(el)

  const normalizedAccumulated = accumulatedText.toLowerCase()
  let matchIndex = normalizedAccumulated.indexOf(searchText)
  let matchedLength = searchText.length

  if (matchIndex === -1) {
    const cleanStr = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase()
    const cleanSearch = cleanStr(searchText)
    if (cleanSearch) {
      let cleanAccumulated = ''
      const cleanToOrigMap: number[] = []
      for (let i = 0; i < accumulatedText.length; i++) {
        const char = accumulatedText[i]
        if (/[a-z0-9]/i.test(char)) {
          cleanAccumulated += char.toLowerCase()
          cleanToOrigMap.push(i)
        }
      }

      const cleanMatchIndex = cleanAccumulated.indexOf(cleanSearch)
      if (cleanMatchIndex !== -1) {
        matchIndex = cleanToOrigMap[cleanMatchIndex]
        const cleanMatchEndIndex = cleanMatchIndex + cleanSearch.length - 1
        const matchEndIndex = cleanToOrigMap[cleanMatchEndIndex] + 1
        matchedLength = matchEndIndex - matchIndex
      }
    }
  }

  if (matchIndex === -1)
    return

  const matchEndIndex = matchIndex + matchedLength

  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0

  for (const offset of offsets) {
    if (matchIndex >= offset.start && matchIndex < offset.end) {
      startNode = offset.node
      startOffset = matchIndex - offset.start
    }
    if (matchEndIndex > offset.start && matchEndIndex <= offset.end) {
      endNode = offset.node
      endOffset = matchEndIndex - offset.start
    }
  }

  if (!startNode || !endNode)
    return

  try {
    const range = document.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)

    const highlight = new (window as any).Highlight(range)
    if (highlightsRegistry) {
      highlightsRegistry.set('spoken-highlight', highlight)
    }
  }
  catch (error) {
    console.error('[MarkdownRenderer] Highlight registration failed:', error)
  }
}

// Re-entrancy guard: prevents a new highlight from starting while one is still executing
let isHighlighting = false
// rAF handle: ensures at most one DOM mutation is queued per animation frame
let pendingHighlightFrame: ReturnType<typeof requestAnimationFrame> | null = null

function scheduleHighlight() {
  // If a frame is already queued, drop this call — the queued one will handle it
  if (pendingHighlightFrame !== null)
    return
  pendingHighlightFrame = requestAnimationFrame(() => {
    pendingHighlightFrame = null
    // If a previous invocation is still executing, drop this one
    if (isHighlighting)
      return
    isHighlighting = true
    try {
      if (containerRef.value) {
        applyHighlight(containerRef.value, props.activeText || '', props.activeColor)
      }
    }
    finally {
      isHighlighting = false
    }
  })
}

// Process content when it changes
watch(() => props.content, processContent, { immediate: true })

// FIX: Only watch activeText/activeColor — NOT processedContent.
// During streaming, processedContent fires on every token. Including it in this watcher
// means Vue's vdom patching and our raw DOM Range surgery fight over the same subtree
// dozens of times per second, creating an infinite mutation loop → OOM → kernel panic.
// Vue's vdom diff will naturally destroy stale highlight spans when content re-renders;
// the next activeText change re-applies them cleanly via scheduleHighlight.
watchPostEffect(() => {
  // Track reactive dependencies (activeText + activeColor) so Vue re-runs this
  // after the DOM has been patched — eliminating the nextTick race condition.
  void props.activeText
  void props.activeColor
  scheduleHighlight()
})

onMounted(() => {
  processContent()
})
</script>

<template>
  <div
    ref="containerRef"
    :class="props.class"
    class="markdown-content"
    @click="handleLinkClick"
    v-html="processedContent"
  />
</template>

<style scoped>
.markdown-content :deep(h1) {
  font-size: 2.5rem;
  font-weight: 900;
  margin-bottom: 1.5rem;
  background: linear-gradient(to right, #38bdf8, #a78bfa, #64748b);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: -0.025em;
}

.dark .markdown-content :deep(h1) {
  background: linear-gradient(to right, #38bdf8, #a78bfa, #ffffff);
  -webkit-background-clip: text;
}

.markdown-content :deep(h2) {
  font-size: 1.75rem;
  font-weight: 800;
  margin-top: 2rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  padding-bottom: 0.5rem;
  color: rgba(0, 0, 0, 0.85);
}

.dark .markdown-content :deep(h2) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.9);
}

.markdown-content :deep(h3) {
  font-size: 1.25rem;
  font-weight: 700;
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
  color: rgba(0, 0, 0, 0.8);
}

.dark .markdown-content :deep(h3) {
  color: rgba(255, 255, 255, 0.85);
}

.markdown-content :deep(p) {
  margin-bottom: 1.25rem;
  line-height: 1.75;
  color: inherit;
}

.markdown-content :deep(ul), .markdown-content :deep(ol) {
  margin-bottom: 1.25rem;
  padding-left: 1.5rem;
  color: inherit;
}

.markdown-content :deep(li) {
  margin-bottom: 0.5rem;
}

.markdown-content :deep(blockquote) {
  margin: 1.5rem 0;
  padding: 1rem 1.5rem;
  border-left: 4px solid #38bdf8;
  background: rgba(56, 189, 248, 0.05);
  border-radius: 4px 12px 12px 4px;
}

.markdown-content :deep(blockquote p) {
  margin-bottom: 0;
  color: rgba(0, 0, 0, 0.7);
  font-style: italic;
}

.dark .markdown-content :deep(blockquote p) {
  color: rgba(255, 255, 255, 0.8);
}

.markdown-content :deep(pre), .markdown-content :deep(.shiki) {
  background: rgba(0, 0, 0, 0.05) !important;
  border: 1px solid rgba(0, 0, 0, 0.05);
  border-radius: 12px;
  padding: 1.25rem;
  margin: 1.5rem 0;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.05);
  color: inherit;
}

.dark .markdown-content :deep(pre), .dark .markdown-content :deep(.shiki) {
  background: rgba(0, 0, 0, 0.3) !important;
  border: 1px solid rgba(255, 255, 255, 0.05);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
}

.markdown-content :deep(.actor-chip) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border-radius: 4px;
  margin-right: 8px;
  vertical-align: middle;
  line-height: 1;
  user-select: none;
}

.markdown-content :deep(.active-spoken-line) {
  color: var(--active-color, #38bdf8) !important;
  font-weight: 700;
  text-shadow: 0 0 8px var(--active-color, rgba(56, 189, 248, 0.4));
  transition: all 0.25s ease-out;
}

::highlight(spoken-highlight) {
  color: var(--active-highlight-color, #38bdf8) !important;
  font-weight: 700;
  text-shadow: 0 0 8px var(--active-highlight-color, rgba(56, 189, 248, 0.4));
}
</style>
