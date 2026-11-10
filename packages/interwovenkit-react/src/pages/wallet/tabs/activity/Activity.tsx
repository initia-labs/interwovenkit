import { useMemo } from "react"
import { useAtom } from "jotai"
import FormHelp from "@/components/form/FormHelp"
import Status from "@/components/Status"
import { type NormalizedChain, useLayer1 } from "@/data/chains"
import ChainSelect from "../../components/ChainSelect"
import HomeContainer from "../../components/HomeContainer"
import { activityChainAtom } from "../state"
import ActivityList from "./ActivityList"
import { useAllActivities } from "./queries"

function formatUnavailable(chains: NormalizedChain[]) {
  if (chains.length > 3) return "Some history is temporarily unavailable"
  const names = new Intl.ListFormat("en").format(chains.map((chain) => chain.name))
  return `${names} history is temporarily unavailable`
}

const Activity = () => {
  const { activities, isLoading, unavailableChains } = useAllActivities()
  const [selectedChain, setSelectedChain] = useAtom(activityChainAtom)
  const layer1 = useLayer1()

  // Get chains that have activities
  const relevantChainIds = useMemo(() => {
    return Array.from(new Set(activities.map((activity) => activity.chain.chainId)))
  }, [activities])

  // Filter activities by selected chain
  const filteredActivities = useMemo(() => {
    if (!selectedChain) return activities
    return activities.filter((activity) => activity.chain.chainId === selectedChain)
  }, [activities, selectedChain])

  if (isLoading && activities.length === 0) {
    return <Status>Loading activities...</Status>
  }

  if (!activities.length && unavailableChains.length) {
    return <Status>History temporarily unavailable</Status>
  }

  if (!activities.length && !isLoading) {
    // The indexer can lag on-chain state by a few seconds, and users land here
    // right after a deposit completes ("Go to history"). The list polls while
    // mounted, so the record surfaces in place — the empty state must not
    // read as final in the meantime.
    return <Status>No activity yet. Recent transactions may take a moment to appear.</Status>
  }

  return (
    <HomeContainer.Root>
      <HomeContainer.Controls>
        <ChainSelect
          value={selectedChain}
          onChange={setSelectedChain}
          chainIds={relevantChainIds}
          fullWidth
        />
      </HomeContainer.Controls>

      {unavailableChains.length > 0 && (
        <FormHelp level="info">{formatUnavailable(unavailableChains)}</FormHelp>
      )}

      <ActivityList list={filteredActivities} chainId={selectedChain || layer1.chainId} />
    </HomeContainer.Root>
  )
}

export default Activity
