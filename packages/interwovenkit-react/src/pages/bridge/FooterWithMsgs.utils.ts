export function getFooterWithMsgsStatus<T>({
  error,
  loading,
  value,
}: {
  error: Error | null
  loading: boolean
  value: T | undefined
}) {
  const hasValue = value !== undefined

  return {
    canRenderChildren: hasValue,
    isFetchingMessages: loading || (!!error && hasValue),
    shouldRenderError: !!error && !hasValue,
    shouldRenderLoading: !hasValue,
  }
}
