import type { FormValues } from "./form"
import type { RouterRouteResponseJson } from "./simulate"

interface BridgePreviewStateInput<TState extends object> {
  currentState: TState
  route: RouterRouteResponseJson
  values: FormValues
  quoteVerifiedAt: number
}

export function buildRouteRefreshLocationState<TState extends object>({
  currentState,
  route,
  values,
  quoteVerifiedAt,
}: BridgePreviewStateInput<TState>) {
  return {
    ...currentState,
    route,
    values,
    quoteVerifiedAt,
    requiresReconfirm: true,
  }
}

export function buildReconfirmLocationState<TState extends object>({
  currentState,
  route,
  values,
  quoteVerifiedAt,
}: BridgePreviewStateInput<TState>) {
  return {
    ...currentState,
    route,
    values,
    quoteVerifiedAt,
    requiresReconfirm: false,
  }
}
