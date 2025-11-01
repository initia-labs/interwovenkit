import { atom, useAtomValue, useSetAtom } from "jotai"

interface AutoSignRequestHandler {
  resolve: () => void
  reject: (error: Error) => void
}

// Internal atom - not exported from public API
const autoSignRequestHandlerAtom = atom<AutoSignRequestHandler | null>(null)

export function useAutoSignRequestHandler() {
  return useAtomValue(autoSignRequestHandlerAtom)
}

export function useSetAutoSignRequestHandler() {
  return useSetAtom(autoSignRequestHandlerAtom)
}
