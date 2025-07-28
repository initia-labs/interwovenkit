import clsx from "clsx"
import type { ReactNode } from "react"
import { IconChevronRight, IconCloseCircleFilled, IconEdit, IconWallet } from "@initia/icons-react"
import { truncate } from "@initia/utils"
import { AddressUtils } from "@/public/utils"
import Image from "@/components/Image"
import ModalTrigger from "@/components/ModalTrigger"
import Scrollable from "@/components/Scrollable"
import List from "@/components/List"
import RecipientInput from "@/components/form/RecipientInput"
import { useChainType, useSkipChain } from "./data/chains"
import { useGetDefaultAddress, useValidateAddress } from "./data/address"
import { useBridgeForm } from "./data/form"
import { useCosmosWallets } from "./data/cosmos"
import styles from "./BridgeAccount.module.css"

interface Props {
  type?: "src" | "dst"
}

const BridgeAccount = ({ type }: Props) => {
  const { watch, setValue } = useBridgeForm()
  const { srcChainId, dstChainId, cosmosWalletName } = watch()
  const addressKey = type === "src" ? "sender" : "recipient"
  const address = watch(addressKey)
  const dstChainType = useChainType(useSkipChain(dstChainId))

  const { list, find } = useCosmosWallets()
  const connected = find(cosmosWalletName)
  const getDefaultRecipientAddress = useGetDefaultAddress()
  const validateRecipientAddress = useValidateAddress()

  const myDstAddress = getDefaultRecipientAddress(dstChainId)
  const isMyDstAddress = AddressUtils.equals(address, myDstAddress)

  const renderSrcAccount = () => {
    return (
      <ModalTrigger
        title="Connect wallet"
        content={(close) => (
          <List
            onSelect={async (item) => {
              const provider = item.getProvider()
              if (!provider) return window.open(item.fallbackUrl, "_blank")
              const offlineSigner = provider.getOfflineSigner(srcChainId)
              const [{ address }] = await offlineSigner.getAccounts()
              setValue("sender", address)
              setValue("cosmosWalletName", item.name)
              close()
            }}
            list={list}
            getImage={(item) => item.image}
            getName={(item) => item.name}
            getKey={(item) => item.name}
          />
        )}
        className={clsx(styles.account, { [styles.white]: !address })}
      >
        {!address ? (
          <>
            <span>Connect wallet</span>
            <IconChevronRight size={14} />
          </>
        ) : (
          <>
            {connected && <Image src={connected.image} width={18} height={18} />}
            <span className="monospace">{truncate(address)}</span>
          </>
        )}
      </ModalTrigger>
    )
  }

  const renderDstModalTrigger = (content: ReactNode) => {
    return (
      <ModalTrigger
        title="Recipient"
        content={(close) => (
          <Scrollable>
            <RecipientInput
              mode="onSubmit"
              myAddress={myDstAddress}
              chainType={dstChainType}
              validate={(address) => validateRecipientAddress(address, dstChainId)}
              onApply={close}
            />
          </Scrollable>
        )}
        className={styles.account}
      >
        {content}
      </ModalTrigger>
    )
  }

  const renderDstAccount = () => {
    switch (dstChainType) {
      case "initia":
      case "evm": {
        if (isMyDstAddress) {
          return renderDstModalTrigger(<IconWallet size={14} />)
        }

        return (
          <div className={styles.account}>
            <span className="monospace">{truncate(address)}</span>
            <button
              type="button"
              className={styles.clear}
              onClick={() => setValue("recipient", myDstAddress, { shouldValidate: true })}
              aria-label="Reset to my address"
            >
              <IconCloseCircleFilled size={14} />
            </button>
          </div>
        )
      }

      case "cosmos": {
        return renderDstModalTrigger(
          <>
            {address ? (
              <span className="monospace">{truncate(address)}</span>
            ) : (
              <span>Recipient</span>
            )}
            <IconEdit size={14} />
          </>,
        )
      }
    }
  }

  switch (type) {
    case "src":
      return renderSrcAccount()

    case "dst":
      return renderDstAccount()
  }
}

export default BridgeAccount
