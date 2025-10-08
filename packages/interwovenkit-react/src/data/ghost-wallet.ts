import { atom, useAtomValue, useSetAtom } from "jotai"

interface GhostWalletRequestHandler {
  resolve: () => void
  reject: (error: Error) => void
}

// Internal atom - not exported from public API
const ghostWalletRequestHandlerAtom = atom<GhostWalletRequestHandler | null>(null)

export function useGhostWalletRequestHandler() {
  return useAtomValue(ghostWalletRequestHandlerAtom)
}

export function useSetGhostWalletRequestHandler() {
  return useSetAtom(ghostWalletRequestHandlerAtom)
}
