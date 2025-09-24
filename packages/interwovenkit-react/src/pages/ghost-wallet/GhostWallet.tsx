import { IconCheckCircle } from "@initia/icons-react"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useDrawer } from "@/data/ui"
import Scrollable from "@/components/Scrollable"
import Footer from "@/components/Footer"
import Button from "@/components/Button"
import styles from "./GhostWallet.module.css"
import { useCreateWallet } from "@privy-io/react-auth"
import { BasicAllowance } from "@initia/initia.proto/cosmos/feegrant/v1beta1/feegrant"
import { GenericAuthorization } from "@initia/initia.proto/cosmos/authz/v1beta1/authz"
import { useInterwovenKit } from "@/public/data/hooks"
import { useConfig } from "@/data/config"
import { InitiaAddress } from "@initia/utils"
import { useEmbeddedWallet, ghostWalletExpirationAtom } from "./hooks"
import { useSetAtom } from "jotai"
import DurationSelector, { type DurationOption } from "./DurationSelector"

const DURATION_OPTIONS: Array<{ value: DurationOption; label: string; milliseconds: number }> = [
  { value: "10min", label: "10 Minutes", milliseconds: 10 * 60 * 1000 },
  { value: "1hour", label: "1 Hour", milliseconds: 60 * 60 * 1000 },
  { value: "1day", label: "1 Day", milliseconds: 24 * 60 * 60 * 1000 },
  { value: "7days", label: "7 Days", milliseconds: 7 * 24 * 60 * 60 * 1000 },
  { value: "until-revoked", label: "Until Revoked", milliseconds: 100 * 365 * 24 * 60 * 60 * 1000 }, // 100 years
]

const GhostWallet = () => {
  const { closeDrawer } = useDrawer()
  const { createWallet } = useCreateWallet()
  const { initiaAddress, requestTxSync } = useInterwovenKit()
  const config = useConfig()
  const embeddedWallet = useEmbeddedWallet()
  const setGhostWalletExpiration = useSetAtom(ghostWalletExpirationAtom)
  const [selectedDuration, setSelectedDuration] = useState<DurationOption>("10min")

  const { mutate: createGhostWallet, isPending } = useMutation({
    mutationFn: async () => {
      const { address: ghostWalletAddress } =
        embeddedWallet || (await createWallet({ createAdditional: false }))

      const selectedDurationMs =
        DURATION_OPTIONS.find((option) => option.value === selectedDuration)?.milliseconds ||
        DURATION_OPTIONS[0].milliseconds
      const expiration = new Date(Date.now() + selectedDurationMs)

      if (!config.ghostWalletPermissions?.length) {
        throw new Error("Ghost wallet permissions must be configured")
      }

      const messages = [
        {
          typeUrl: "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
          value: {
            granter: initiaAddress,
            grantee: InitiaAddress(ghostWalletAddress).bech32,
            allowance: {
              typeUrl: "/cosmos.feegrant.v1beta1.BasicAllowance",
              value: BasicAllowance.encode(
                BasicAllowance.fromPartial({
                  expiration,
                }),
              ).finish(),
            },
          },
        },
        ...config.ghostWalletPermissions.map((typeUrl) => ({
          typeUrl: "/cosmos.authz.v1beta1.MsgGrant",
          value: {
            granter: initiaAddress,
            grantee: InitiaAddress(ghostWalletAddress).bech32,
            grant: {
              authorization: {
                typeUrl: "/cosmos.authz.v1beta1.GenericAuthorization",
                value: GenericAuthorization.encode({
                  msg: typeUrl,
                }).finish(),
              },
              expiration,
            },
          },
        })),
      ]

      return await requestTxSync({
        messages,
      })
    },
    onSuccess: () => {
      // Set the ghost wallet expiration atom based on selected duration
      const selectedDurationMs =
        DURATION_OPTIONS.find((option) => option.value === selectedDuration)?.milliseconds ||
        DURATION_OPTIONS[0].milliseconds

      setGhostWalletExpiration(Date.now() + selectedDurationMs)

      closeDrawer()
    },
  })

  const handleReject = () => {
    closeDrawer()
  }

  const handleConfirm = () => {
    createGhostWallet()
  }

  return (
    <>
      <Scrollable>
        <h1 className={styles.title}>Create Ghost Wallet</h1>

        <ul className={styles.list}>
          {[
            "Automatic transaction signing",
            "Enables faster interactions",
            "Can be disabled at any time",
            "Secured by Privy",
          ].map((text) => (
            <li className={styles.listItem}>
              <IconCheckCircle size={12} />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </Scrollable>

      <div className={styles.durationSelector}>
        <span className={styles.durationLabel}>Duration:</span>
        <DurationSelector
          value={selectedDuration}
          onChange={setSelectedDuration}
          disabled={isPending}
          fullWidth
        />
      </div>

      <Footer className={styles.footer}>
        <Button.Outline onClick={handleReject} disabled={isPending}>
          Reject
        </Button.Outline>
        <Button.White onClick={handleConfirm} loading={isPending}>
          Confirm
        </Button.White>
      </Footer>
    </>
  )
}

export default GhostWallet
