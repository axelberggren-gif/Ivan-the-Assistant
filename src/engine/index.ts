import type { EngineAPI } from '../types'

// Stub — replaced by the Stockfish WASM worker wrapper.
export function createEngine(): EngineAPI {
  throw new Error('engine not implemented yet')
}
