import { create } from 'zustand'
import { ExecutionRun, ExecutionStep } from '../../../shared/types'

interface ExecutionState {
  isRunning: boolean
  currentRun: ExecutionRun | null
  currentStep: ExecutionStep | null
  browserConnected: boolean

  // Actions
  setRunning: (running: boolean) => void
  setCurrentRun: (run: ExecutionRun | null) => void
  updateStep: (step: ExecutionStep) => void
  setBrowserConnected: (connected: boolean) => void
  reset: () => void
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  isRunning: false,
  currentRun: null,
  currentStep: null,
  browserConnected: false,

  setRunning: (running) => set({ isRunning: running }),
  setCurrentRun: (run) => set({ currentRun: run }),
  updateStep: (step) => set({ currentStep: step }),
  setBrowserConnected: (connected) => set({ browserConnected: connected }),
  reset: () => set({
    isRunning: false,
    currentRun: null,
    currentStep: null
  })
}))
