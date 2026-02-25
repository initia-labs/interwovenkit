import type { FormValues } from "./form"
import type { RouterRouteResponseJson } from "./simulate"

interface BridgePreviewStateInput<TState extends object> {
  currentState: TState
  route: RouterRouteResponseJson
  values: FormValues
  quoteVerifiedAt: number
}

interface BridgePreviewLocationStateInput<TState extends object>
  extends BridgePreviewStateInput<TState> {
  requiresReconfirm: boolean
}

function buildBridgePreviewLocationState<TState extends object>({
  currentState,
  route,
  values,
  quoteVerifiedAt,
  requiresReconfirm,
}: BridgePreviewLocationStateInput<TState>) {
  return {
    ...currentState,
    route,
    values,
    quoteVerifiedAt,
    requiresReconfirm,
  }
}

export function buildRouteRefreshLocationState<TState extends object>({
  currentState,
  route,
  values,
  quoteVerifiedAt,
}: BridgePreviewStateInput<TState>) {
  return buildBridgePreviewLocationState({
    currentState,
    route,
    values,
    quoteVerifiedAt,
    requiresReconfirm: true,
  })
}

export function buildReconfirmLocationState<TState extends object>({
  currentState,
  route,
  values,
  quoteVerifiedAt,
}: BridgePreviewStateInput<TState>) {
  return buildBridgePreviewLocationState({
    currentState,
    route,
    values,
    quoteVerifiedAt,
    requiresReconfirm: false,
  })
}
