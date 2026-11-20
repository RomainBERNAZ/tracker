import { simulateBankroll } from './bankrollEvolution'
import type { BankrollSimulationRequest, BankrollSimulationResponse } from './bankrollEvolution'

self.onmessage = ({ data: { balance, scenario } }: MessageEvent<BankrollSimulationRequest>) => {
  let response: BankrollSimulationResponse
  try {
    response = { simulation: simulateBankroll(balance, scenario, scenario.seed) }
  } catch (cause) {
    response = { error: cause instanceof Error ? cause.message : String(cause) }
  }
  self.postMessage(response)
}
