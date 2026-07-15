import { useMemo } from "react"
import { useAtom } from "jotai"
import Status from "@/components/Status"
import { useLayer1 } from "@/data/chains"
import ChainSelect from "../../components/ChainSelect"
import HomeContainer from "../../components/HomeContainer"
import { activityChainAtom } from "../state"
import ActivityList from "./ActivityList"
import { useAllActivities } from "./queries"

const Activity = () => {
  const { activities, isLoading } = useAllActivities()
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

      <ActivityList list={filteredActivities} chainId={selectedChain || layer1.chainId} />
    </HomeContainer.Root>
  )
}

export default Activity
