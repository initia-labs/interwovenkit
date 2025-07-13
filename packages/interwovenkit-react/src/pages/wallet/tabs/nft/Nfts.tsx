import AsyncBoundary from "@/components/AsyncBoundary"
import ChainAccordion from "../../components/ChainAccordion"
import CollectionList from "./CollectionList"

const Nfts = () => {
  return (
    <ChainAccordion
      renderContent={(chain) => (
        <AsyncBoundary>
          <CollectionList chain={chain} />
        </AsyncBoundary>
      )}
      storageKey="nfts"
    />
  )
}

export default Nfts
