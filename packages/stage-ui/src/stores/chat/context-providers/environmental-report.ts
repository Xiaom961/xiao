import type { ContextMessage } from '../../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

import { useVisionStore } from '../../modules/vision'
import { useSettingsChat } from '../../settings/chat'

const ENV_REPORT_CONTEXT_ID = 'system:environmental-report'
const FRESHNESS_THRESHOLD_MS = 60000 // 60 seconds

export function createEnvironmentalReportContext(): ContextMessage | null {
  const settingsChat = useSettingsChat()
  if (!settingsChat.environmentalFusionEnabled) {
    return null
  }

  const visionStore = useVisionStore()
  const now = Date.now()

  const isVisualFresh = visionStore.lastVisualCaptureTime && (now - visionStore.lastVisualCaptureTime < FRESHNESS_THRESHOLD_MS)
  const isScrapeFresh = visionStore.lastScrapeResult?.scrapedAt && (now - visionStore.lastScrapeResult.scrapedAt < FRESHNESS_THRESHOLD_MS)

  if (!isVisualFresh && !isScrapeFresh) {
    return null
  }

  let text = 'GROUND TRUTH — Treat the following as authoritative.\n'
  text += 'This is the live capture of Xhar\'s screen right now. '
  text += 'If anything you said in previous turns described the screen differently, '
  text += 'the prior was wrong or stale — silently update your understanding to match this. '
  text += 'React in character (tease, joke, opine) but never contradict the data below.\n\n'

  if (isScrapeFresh && visionStore.lastScrapeResult) {
    const scrape = visionStore.lastScrapeResult
    if (scrape.appName)
      text += `- Active App: ${scrape.appName}\n`
    if (scrape.windowTitle)
      text += `- Active Window: ${scrape.windowTitle}\n`
    if (scrape.url)
      text += `- Active URL: ${scrape.url}\n`
  }

  if (isVisualFresh && visionStore.lastVisualAnalysis) {
    text += `- Screen Visual Content: "${visionStore.lastVisualAnalysis}"\n`
  }

  return {
    id: nanoid(),
    contextId: ENV_REPORT_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text,
    createdAt: now,
  }
}
