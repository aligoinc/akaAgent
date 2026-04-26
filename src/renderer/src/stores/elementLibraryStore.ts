import { create } from 'zustand'
import { ElementDef } from '../../../shared/v2Types'

interface ElementLibraryState {
  elements: ElementDef[]
  loading: boolean
  loadElements: () => Promise<void>
  upsertElement: (el: ElementDef) => void
  removeElement: (id: number) => void
}

export const useElementLibraryStore = create<ElementLibraryState>((set) => ({
  elements: [],
  loading: false,
  async loadElements() {
    set({ loading: true })
    try {
      const elements = await window.electronAPI.v2.listElements()
      set({ elements, loading: false })
    } catch (err) {
      console.error('loadElements error:', err)
      set({ loading: false })
    }
  },
  upsertElement(el) {
    set(state => {
      const idx = state.elements.findIndex(e => e.id === el.id)
      if (idx >= 0) {
        const next = [...state.elements]
        next[idx] = el
        return { elements: next }
      }
      return { elements: [...state.elements, el] }
    })
  },
  removeElement(id) {
    set(state => ({ elements: state.elements.filter(e => e.id !== id) }))
  }
}))
