import { useMemo } from "react"
import { useAtom } from "jotai"
import { useLayer1 } from "@/data/chains"
import Status from "@/components/Status"
import HomeContainer from "../../components/HomeContainer"
import ChainSelect from "../../components/ChainSelect"
import { activityChainAtom } from "../state"
import { useAllActivities } from "./queries"
import ActivityList from "./ActivityList"

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
    return <Status>No activity yet</Status>
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
