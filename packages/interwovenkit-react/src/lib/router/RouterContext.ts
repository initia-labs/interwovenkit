import { createContext, useContext } from "react"

export interface HistoryEntry {
  path: string
  state?: object
}

interface RouterContextProps {
  location: HistoryEntry
  history: HistoryEntry[]
  navigate: (to: string | number, state?: object) => void
  reset: (to: string, state?: object) => void
}

export const RouterContext = createContext<RouterContextProps>(null!)

export function useRouterContext() {
  return useContext(RouterContext)
}

export function useLocation() {
  const { location } = useRouterContext()
  return location
}

export function usePath() {
  const { path } = useLocation()
  return path
}

export function useLocationState<T extends object>() {
  const { state = {} } = useLocation()
  return state as T
}

export function useHistory() {
  const { history } = useRouterContext()
  return history
}

export function useNavigate() {
  const { navigate } = useRouterContext()
  return navigate
}

export function useReset() {
  const { reset } = useRouterContext()
  return reset
}
