import { IconCheckCircle } from "@initia/icons-react"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useCreateWallet } from "@privy-io/react-auth"
import { BasicAllowance } from "@initia/initia.proto/cosmos/feegrant/v1beta1/feegrant"
import { GenericAuthorization } from "@initia/initia.proto/cosmos/authz/v1beta1/authz"
import { InitiaAddress, truncate } from "@initia/utils"
import { useSetAtom } from "jotai"
import { useEmbeddedWallet, useGhostWalletPermissions } from "../hooks"
import { useDrawerControl, useInterwovenKit } from "@initia/interwovenkit-react"
import { ghostWalletExpirationAtom } from "../data/atoms"
import DurationSelector from "./DurationSelector"

const DEFAULT_DURATION = 10 * 60 * 1000

const GhostWallet = ({ chainId }: { chainId: string }) => {
  const ghostWalletPermissions = useGhostWalletPermissions()
  const { closeDrawer } = useDrawerControl()
  const { createWallet } = useCreateWallet()
  const { initiaAddress, requestTxSync } = useInterwovenKit()
  const embeddedWallet = useEmbeddedWallet()
  const setGhostWalletExpiration = useSetAtom(ghostWalletExpirationAtom)
  const [selectedDuration, setSelectedDuration] = useState<number>(DEFAULT_DURATION)

  const appIcon = (document.querySelector("link[rel~='icon']") as HTMLLinkElement | null)?.href

  const { mutate: createGhostWallet, isPending } = useMutation({
    mutationFn: async () => {
      const { address: ghostWalletAddress } =
        embeddedWallet || (await createWallet({ createAdditional: false }))

      const selectedDurationMs = selectedDuration
      const expiration = new Date(Date.now() + selectedDurationMs)

      if (!ghostWalletPermissions[chainId]?.length) {
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
        ...ghostWalletPermissions[chainId].map((typeUrl) => ({
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
      setGhostWalletExpiration((exp) => ({ ...exp, [chainId]: Date.now() + selectedDuration }))
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
    <div style={{ padding: "var(--padding)" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "20px" }}>
        Enable auto-signing
      </h1>

      <p style={{ color: "var(--gray-2)", fontSize: "12px", fontWeight: 500, marginBottom: "4px" }}>
        Asking for permission
      </p>
      <div
        style={{
          backgroundColor: "var(--gray-8)",
          borderRadius: "8px",
          padding: "12px",
          display: "grid",
          gridTemplateAreas: '"icon name" "icon host"',
          gridTemplateColumns: "28px 1fr",
          alignItems: "center",
          columnGap: "8px",
        }}
      >
        {appIcon ? (
          <img
            src={appIcon}
            alt={document.title}
            style={{ gridArea: "icon" }}
            width={28}
            height={28}
          />
        ) : (
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              backgroundColor: "var(--gray-6)",
              gridArea: "icon",
            }}
          />
        )}

        <p
          style={{
            color: "var(--gray-1)",
            fontSize: "14px",
            fontWeight: 600,
            gridArea: "name",
            margin: 0,
          }}
        >
          {document.title}
        </p>
        <p
          style={{
            color: "var(--gray-2)",
            fontSize: "12px",
            fontWeight: 500,
            gridArea: "host",
            margin: 0,
          }}
        >
          {window.location.host}
        </p>
      </div>

      <div
        style={{
          margin: "20px 0",
          display: "grid",
          gridTemplateColumns: "1fr auto",
          rowGap: "8px",
        }}
      >
        <p style={{ fontSize: "12px", fontWeight: 500, color: "var(--gray-3)", margin: 0 }}>
          Address
        </p>
        <p
          style={{
            fontSize: "12px",
            fontWeight: 500,
            color: "var(--gray-1)",
            fontFamily: "var(--monospace)",
            textAlign: "end" as const,
            margin: 0,
          }}
        >
          {truncate(initiaAddress)}
        </p>

        <p style={{ fontSize: "12px", fontWeight: 500, color: "var(--gray-3)", margin: 0 }}>
          Chain
        </p>
        <p
          style={{
            fontSize: "12px",
            fontWeight: 500,
            color: "var(--gray-1)",
            fontFamily: "var(--monospace)",
            textAlign: "end" as const,
            margin: 0,
          }}
        >
          {chainId}
        </p>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "8px" }}>
        {[
          "Automatic transaction signing",
          "Enables faster interactions",
          "Can be disabled at any time",
          "Secured by Privy",
        ].map((text, index) => (
          <li
            key={index}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              fontWeight: 500,
              color: "var(--gray-1)",
            }}
          >
            <IconCheckCircle size={12} style={{ color: "var(--success)" }} />
            <span>{text}</span>
          </li>
        ))}
      </ul>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          margin: "20px 0",
        }}
      >
        <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--gray-0)" }}>
          Set duration
        </span>
        <DurationSelector
          value={selectedDuration}
          onChange={setSelectedDuration}
          disabled={isPending}
          fullWidth
        />
      </div>

      <footer style={{ display: "grid", gridTemplateColumns: "50% 50%", gap: "8px" }}>
        <button
          onClick={handleReject}
          disabled={isPending}
          style={{
            padding: "12px",
            border: "1px solid var(--gray-5)",
            borderRadius: "8px",
            background: "transparent",
            color: "var(--gray-0)",
            fontSize: "14px",
            fontWeight: 500,
            cursor: isPending ? "not-allowed" : "pointer",
            opacity: isPending ? 0.5 : 1,
          }}
        >
          Reject
        </button>
        <button
          onClick={handleConfirm}
          disabled={isPending}
          style={{
            padding: "12px",
            border: "none",
            borderRadius: "8px",
            background: "var(--button-bg)",
            color: "var(--button-text)",
            fontSize: "14px",
            fontWeight: 500,
            cursor: isPending ? "not-allowed" : "pointer",
            opacity: isPending ? 0.5 : 1,
          }}
        >
          Confirm
        </button>
      </footer>
    </div>
  )
}

export function GhostWalletPage({ chainId }: { chainId: string }) {
  return GhostWallet({ chainId })
}

export default GhostWallet
