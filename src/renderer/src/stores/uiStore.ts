import { create } from 'zustand'

export type AlertType = 'success' | 'error' | 'info'
export type ConfirmVariant = 'danger' | 'primary'

export interface AlertAction {
  label: string
  onClick: () => void | Promise<void>
}

export interface AlertOptions {
  action?: AlertAction | null
}

export interface ConfirmOptions {
  title?: string
  confirmText?: string
  cancelText?: string
  variant?: ConfirmVariant
}

interface UiState {
  alert: {
    isOpen: boolean
    type: AlertType
    message: string
    action?: AlertAction | null
  }
  showAlert: (message: string, type?: AlertType, options?: AlertOptions) => void
  closeAlert: () => void

  confirm: {
    isOpen: boolean
    message: string
    title: string
    confirmText: string
    cancelText: string
    variant: ConfirmVariant
    onConfirm: (() => void | Promise<void>) | null
  }
  showConfirm: (message: string, onConfirm: () => void | Promise<void>, options?: ConfirmOptions) => void
  closeConfirm: () => void
}

export const useUiStore = create<UiState>((set) => ({
  alert: { isOpen: false, type: 'info', message: '', action: null },
  showAlert: (message, type = 'info', options) => set({ alert: { isOpen: true, type, message, action: options?.action ?? null } }),
  closeAlert: () => set((state) => ({ alert: { ...state.alert, isOpen: false, action: null } })),

  confirm: {
    isOpen: false,
    message: '',
    title: 'Xác nhận',
    confirmText: 'Đồng ý',
    cancelText: 'Huỷ',
    variant: 'danger',
    onConfirm: null
  },
  showConfirm: (message, onConfirm, options) =>
    set({
      confirm: {
        isOpen: true,
        message,
        title: options?.title ?? 'Xác nhận',
        confirmText: options?.confirmText ?? 'Đồng ý',
        cancelText: options?.cancelText ?? 'Huỷ',
        variant: options?.variant ?? 'danger',
        onConfirm
      }
    }),
  closeConfirm: () => set((state) => ({ confirm: { ...state.confirm, isOpen: false, onConfirm: null } }))
}))
