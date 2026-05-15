export type ChatActionMenuAction = 'copy' | 'delete' | 'delete-following' | 'fork' | 'fork-switch' | 'edit' | 'retry'

export interface ChatActionMenuItem {
  action: ChatActionMenuAction
  label: string
  icon: string
  danger?: boolean
  divider?: boolean // Render divider after this item!
}

export function createChatActionMenuItems(options: {
  canCopy: boolean
  canDelete: boolean
  canFork?: boolean
  canEdit?: boolean
  canRetry?: boolean
}): ChatActionMenuItem[] {
  return [
    options.canCopy
      ? {
          action: 'copy',
          label: 'Copy',
          icon: 'i-solar:copy-bold',
        }
      : null,
    options.canEdit !== false
      ? {
          action: 'edit',
          label: 'Edit',
          icon: 'i-solar:pen-bold',
          divider: true, // Group 1 ends
        }
      : null,
    options.canFork !== false
      ? {
          action: 'fork',
          label: 'Fork to Background',
          icon: 'i-solar:layers-bold-duotone',
        }
      : null,
    options.canFork !== false
      ? {
          action: 'fork-switch',
          label: 'Fork & Switch',
          icon: 'i-solar:square-forward-bold',
        }
      : null,
    options.canRetry !== false
      ? {
          action: 'retry',
          label: 'Retry',
          icon: 'i-solar:restart-bold',
          divider: true, // Group 2 ends
        }
      : null,
    options.canDelete
      ? {
          action: 'delete',
          label: 'Delete Message',
          icon: 'i-solar:trash-bin-minimalistic-bold',
          danger: true,
        }
      : null,
    options.canDelete
      ? {
          action: 'delete-following',
          label: 'Delete From Here',
          icon: 'i-solar:scissors-bold',
          danger: true,
        }
      : null,
  ].filter(Boolean) as ChatActionMenuItem[]
}

export { default as ChatActionMenu } from './index.vue'
