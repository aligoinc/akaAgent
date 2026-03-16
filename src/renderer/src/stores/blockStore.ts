import { create } from 'zustand'
import { FlowData } from '../../../shared/types'

interface BlockState {
  blocks: FlowData[]
  isLoading: boolean
  loadBlocks: () => Promise<void>
}

export const useBlockStore = create<BlockState>((set) => ({
  blocks: [],
  isLoading: false,
  loadBlocks: async () => {
    if (!window.electronAPI) return
    set({ isLoading: true })
    try {
      const allFlows = await window.electronAPI.listFlows()
      set({ blocks: allFlows, isLoading: false })
    } catch (err) {
      console.error('Failed to load flows:', err)
      set({ isLoading: false })
    }
  }
}))
