import { create } from 'zustand'
import { ElementDefinition } from '../../../shared/types'

interface ElementState {
  elements: ElementDefinition[]
  isLoading: boolean
  error: string | null
  
  // Actions
  loadElements: () => Promise<void>
  saveElement: (element: Omit<ElementDefinition, 'createdAt' | 'updatedAt'>) => Promise<void>
  deleteElement: (id: string) => Promise<void>
}

export const useElementStore = create<ElementState>((set, get) => ({
  elements: [],
  isLoading: false,
  error: null,

  loadElements: async () => {
    if (!window.electronAPI) return
    set({ isLoading: true, error: null })
    try {
      const data = await window.electronAPI.listElements()
      set({ elements: data, isLoading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load elements', isLoading: false })
    }
  },

  saveElement: async (element) => {
    if (!window.electronAPI) return
    set({ isLoading: true, error: null })
    try {
      const saved = await window.electronAPI.saveElement(element)
      // Update local state
      const current = get().elements
      const index = current.findIndex(e => e.id === saved.id)
      
      if (index >= 0) {
        const newElements = [...current]
        newElements[index] = saved
        set({ elements: newElements, isLoading: false })
      } else {
        set({ elements: [saved, ...current], isLoading: false })
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to save element', isLoading: false })
      throw err
    }
  },

  deleteElement: async (id) => {
    if (!window.electronAPI) return
    set({ isLoading: true, error: null })
    try {
      await window.electronAPI.deleteElement(id)
      set({ 
        elements: get().elements.filter(e => e.id !== id),
        isLoading: false 
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete element', isLoading: false })
      throw err
    }
  }
}))
