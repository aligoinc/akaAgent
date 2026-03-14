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
      const blocks = allFlows.filter(f => f.isBlock)
      set({ blocks, isLoading: false })
    } catch (err) {
      console.error('Failed to load blocks:', err)
      set({ isLoading: false })
    }
  }
}))
