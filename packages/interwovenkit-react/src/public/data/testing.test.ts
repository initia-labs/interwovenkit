import { createTestWalletConnector, type CreateTestWalletOptions } from "./testing"

vi.mock("wagmi/connectors", () => ({
  injected: ({ target }: { target: () => unknown }) => target(),
}))

const TEST_MNEMONIC = "test test test test test test test test test test test junk"

interface TestConnector {
  id: string
  name: string
  provider: {
    request(args: { method: string }): Promise<unknown>
  }
}

function createConnector(options: Parameters<typeof createTestWalletConnector>[0]) {
  return createTestWalletConnector(options) as unknown as TestConnector
}

async function getAddress(options: Parameters<typeof createTestWalletConnector>[0]) {
  const connector = createConnector(options)
  const accounts = (await connector.provider.request({ method: "eth_accounts" })) as string[]
  return accounts[0]
}

describe("createTestWalletConnector", () => {
  test("preserves the default derivation and connector metadata when addressIndex is omitted", async () => {
    const connector = createConnector({ mnemonic: TEST_MNEMONIC })

    expect(connector.id).toBe("testWallet")
    expect(connector.name).toBe("Test Wallet")
    await expect(getAddress({ mnemonic: TEST_MNEMONIC })).resolves.toBe(
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    )
  })

  test.each([
    [0, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"],
    [1, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"],
    [2, "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"],
  ])("derives the Hardhat account at address index %i", async (addressIndex, expected) => {
    await expect(getAddress({ mnemonic: TEST_MNEMONIC, addressIndex })).resolves.toBe(expected)
  })

  test("derives unique default connector metadata from an explicit address index", () => {
    const connector = createConnector({ mnemonic: TEST_MNEMONIC, addressIndex: 1 })

    expect(connector.id).toBe("testWallet-1")
    expect(connector.name).toBe("Test Wallet 1")
  })

  test("allows explicit connector metadata with an address index", () => {
    const connector = createConnector({
      mnemonic: TEST_MNEMONIC,
      addressIndex: 1,
      id: "qa-wallet",
      name: "QA Wallet",
    })

    expect(connector.id).toBe("qa-wallet")
    expect(connector.name).toBe("QA Wallet")
  })

  test("does not allow an address index with a private key", () => {
    expectTypeOf<{
      privateKey: `0x${string}`
      addressIndex: number
    }>().not.toMatchTypeOf<CreateTestWalletOptions>()
  })

  test("rejects an address index with a private key at runtime", () => {
    expect(() =>
      createConnector({
        privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        addressIndex: 1,
      } as unknown as Parameters<typeof createTestWalletConnector>[0]),
    ).toThrow("addressIndex requires mnemonic")
  })
})
