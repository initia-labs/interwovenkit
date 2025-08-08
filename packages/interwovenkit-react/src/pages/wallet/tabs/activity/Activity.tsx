import { useState, useMemo } from "react"
import { useLayer1 } from "@/data/chains"
import Status from "@/components/Status"
import ChainSelect from "@/components/ChainSelect"
import HomeContainer from "../../components/HomeContainer"
import { useAllActivities } from "./queries"
import ActivityList from "./ActivityList"

const Activity = () => {
  const { activities, isLoading } = useAllActivities()
  const [selectedChain, setSelectedChain] = useState("")
  const layer1 = useLayer1()

  // Get chains that have activities
  const relevantChainIds = useMemo(() => {
    const chainIds = new Set(activities.map((activity) => activity.chain.chainId))
    return Array.from(chainIds)
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
