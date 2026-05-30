export interface DirectorNote {
  id: string
  sessionId: string
  type: 'director-note'
  content: string
  intensity: number
  title?: string
  prompt?: string
  target?: 'user' | 'assistant'
  state: 'pending' | 'done'
  selected_concepts?: string[]
  scratchpad?: string
  createdAt: number
  isArchived?: boolean
}

export interface DirectorNotesIndex {
  notes: Record<string, DirectorNote[]> // Keyed by sessionId
}
