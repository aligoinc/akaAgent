import { create } from 'zustand'
import { BlockDef } from '../../../shared/v2Types'

interface BlockLibraryState {
  blocks: BlockDef[]
  loading: boolean
  loadBlocks: () => Promise<void>
  upsertBlock: (block: BlockDef) => void
  removeBlock: (id: number) => void
  getByName: (name: string) => BlockDef | undefined
  getById: (id: number) => BlockDef | undefined
}

export const useBlockLibraryStore = create<BlockLibraryState>((set, get) => ({
  blocks: [],
  loading: false,
  async loadBlocks() {
    set({ loading: true })
    try {
      const blocks = await window.electronAPI.v2.listBlocks()
      set({ blocks, loading: false })
    } catch (err) {
      console.error('loadBlocks error:', err)
      set({ loading: false })
    }
  },
  upsertBlock(block) {
    set(state => {
      const idx = state.blocks.findIndex(b => b.id === block.id)
      if (idx >= 0) {
        const next = [...state.blocks]
        next[idx] = block
        return { blocks: next }
      }
      return { blocks: [...state.blocks, block] }
    })
  },
  removeBlock(id) {
    set(state => ({ blocks: state.blocks.filter(b => b.id !== id) }))
  },
  getByName(name) {
    return get().blocks.find(b => b.name === name)
  },
  getById(id) {
    return get().blocks.find(b => b.id === id)
  }
}))
