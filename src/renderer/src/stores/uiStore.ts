import { create } from 'zustand'

export type AlertType = 'success' | 'error' | 'info'

interface UiState {
  alert: {
    isOpen: boolean
    type: AlertType
    message: string
  }
  showAlert: (message: string, type?: AlertType) => void
  closeAlert: () => void
}

export const useUiStore = create<UiState>((set) => ({
  alert: { isOpen: false, type: 'info', message: '' },
  showAlert: (message, type = 'info') => set({ alert: { isOpen: true, type, message } }),
  closeAlert: () => set((state) => ({ alert: { ...state.alert, isOpen: false } }))
}))
