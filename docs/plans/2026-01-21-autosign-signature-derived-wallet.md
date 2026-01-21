# Autosign Signature-Derived Wallet Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Privy embedded wallets with signature-derived wallets for autosign, storing keys only in memory.

**Architecture:** Users sign an EIP-712 typed message scoped to origin+chainId. The signature is hashed and used as entropy to derive an HD wallet via `@cosmjs/crypto`. The derived key lives only in memory (Jotai atom) and must be re-derived each session via a lazy prompt on first qualifying transaction.

**Tech Stack:** `@cosmjs/crypto` (Bip39, Slip10), `viem` (keccak256, signTypedData), Jotai atoms, wagmi hooks

---

## Task 1: Add Derived Wallet Store

**Files:**

- Modify: `packages/interwovenkit-react/src/pages/autosign/data/store.ts`

**Step 1: Add derived wallet types and atom**

```typescript
// Add after existing imports
import type { Hex } from "viem"

// Add after existing types
export interface DerivedWallet {
  privateKey: Uint8Array
  publicKey: Uint8Array
  address: string
}

// Add after pendingAutoSignRequestAtom
// Key format: "origin:chainId"
export const derivedWalletsAtom = atom<Record<string, DerivedWallet>>({})
```

**Step 2: Verify the file compiles**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/interwovenkit-react/src/pages/autosign/data/store.ts
git commit -m "feat(autosign): add derived wallet store atom"
```

---

## Task 2: Create Key Derivation Utilities

**Files:**

- Create: `packages/interwovenkit-react/src/pages/autosign/data/derivation.ts`
- Test: `packages/interwovenkit-react/src/pages/autosign/data/derivation.test.ts`

**Step 1: Write the failing test**

Create `packages/interwovenkit-react/src/pages/autosign/data/derivation.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { deriveWalletFromSignature, getAutoSignTypedData } from "./derivation"

describe("derivation", () => {
  describe("getAutoSignTypedData", () => {
    it("returns correct EIP-712 typed data structure", () => {
      const result = getAutoSignTypedData("https://app.example.com", "initiation-2")

      expect(result.domain).toEqual({
        name: "Interwoven Wallet",
        version: "1",
      })
      expect(result.primaryType).toBe("AutoSign")
      expect(result.message).toEqual({
        action: "Enable Auto-Sign",
        origin: "https://app.example.com",
        chainId: "initiation-2",
      })
    })
  })

  describe("deriveWalletFromSignature", () => {
    it("derives deterministic wallet from signature", async () => {
      const mockSignature =
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12"

      const wallet1 = await deriveWalletFromSignature(mockSignature)
      const wallet2 = await deriveWalletFromSignature(mockSignature)

      expect(wallet1.address).toBe(wallet2.address)
      expect(wallet1.address).toMatch(/^init1[a-z0-9]+$/)
      expect(wallet1.privateKey).toBeInstanceOf(Uint8Array)
      expect(wallet1.publicKey).toBeInstanceOf(Uint8Array)
    })

    it("derives different wallets from different signatures", async () => {
      const sig1 =
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12"
      const sig2 =
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab"

      const wallet1 = await deriveWalletFromSignature(sig1)
      const wallet2 = await deriveWalletFromSignature(sig2)

      expect(wallet1.address).not.toBe(wallet2.address)
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm test -- --run packages/interwovenkit-react/src/pages/autosign/data/derivation.test.ts`

Expected: FAIL with "Cannot find module './derivation'"

**Step 3: Write minimal implementation**

Create `packages/interwovenkit-react/src/pages/autosign/data/derivation.ts`:

```typescript
import { Bip39, Slip10, Slip10Curve, stringToPath } from "@cosmjs/crypto"
import { toBech32 } from "@cosmjs/encoding"
import { keccak256, type Hex } from "viem"
import { secp256k1 } from "@noble/curves/secp256k1"
import { ripemd160, sha256 } from "@noble/hashes/sha2-legacy"
import type { DerivedWallet } from "./store"

const COSMOS_HD_PATH = "m/44'/118'/0'/0/0"
const BECH32_PREFIX = "init"

export function getAutoSignTypedData(origin: string, chainId: string) {
  return {
    domain: {
      name: "Interwoven Wallet",
      version: "1",
    },
    types: {
      AutoSign: [
        { name: "action", type: "string" },
        { name: "origin", type: "string" },
        { name: "chainId", type: "string" },
      ],
    },
    primaryType: "AutoSign" as const,
    message: {
      action: "Enable Auto-Sign",
      origin,
      chainId,
    },
  }
}

export async function deriveWalletFromSignature(signature: Hex): Promise<DerivedWallet> {
  // 1. Hash signature to get 32 bytes of entropy
  const entropy = keccak256(signature)
  const entropyBytes = hexToBytes(entropy)

  // 2. Convert entropy to mnemonic
  const mnemonic = Bip39.encode(entropyBytes)

  // 3. Generate seed from mnemonic
  const seed = await Bip39.mnemonicToSeed(mnemonic)

  // 4. Derive HD key at Cosmos path
  const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, stringToPath(COSMOS_HD_PATH))

  // 5. Get public key
  const publicKey = secp256k1.getPublicKey(privkey, true)

  // 6. Derive address from public key
  const address = pubkeyToAddress(publicKey, BECH32_PREFIX)

  return {
    privateKey: privkey,
    publicKey,
    address,
  }
}

function hexToBytes(hex: Hex): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex
  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function pubkeyToAddress(pubkey: Uint8Array, prefix: string): string {
  const sha256Hash = sha256(pubkey)
  const ripemd160Hash = ripemd160(sha256Hash)
  return toBech32(prefix, ripemd160Hash)
}

export function getDerivedWalletKey(origin: string, chainId: string): string {
  return `${origin}:${chainId}`
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm test -- --run packages/interwovenkit-react/src/pages/autosign/data/derivation.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add packages/interwovenkit-react/src/pages/autosign/data/derivation.ts packages/interwovenkit-react/src/pages/autosign/data/derivation.test.ts
git commit -m "feat(autosign): add key derivation utilities with tests"
```

---

## Task 3: Create Derivation Hook

**Files:**

- Modify: `packages/interwovenkit-react/src/pages/autosign/data/wallet.ts`

**Step 1: Add useDeriveWallet hook**

Add these imports at the top of wallet.ts:

```typescript
import { useAtom } from "jotai"
import { useSignTypedData } from "wagmi"
import type { Hex } from "viem"
import { deriveWalletFromSignature, getAutoSignTypedData, getDerivedWalletKey } from "./derivation"
import { derivedWalletsAtom, type DerivedWallet } from "./store"
```

Add after the imports, before useEmbeddedWallet:

```typescript
/* Derive and store wallet from EIP-712 signature for autosign delegation */
export function useDeriveWallet() {
  const [derivedWallets, setDerivedWallets] = useAtom(derivedWalletsAtom)
  const { signTypedDataAsync } = useSignTypedData()

  const deriveWallet = async (chainId: string): Promise<DerivedWallet> => {
    const origin = window.location.origin
    const key = getDerivedWalletKey(origin, chainId)

    // Return cached wallet if exists
    if (derivedWallets[key]) {
      return derivedWallets[key]
    }

    // Sign typed data to get deterministic signature
    const typedData = getAutoSignTypedData(origin, chainId)
    const signature = await signTypedDataAsync({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    })

    // Derive wallet from signature
    const wallet = await deriveWalletFromSignature(signature as Hex)

    // Store in memory
    setDerivedWallets((prev) => ({ ...prev, [key]: wallet }))

    return wallet
  }

  const getWallet = (chainId: string): DerivedWallet | undefined => {
    const origin = window.location.origin
    const key = getDerivedWalletKey(origin, chainId)
    return derivedWallets[key]
  }

  const clearWallet = (chainId: string) => {
    const origin = window.location.origin
    const key = getDerivedWalletKey(origin, chainId)
    setDerivedWallets((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const clearAllWallets = () => {
    setDerivedWallets({})
  }

  return { deriveWallet, getWallet, clearWallet, clearAllWallets }
}

/* Get derived wallet address for current origin and chain */
export function useDerivedWalletAddress(chainId: string) {
  const { getWallet } = useDeriveWallet()
  return getWallet(chainId)?.address
}
```

**Step 2: Verify the file compiles**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/interwovenkit-react/src/pages/autosign/data/wallet.ts
git commit -m "feat(autosign): add useDeriveWallet hook for signature-based derivation"
```

---

## Task 4: Replace Embedded Wallet Signing with Derived Wallet Signing

**Files:**

- Modify: `packages/interwovenkit-react/src/pages/autosign/data/wallet.ts`

**Step 1: Create derived wallet signer class**

Add after the useDerivedWalletAddress function in wallet.ts:

```typescript
/* Offline signer implementation for derived wallet */
class DerivedWalletSigner implements OfflineAminoSigner {
  constructor(
    private wallet: DerivedWallet,
    private restUrl: string,
  ) {}

  async getAccounts(): Promise<readonly AccountData[]> {
    return [
      {
        address: this.wallet.address,
        algo: "ethsecp256k1" as Algo,
        pubkey: this.wallet.publicKey,
      },
    ]
  }

  async signAmino(signerAddress: string, signDoc: StdSignDoc): Promise<AminoSignResponse> {
    if (this.wallet.address !== signerAddress) {
      throw new Error("Signer address does not match the derived wallet address")
    }

    const signDocAminoJSON = escapeCharacters(sortedJsonStringify(signDoc))
    const messageHash = ethers.hashMessage(signDocAminoJSON)
    const messageHashBytes = fromHex(messageHash.replace("0x", ""))

    // Sign with derived private key
    const signature = secp256k1.sign(messageHashBytes, this.wallet.privateKey)
    const signatureBytes = signature.toCompactRawBytes()

    const encodedSignature = encodeEthSecp256k1Signature(this.wallet.publicKey, signatureBytes)

    return { signed: signDoc, signature: encodedSignature }
  }
}
```

Add required imports at the top:

```typescript
import type {
  AccountData,
  Algo,
  AminoSignResponse,
  OfflineAminoSigner,
  StdSignDoc,
} from "@cosmjs/amino"
import { escapeCharacters, sortedJsonStringify } from "@cosmjs/amino/build/signdoc"
import { fromHex } from "@cosmjs/encoding"
import { ethers } from "ethers"
import { secp256k1 } from "@noble/curves/secp256k1"
import { encodeEthSecp256k1Signature } from "@/data/patches/signature"
```

**Step 2: Create useSignWithDerivedWallet hook**

Add after DerivedWalletSigner class:

```typescript
/* Sign auto-sign transactions with derived wallet by wrapping messages in MsgExec and delegating fees */
export function useSignWithDerivedWallet() {
  const { getWallet } = useDeriveWallet()
  const registry = useRegistry()
  const findChain = useFindChain()
  const signWithEthSecp256k1 = useSignWithEthSecp256k1()

  return async (
    chainId: string,
    granterAddress: string,
    messages: EncodeObject[],
    fee: StdFee,
    memo: string,
  ): Promise<TxRaw> => {
    const derivedWallet = getWallet(chainId)
    if (!derivedWallet) {
      throw new Error("Derived wallet not found. Please unlock auto-sign first.")
    }

    // Wrap messages in MsgExec for authz delegation
    const authzExecuteMessage: EncodeObject[] = [
      {
        typeUrl: "/cosmos.authz.v1beta1.MsgExec",
        value: MsgExec.fromPartial({
          grantee: derivedWallet.address,
          msgs: messages.map((msg) => ({
            typeUrl: msg.typeUrl,
            value: registry.encode(msg),
          })),
        }),
      },
    ]

    // Set fee granter for delegated transaction
    const delegatedFee: StdFee = {
      ...fee,
      granter: granterAddress,
    }

    // Create signer instance for derived wallet
    const derivedSigner = new DerivedWalletSigner(derivedWallet, findChain(chainId).restUrl)

    // Sign transaction with derived wallet
    return await signWithEthSecp256k1(
      chainId,
      derivedWallet.address,
      authzExecuteMessage,
      delegatedFee,
      memo,
      { customSigner: derivedSigner },
    )
  }
}
```

**Step 3: Verify the file compiles**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm build`

Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/interwovenkit-react/src/pages/autosign/data/wallet.ts
git commit -m "feat(autosign): add derived wallet signer and useSignWithDerivedWallet hook"
```

---

## Task 5: Update Enable AutoSign Action

**Files:**

- Modify: `packages/interwovenkit-react/src/pages/autosign/data/actions.ts`

**Step 1: Replace Privy wallet creation with derivation**

Replace the entire useEnableAutoSign function:

```typescript
/* Enable AutoSign by deriving wallet from signature and granting permissions */
export function useEnableAutoSign() {
  const initiaAddress = useInitiaAddress()
  const messageTypes = useAutoSignMessageTypes()
  const { requestTxBlock } = useTx()
  const queryClient = useQueryClient()
  const [pendingRequest, setPendingRequest] = useAtom(pendingAutoSignRequestAtom)
  const { closeDrawer } = useDrawer()
  const fetchRevokeMessages = useFetchRevokeMessages()
  const { deriveWallet } = useDeriveWallet()

  return useMutation({
    mutationFn: async (durationInMs: number) => {
      if (!pendingRequest) {
        throw new Error("No pending request")
      }

      const { chainId } = pendingRequest

      if (!initiaAddress) {
        throw new Error("Wallet not connected")
      }

      // Derive wallet from signature (prompts user to sign EIP-712 message)
      const derivedWallet = await deriveWallet(chainId)

      // Fetch existing grants and generate revoke messages
      const revokeMessages = await fetchRevokeMessages({ chainId, grantee: derivedWallet.address })

      const expiration = durationInMs === 0 ? undefined : addMilliseconds(new Date(), durationInMs)

      const feegrantMessage = {
        typeUrl: "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
        value: MsgGrantAllowance.fromPartial({
          granter: initiaAddress,
          grantee: derivedWallet.address,
          allowance: {
            typeUrl: "/cosmos.feegrant.v1beta1.BasicAllowance",
            value: BasicAllowance.encode(BasicAllowance.fromPartial({ expiration })).finish(),
          },
        }),
      }

      const authzMessages = messageTypes[chainId].map((msgType) => ({
        typeUrl: "/cosmos.authz.v1beta1.MsgGrant",
        value: MsgGrant.fromPartial({
          granter: initiaAddress,
          grantee: derivedWallet.address,
          grant: {
            authorization: {
              typeUrl: "/cosmos.authz.v1beta1.GenericAuthorization",
              value: GenericAuthorization.encode(
                GenericAuthorization.fromPartial({ msg: msgType }),
              ).finish(),
            },
            expiration,
          },
        }),
      }))

      const messages = [...revokeMessages, feegrantMessage, ...authzMessages]
      await requestTxBlock({ messages, chainId, internal: true })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: autoSignQueryKeys.expirations._def,
      })

      pendingRequest?.resolve()
    },
    onError: (error: Error) => {
      pendingRequest?.reject(error)
    },
    onSettled: () => {
      setPendingRequest(null)
      closeDrawer()
    },
  })
}
```

Update imports at the top of actions.ts:

```typescript
// Remove this line:
// import { useConfig } from "@/data/config"

// Update wallet import:
import { useDeriveWallet } from "./wallet"
```

**Step 2: Update useDisableAutoSign to clear derived wallet**

Update the useDisableAutoSign function to clear the derived wallet from memory:

```typescript
/* Revoke AutoSign permissions and clear derived wallet from memory */
export function useDisableAutoSign(options?: {
  grantee: string
  messageTypes: Record<string, string[]>
  internal: boolean
}) {
  const config = useConfig()
  const { getWallet, clearWallet } = useDeriveWallet()
  const derivedWallet = getWallet(config.defaultChainId)
  const grantee = options?.grantee || derivedWallet?.address
  const { requestTxBlock } = useTx()
  const queryClient = useQueryClient()
  const fetchRevokeMessages = useFetchRevokeMessages()

  return useMutation({
    mutationFn: async (chainId: string = config.defaultChainId) => {
      if (!grantee) {
        throw new Error("No grantee address available")
      }

      const messages = await fetchRevokeMessages({ chainId, grantee })
      await requestTxBlock({ messages, chainId, internal: options?.internal })
    },
    onSuccess: async (_, chainId = config.defaultChainId) => {
      // Clear derived wallet from memory
      clearWallet(chainId)

      const queryKeys = [autoSignQueryKeys.expirations._def, autoSignQueryKeys.grants._def]

      for (const queryKey of queryKeys) {
        await queryClient.invalidateQueries({ queryKey })
      }
    },
  })
}
```

Add the config import back since it's used in useDisableAutoSign:

```typescript
import { useConfig } from "@/data/config"
```

**Step 3: Verify the file compiles**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm build`

Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/interwovenkit-react/src/pages/autosign/data/actions.ts
git commit -m "feat(autosign): replace Privy wallet with signature-derived wallet in actions"
```

---

## Task 6: Update Validation to Check Derived Wallet

**Files:**

- Modify: `packages/interwovenkit-react/src/pages/autosign/data/validation.ts`

**Step 1: Update useAutoSignStatus to use derived wallet address**

Update imports:

```typescript
// Replace:
// import { useEmbeddedWalletAddress } from "./wallet"
// With:
import { useDeriveWallet } from "./wallet"
```

Update useAutoSignStatus function to query grants for any grantee (since we don't know the derived address until the user signs):

```typescript
/* Get current AutoSign status including enabled state and expiration dates by chain */
export function useAutoSignStatus() {
  const initiaAddress = useInitiaAddress()
  const messageTypes = useAutoSignMessageTypes()
  const { fetchFeegrant, fetchGrants, fetchAllGrants } = useAutoSignApi()

  return useQuery({
    queryKey: autoSignQueryKeys.expirations(initiaAddress, undefined).queryKey,
    queryFn: async () => {
      if (!initiaAddress) {
        return {
          expiredAtByChain: {},
          isEnabledByChain: {},
          granteeByChain: {},
        }
      }

      // Track expiration dates and grantees for each chain
      const expiredAtByChain: Record<string, Date | null | undefined> = {}
      const granteeByChain: Record<string, string | undefined> = {}

      // Check each chain's grants and feegrants
      for (const [chainId, msgTypes] of Object.entries(messageTypes)) {
        try {
          // Fetch all grants for this granter to find any valid grantee
          const allGrants = await fetchAllGrants(chainId)

          // Find a grantee that has all required message types granted
          const validGrantee = findValidGrantee(allGrants, msgTypes)

          if (!validGrantee) {
            expiredAtByChain[chainId] = null
            continue
          }

          granteeByChain[chainId] = validGrantee.grantee

          const feegrant = await fetchFeegrant(chainId, validGrantee.grantee)

          if (!feegrant) {
            expiredAtByChain[chainId] = null
            continue
          }

          // Extract expiration dates from grants and feegrant
          const grantExpirations = validGrantee.grants
            .filter((grant) => msgTypes.includes(grant.authorization.msg))
            .map((grant) => grant.expiration)

          const feegrantExpiration = feegrant.allowance.expiration

          // Find the earliest expiration (most restrictive)
          const allExpirations = [...grantExpirations, feegrantExpiration]

          const earliestExpiration = findEarliestDate(allExpirations)
          expiredAtByChain[chainId] = earliestExpiration ? new Date(earliestExpiration) : undefined
        } catch {
          expiredAtByChain[chainId] = null
        }
      }

      // Calculate isEnabledByChain based on expiration dates
      const isEnabledByChain: Record<string, boolean> = {}

      for (const [chainId, expiration] of Object.entries(expiredAtByChain)) {
        switch (expiration) {
          case null:
            isEnabledByChain[chainId] = false
            break
          case undefined:
            isEnabledByChain[chainId] = true
            break
          default:
            isEnabledByChain[chainId] = isFuture(expiration)
            break
        }
      }

      return {
        expiredAtByChain,
        isEnabledByChain,
        granteeByChain,
      }
    },
    staleTime: STALE_TIMES.INFINITY,
    retry: false,
  })
}

interface GrantWithGrantee {
  grantee: string
  grants: Array<{ authorization: { msg: string }; expiration?: string }>
}

function findValidGrantee(
  allGrants: Array<{ grantee: string; authorization: { msg: string }; expiration?: string }>,
  requiredMsgTypes: string[],
): GrantWithGrantee | null {
  // Group grants by grantee
  const grantsByGrantee = new Map<
    string,
    Array<{ authorization: { msg: string }; expiration?: string }>
  >()

  for (const grant of allGrants) {
    const existing = grantsByGrantee.get(grant.grantee) || []
    existing.push({ authorization: grant.authorization, expiration: grant.expiration })
    grantsByGrantee.set(grant.grantee, existing)
  }

  // Find first grantee with all required message types
  for (const [grantee, grants] of grantsByGrantee) {
    const grantedMsgTypes = grants.map((g) => g.authorization.msg)
    const hasAllTypes = requiredMsgTypes.every((msgType) => grantedMsgTypes.includes(msgType))
    if (hasAllTypes) {
      return { grantee, grants }
    }
  }

  return null
}
```

**Step 2: Add useNeedsDerivedWallet hook for checking if re-derivation is needed**

Add after useValidateAutoSign:

```typescript
/* Check if derived wallet needs to be unlocked for auto-signing */
export function useNeedsDerivedWallet() {
  const { data } = useAutoSignStatus()
  const { getWallet } = useDeriveWallet()

  return (chainId: string): boolean => {
    const isEnabled = data?.isEnabledByChain[chainId] ?? false
    if (!isEnabled) return false

    const wallet = getWallet(chainId)
    return !wallet
  }
}
```

**Step 3: Verify the file compiles**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm build`

Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/interwovenkit-react/src/pages/autosign/data/validation.ts
git commit -m "feat(autosign): update validation to work with signature-derived wallets"
```

---

## Task 7: Update Fetch API for All Grants

**Files:**

- Modify: `packages/interwovenkit-react/src/pages/autosign/data/fetch.ts`

**Step 1: Read fetch.ts to understand current structure**

First read the file to see current implementation.

**Step 2: Add fetchAllGrants function**

Add a function to fetch all grants for a granter (not filtered by grantee):

```typescript
/* Fetch all authz grants for the current user as granter */
const fetchAllGrants = async (chainId: string) => {
  const chain = findChain(chainId)
  const address = initiaAddress

  if (!address) return []

  try {
    const data = await ky
      .create({ prefixUrl: chain.restUrl })
      .get(`cosmos/authz/v1beta1/grants/granter/${address}`)
      .json<{
        grants: Array<{
          grantee: string
          granter: string
          authorization: { "@type": string; msg: string }
          expiration?: string
        }>
      }>()

    return data.grants.map((grant) => ({
      grantee: grant.grantee,
      authorization: {
        msg: grant.authorization.msg,
      },
      expiration: grant.expiration,
    }))
  } catch {
    return []
  }
}
```

Update the return statement to include fetchAllGrants:

```typescript
return { fetchFeegrant, fetchGrants, fetchAllGrants }
```

**Step 3: Verify the file compiles**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm build`

Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/interwovenkit-react/src/pages/autosign/data/fetch.ts
git commit -m "feat(autosign): add fetchAllGrants to query all grants for granter"
```

---

## Task 8: Update TxRequest for Unlock Prompt

**Files:**

- Modify: `packages/interwovenkit-react/src/pages/tx/TxRequest.tsx`

**Step 1: Add unlock state and derived wallet hooks**

Add imports:

```typescript
import { useDeriveWallet, useSignWithDerivedWallet } from "../autosign/data/wallet"
import { useNeedsDerivedWallet } from "../autosign/data/validation"
```

Update the component to handle the unlock flow:

```typescript
const TxRequest = () => {
  const { txRequest, resolve, reject } = useTxRequestHandler()
  const { messages, memo, chainId, gas, gasAdjustment, spendCoins } = txRequest

  const address = useInitiaAddress()
  const signWithEthSecp256k1 = useSignWithEthSecp256k1()
  const chain = useChain(chainId)
  const balances = useBalances(chain)
  const gasPrices = useGasPrices(chain)
  const lastUsedFeeDenom = useLastFeeDenom(chain)
  const findAsset = useFindAsset(chain)
  const validateAutoSign = useValidateAutoSign()
  const signWithDerivedWallet = useSignWithDerivedWallet()
  const needsDerivedWallet = useNeedsDerivedWallet()
  const { deriveWallet } = useDeriveWallet()

  const [isUnlocking, setIsUnlocking] = useState(false)

  // ... keep existing feeOptions, feeCoins, getFeeDetails, getInitialFeeDenom code ...

  const [feeDenom, setFeeDenom] = useState(getInitialFeeDenom)

  const handleUnlockAutoSign = async () => {
    setIsUnlocking(true)
    try {
      await deriveWallet(chainId)
    } finally {
      setIsUnlocking(false)
    }
  }

  const { mutate: approve, isPending } = useMutation({
    mutationKey: [TX_APPROVAL_MUTATION_KEY],
    mutationFn: async () => {
      const fee = feeOptions.find((fee) => fee.amount[0].denom === feeDenom)
      if (!fee) throw new Error("Fee not found")

      const canAutoSign = !txRequest.internal && (await validateAutoSign(chainId, messages))

      if (canAutoSign) {
        // Check if we need to unlock first
        if (needsDerivedWallet(chainId)) {
          await deriveWallet(chainId)
        }
        const signedTx = await signWithDerivedWallet(chainId, address, messages, fee, memo || "")
        await resolve(signedTx)
      } else {
        const signedTx = await signWithEthSecp256k1(chainId, address, messages, fee, memo)
        await resolve(signedTx)
      }
    },
    onError: async (error: Error) => {
      reject(error)
    },
  })

  const feeDetails = getFeeDetails(feeDenom)
  const isInsufficient = !feeDetails.isSufficient
  const showUnlockPrompt = !txRequest.internal && needsDerivedWallet(chainId)

  return (
    <>
      <Scrollable>
        <h1 className={styles.title}>Confirm tx</h1>

        {showUnlockPrompt && (
          <div className={styles.unlockPrompt}>
            <p>Auto-sign is enabled but needs to be unlocked for this session.</p>
            <Button.Outline onClick={handleUnlockAutoSign} loading={isUnlocking} disabled={isUnlocking}>
              Unlock Auto-Sign
            </Button.Outline>
          </div>
        )}

        {/* ... rest of existing JSX ... */}
      </Scrollable>

      <Footer className={styles.footer}>
        <Button.Outline
          onClick={() => reject(new Error("User rejected"))}
          disabled={isPending || isUnlocking}
          className={styles.rejectButton}
        >
          <IconClose size={16} />
        </Button.Outline>
        <Button.White onClick={() => approve()} disabled={isInsufficient || isUnlocking} loading={isPending}>
          Approve
        </Button.White>
      </Footer>
    </>
  )
}
```

**Step 2: Add unlock prompt styles**

Add to TxRequest.module.css:

```css
.unlockPrompt {
  background: var(--color-bg-secondary);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  text-align: center;
}

.unlockPrompt p {
  margin-bottom: 12px;
  color: var(--color-text-secondary);
  font-size: 14px;
}
```

**Step 3: Verify the file compiles**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm build`

Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/interwovenkit-react/src/pages/tx/TxRequest.tsx packages/interwovenkit-react/src/pages/tx/TxRequest.module.css
git commit -m "feat(autosign): add unlock prompt for derived wallet in TxRequest"
```

---

## Task 9: Update EnableAutoSign UI Copy

**Files:**

- Modify: `packages/interwovenkit-react/src/pages/autosign/EnableAutoSign.tsx`

**Step 1: Update feature list copy to remove Privy reference**

Change line 129-133:

```typescript
{[
  "Send transactions without confirmation pop-ups",
  "Secured by your wallet signature",
  "Revoke permissions any time in settings",
].map((item) => (
```

**Step 2: Verify the file compiles**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm build`

Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/interwovenkit-react/src/pages/autosign/EnableAutoSign.tsx
git commit -m "feat(autosign): update EnableAutoSign copy to remove Privy reference"
```

---

## Task 10: Remove Privy Dependencies

**Files:**

- Delete: `packages/interwovenkit-react/src/data/privy.ts`
- Modify: `packages/interwovenkit-react/src/data/config.ts`

**Step 1: Update config.ts to remove Privy types**

Remove Privy imports and update Config interface:

```typescript
import type { GeneratedType } from "@cosmjs/proto-signing"
import type { AminoConverters } from "@cosmjs/stargate"
import { createContext, useContext } from "react"
import type { Chain } from "@initia/initia-registry-types"

export interface Config {
  defaultChainId: string
  customChain?: Chain
  protoTypes?: Iterable<[string, GeneratedType]>
  aminoConverters?: AminoConverters

  registryUrl: string
  routerApiUrl: string
  glyphUrl: string
  usernamesModuleAddress: string

  theme: "light" | "dark"
  container?: HTMLElement
  disableAnalytics?: boolean
  enableAutoSign?: boolean | Record<string, string[]>
}

export const ConfigContext = createContext<Config | null>(null)

export function useConfig() {
  const config = useContext(ConfigContext)
  if (!config) throw new Error("Check if the InterwovenKitProvider is mounted")
  return config
}
```

**Step 2: Delete privy.ts**

Run: `rm packages/interwovenkit-react/src/data/privy.ts`

**Step 3: Find and remove any remaining Privy imports**

Search for Privy references and remove them:

Run: `grep -r "privy" packages/interwovenkit-react/src --include="*.ts" --include="*.tsx" -l`

Update any files that still import from privy.ts or reference privyContext.

**Step 4: Update wallet.ts to remove Privy imports**

Remove these lines from wallet.ts:

```typescript
// Remove:
// import { useConfig } from "@/data/config"
// import { useIsPrivyConnected } from "@/data/privy"

// Remove useEmbeddedWallet and useEmbeddedWalletAddress functions entirely
// Remove useSignWithEmbeddedWallet function entirely
```

**Step 5: Verify the build succeeds**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm build`

Expected: Build succeeds

**Step 6: Run all tests**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm test`

Expected: All tests pass

**Step 7: Commit**

```bash
git add -A
git commit -m "feat(autosign): remove Privy dependencies"
```

---

## Task 11: Update Settings Page Grant Display

**Files:**

- Modify: `packages/interwovenkit-react/src/pages/settings/autosign/GrantItem.tsx`
- Modify: `packages/interwovenkit-react/src/pages/settings/autosign/GrantList.tsx`

**Step 1: Read current implementation**

Read the files to understand how grants are currently displayed and update to work with the new grantee lookup from chain.

**Step 2: Update GrantList to use granteeByChain from status**

The grants should continue to work since they read from chain data, not from Privy. Verify this by checking the implementation.

**Step 3: Verify the build succeeds**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm build`

Expected: Build succeeds

**Step 4: Commit if changes were needed**

```bash
git add packages/interwovenkit-react/src/pages/settings/autosign/
git commit -m "feat(autosign): update settings pages for derived wallet"
```

---

## Task 12: Clear Derived Wallets on Disconnect

**Files:**

- Modify: `packages/interwovenkit-react/src/data/ui.ts` (or wherever useDisconnect is defined)

**Step 1: Find useDisconnect location**

Search for the useDisconnect hook definition.

**Step 2: Update useDisconnect to clear derived wallets**

Add wallet clearing to the disconnect flow:

```typescript
import { useDeriveWallet } from "@/pages/autosign/data/wallet"

// In useDisconnect:
const { clearAllWallets } = useDeriveWallet()

// Call clearAllWallets() when disconnecting
```

**Step 3: Verify the build succeeds**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm build`

Expected: Build succeeds

**Step 4: Commit**

```bash
git add packages/interwovenkit-react/src/data/ui.ts
git commit -m "feat(autosign): clear derived wallets on disconnect"
```

---

## Task 13: Final Verification

**Step 1: Run full test suite**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm test`

Expected: All tests pass

**Step 2: Run build**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm build`

Expected: Build succeeds without errors

**Step 3: Run lint**

Run: `cd /Users/tansawit/files/initia/interwovenkit/.worktrees/autosign-derived-wallet && pnpm lint`

Expected: No lint errors

**Step 4: Review all changes**

Run: `git log --oneline main..HEAD`

Verify all commits are present and properly scoped.

---

## Summary of Changes

| File                      | Action | Description                                                       |
| ------------------------- | ------ | ----------------------------------------------------------------- |
| `data/store.ts`           | Modify | Add DerivedWallet type and derivedWalletsAtom                     |
| `data/derivation.ts`      | Create | Key derivation utilities                                          |
| `data/derivation.test.ts` | Create | Tests for key derivation                                          |
| `data/wallet.ts`          | Modify | Add useDeriveWallet, useSignWithDerivedWallet, remove Privy hooks |
| `data/actions.ts`         | Modify | Use derived wallet instead of Privy                               |
| `data/validation.ts`      | Modify | Update status queries, add useNeedsDerivedWallet                  |
| `data/fetch.ts`           | Modify | Add fetchAllGrants                                                |
| `data/config.ts`          | Modify | Remove privyContext from Config                                   |
| `data/privy.ts`           | Delete | Remove entirely                                                   |
| `data/ui.ts`              | Modify | Clear derived wallets on disconnect                               |
| `EnableAutoSign.tsx`      | Modify | Update copy                                                       |
| `TxRequest.tsx`           | Modify | Add unlock prompt                                                 |
| `TxRequest.module.css`    | Modify | Add unlock prompt styles                                          |
