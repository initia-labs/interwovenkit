export interface EmptyDepositCopy {
  title: string
  description: string
}

interface EmptyDepositCopyParams {
  localSymbol: string
  externalSourceSymbols: string[]
  externalChainNames: string[]
  appchainSourceSymbols: string[]
}

function formatList(items: string[]): string {
  if (items.length === 0) return ""
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} or ${items[1]}`
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`
}

function getOrderedAppchainSourceSymbols(
  symbols: string[],
  localSymbol: string,
  externalSourceSymbols: string[],
): string[] {
  const uniqueSymbols = [...new Set(symbols)]
  const ordered: string[] = []
  const prioritySymbols = [...externalSourceSymbols, localSymbol]

  for (const symbol of prioritySymbols) {
    if (uniqueSymbols.includes(symbol) && !ordered.includes(symbol)) {
      ordered.push(symbol)
    }
  }

  const remaining = uniqueSymbols
    .filter((symbol) => !ordered.includes(symbol))
    .sort((a, b) => a.localeCompare(b))

  return [...ordered, ...remaining]
}

function getAppchainClause(
  appchainSourceSymbols: string[],
  localSymbol: string,
  externalSourceSymbols: string[],
): string {
  if (!appchainSourceSymbols.length) return ""

  const orderedAppchainSourceSymbols = getOrderedAppchainSourceSymbols(
    appchainSourceSymbols,
    localSymbol,
    externalSourceSymbols,
  )
  const hasSingleLocalAppchainSource =
    orderedAppchainSourceSymbols.length === 1 && orderedAppchainSourceSymbols[0] === localSymbol

  if (hasSingleLocalAppchainSource) return "from any app"

  const appchainSources = formatList(orderedAppchainSourceSymbols)
  return `using ${appchainSources} from any app`
}

export function getEmptyDepositCopy({
  localSymbol,
  externalSourceSymbols,
  externalChainNames,
  appchainSourceSymbols,
}: EmptyDepositCopyParams): EmptyDepositCopy {
  const title = `No ${localSymbol} available to deposit.`
  const hasExternalSupport = externalChainNames.length > 0
  const chains = formatList(externalChainNames)
  const orderedExternalSourceSymbols = [...new Set(externalSourceSymbols)]
  const externalSources = formatList(orderedExternalSourceSymbols)
  const appchainClause = getAppchainClause(
    appchainSourceSymbols,
    localSymbol,
    orderedExternalSourceSymbols,
  )
  const hasAppchainSupport = !!appchainClause
  const usesDifferentExternalSource =
    orderedExternalSourceSymbols.length !== 1 || orderedExternalSourceSymbols[0] !== localSymbol

  if (hasExternalSupport && hasAppchainSupport) {
    const externalClause = usesDifferentExternalSource
      ? `using ${externalSources} from ${chains}`
      : `from ${chains}`

    return {
      title,
      description: `You can deposit ${localSymbol} ${externalClause}, or ${appchainClause}.`,
    }
  }

  if (hasExternalSupport) {
    if (usesDifferentExternalSource) {
      return {
        title,
        description: `You can deposit ${localSymbol} using ${externalSources} from ${chains}.`,
      }
    }
    return { title, description: `You can deposit ${localSymbol} from ${chains}.` }
  }

  if (hasAppchainSupport) {
    return { title, description: `You can deposit ${localSymbol} ${appchainClause}.` }
  }

  return { title, description: "No deposit sources are currently available." }
}
