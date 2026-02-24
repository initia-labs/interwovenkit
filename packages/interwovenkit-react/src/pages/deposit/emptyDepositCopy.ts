export interface EmptyDepositCopy {
  title: string
  description: string
}

interface EmptyDepositCopyParams {
  localSymbol: string
  externalSourceSymbol: string
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
  externalSourceSymbol: string,
): string[] {
  const uniqueSymbols = [...new Set(symbols)]
  const ordered: string[] = []
  const prioritySymbols = [externalSourceSymbol, localSymbol]

  for (const symbol of prioritySymbols) {
    if (uniqueSymbols.includes(symbol) && !ordered.includes(symbol)) {
      ordered.push(symbol)
    }
  }

  const remaining = uniqueSymbols
    .filter((symbol) => !ordered.includes(symbol))
    .toSorted((a, b) => a.localeCompare(b))

  return [...ordered, ...remaining]
}

function getAppchainClause(
  appchainSourceSymbols: string[],
  localSymbol: string,
  externalSourceSymbol: string,
): string {
  if (!appchainSourceSymbols.length) return ""

  const orderedAppchainSourceSymbols = getOrderedAppchainSourceSymbols(
    appchainSourceSymbols,
    localSymbol,
    externalSourceSymbol,
  )
  const hasSingleLocalAppchainSource =
    orderedAppchainSourceSymbols.length === 1 && orderedAppchainSourceSymbols[0] === localSymbol

  if (hasSingleLocalAppchainSource) return "from any appchain"

  const appchainSources = formatList(orderedAppchainSourceSymbols)
  return `using ${appchainSources} from any appchain`
}

export function getEmptyDepositCopy({
  localSymbol,
  externalSourceSymbol,
  externalChainNames,
  appchainSourceSymbols,
}: EmptyDepositCopyParams): EmptyDepositCopy {
  const title = `No ${localSymbol} available to deposit.`
  const hasExternalSupport = externalChainNames.length > 0
  const chains = formatList(externalChainNames)
  const appchainClause = getAppchainClause(appchainSourceSymbols, localSymbol, externalSourceSymbol)
  const hasAppchainSupport = !!appchainClause
  const usesDifferentExternalSource = externalSourceSymbol !== localSymbol

  if (hasExternalSupport && hasAppchainSupport) {
    const externalClause = usesDifferentExternalSource
      ? `using ${externalSourceSymbol} from ${chains}`
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
        description: `You can deposit ${localSymbol} using ${externalSourceSymbol} from ${chains}.`,
      }
    }
    return { title, description: `You can deposit ${localSymbol} from ${chains}.` }
  }

  if (hasAppchainSupport) {
    return { title, description: `You can deposit ${localSymbol} ${appchainClause}.` }
  }

  return { title, description: "No deposit sources are currently available." }
}
