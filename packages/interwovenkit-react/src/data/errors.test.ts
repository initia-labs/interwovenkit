import ky from "ky"
import type { Chain } from "@initia/initia-registry-types"
import { parseMoveError, formatMoveError, clearErrorCache, MoveError } from "./errors"

vi.mock("ky")

describe("Move Error Handling", () => {
  beforeEach(() => {
    clearErrorCache()
    vi.clearAllMocks()
  })

  describe("parseMoveError", () => {
    test("should parse valid move error", () => {
      const error =
        "VM aborted: location=0000000000000000000000000000000000000000000000000000000000000001::fungible_asset, code=65540"
      const result = parseMoveError(error)

      expect(result).toEqual({
        moduleAddress: "0x1",
        moduleName: "fungible_asset",
        errorCode: "65540",
      })
    })

    test("should handle module address without leading zeros", () => {
      const error = "VM aborted: location=1234abcd::my_module, code=123"
      const result = parseMoveError(error)

      expect(result).toEqual({
        moduleAddress: "0x1234abcd",
        moduleName: "my_module",
        errorCode: "123",
      })
    })

    test("should handle error code without leading zeros", () => {
      const error = "VM aborted: location=1::module, code=00001"
      const result = parseMoveError(error)

      expect(result).toEqual({
        moduleAddress: "0x1",
        moduleName: "module",
        errorCode: "1",
      })
    })

    test("should return null for non-move errors", () => {
      const errors = [
        "Regular error message",
        "VM error but wrong format",
        "location=123::module without proper prefix",
        "",
      ]

      errors.forEach((error) => {
        expect(parseMoveError(error)).toBeNull()
      })
    })

    test("should handle all zeros in address", () => {
      const error =
        "VM aborted: location=0000000000000000000000000000000000000000000000000000000000000000::module, code=1"
      const result = parseMoveError(error)

      expect(result).toEqual({
        moduleAddress: "0x0",
        moduleName: "module",
        errorCode: "1",
      })
    })
  })

  describe("formatMoveError", () => {
    const mockChainL1: Chain = {
      chain_name: "initia",
      chain_id: "initia-1",
      metadata: { is_l1: true },
    } as Chain

    const mockChainMinimove: Chain = {
      chain_name: "minimove-1",
      chain_id: "minimove-1",
      metadata: { minitia: { type: "minimove" } },
    } as Chain

    const mockChainOther: Chain = {
      chain_name: "other",
      chain_id: "other-1",
      metadata: {},
    } as Chain

    const registryUrl = "https://registry.initia.xyz"

    test("should return original error for non-L1 and non-minimove chains", async () => {
      const error = new Error("VM aborted: location=1::module, code=1")
      const result = await formatMoveError(error, mockChainOther, registryUrl)

      expect(result).toBe(error)
    })

    test("should return original error for non-move errors", async () => {
      const error = new Error("Regular error")
      const result = await formatMoveError(error, mockChainL1, registryUrl)

      expect(result).toBe(error)
    })

    test("should fetch and use error message from registry for 0x1", async () => {
      const mockErrorData = {
        errors: {
          fungible_asset: {
            "65540": "Insufficient balance",
          },
        },
      }

      vi.mocked(ky.get).mockReturnValue({
        json: vi.fn().mockResolvedValue(mockErrorData),
      } as unknown as ReturnType<typeof ky.get>)

      const error = new Error(
        "VM aborted: location=0000000000000000000000000000000000000000000000000000000000000001::fungible_asset, code=65540",
      )
      const result = await formatMoveError(error, mockChainL1, registryUrl)

      expect(result).toBeInstanceOf(MoveError)
      const moveError = result as MoveError
      expect(moveError.message).toBe("Insufficient balance")
      expect(moveError.originalError).toBe(error)
      expect(moveError.moduleAddress).toBe("0x1")
      expect(moveError.moduleName).toBe("fungible_asset")
      expect(moveError.errorCode).toBe("65540")

      expect(ky.get).toHaveBeenCalledWith(`${registryUrl}/errors/0x1.json`)
    })

    test("should fetch from chain-specific path for non-0x1 addresses", async () => {
      const mockErrorData = {
        errors: {
          custom_module: {
            "123": "Custom error message",
          },
        },
      }

      vi.mocked(ky.get).mockReturnValue({
        json: vi.fn().mockResolvedValue(mockErrorData),
      } as unknown as ReturnType<typeof ky.get>)

      const error = new Error("VM aborted: location=abcd1234::custom_module, code=123")
      const result = await formatMoveError(error, mockChainL1, registryUrl)

      expect(result).toBeInstanceOf(MoveError)
      const moveError = result as MoveError
      expect(moveError.message).toBe("Custom error message")
      expect(moveError.moduleAddress).toBe("0xabcd1234")

      expect(ky.get).toHaveBeenCalledWith(`${registryUrl}/errors/initia/0xabcd1234.json`)
    })

    test("should use default message when error code not found in registry", async () => {
      const mockErrorData = {
        errors: {
          fungible_asset: {
            "999": "Different error",
          },
        },
      }

      vi.mocked(ky.get).mockReturnValue({
        json: vi.fn().mockResolvedValue(mockErrorData),
      } as unknown as ReturnType<typeof ky.get>)

      const error = new Error("VM aborted: location=1::fungible_asset, code=65540")
      const result = await formatMoveError(error, mockChainL1, registryUrl)

      expect(result).toBeInstanceOf(MoveError)
      const moveError = result as MoveError
      expect(moveError.message).toBe("Failed with code 0x10004 in module fungible_asset at 0x1")
    })

    test("should use default message when module not found in registry", async () => {
      const mockErrorData = {
        errors: {
          other_module: {
            "65540": "Some error",
          },
        },
      }

      vi.mocked(ky.get).mockReturnValue({
        json: vi.fn().mockResolvedValue(mockErrorData),
      } as unknown as ReturnType<typeof ky.get>)

      const error = new Error("VM aborted: location=1::fungible_asset, code=65540")
      const result = await formatMoveError(error, mockChainL1, registryUrl)

      expect(result).toBeInstanceOf(MoveError)
      const moveError = result as MoveError
      expect(moveError.message).toBe("Failed with code 0x10004 in module fungible_asset at 0x1")
    })

    test("should use default message when registry fetch fails", async () => {
      vi.mocked(ky.get).mockRejectedValue(new Error("Network error"))

      const error = new Error("VM aborted: location=1::module, code=123")
      const result = await formatMoveError(error, mockChainL1, registryUrl)

      expect(result).toBeInstanceOf(MoveError)
      const moveError = result as MoveError
      expect(moveError.message).toBe("Failed with code 0x7b in module module at 0x1")
    })

    test("should cache registry responses", async () => {
      const mockErrorData = {
        errors: {
          module: {
            "1": "Error message",
          },
        },
      }

      vi.mocked(ky.get).mockReturnValue({
        json: vi.fn().mockResolvedValue(mockErrorData),
      } as unknown as ReturnType<typeof ky.get>)

      const error1 = new Error("VM aborted: location=1::module, code=1")
      const error2 = new Error("VM aborted: location=1::module, code=1")

      await formatMoveError(error1, mockChainL1, registryUrl)
      await formatMoveError(error2, mockChainL1, registryUrl)

      expect(ky.get).toHaveBeenCalledTimes(1)
    })

    test("should work with minimove chains", async () => {
      const mockErrorData = {
        errors: {
          module: {
            "1": "Minimove error",
          },
        },
      }

      vi.mocked(ky.get).mockReturnValue({
        json: vi.fn().mockResolvedValue(mockErrorData),
      } as unknown as ReturnType<typeof ky.get>)

      const error = new Error("VM aborted: location=1::module, code=1")
      const result = await formatMoveError(error, mockChainMinimove, registryUrl)

      expect(result).toBeInstanceOf(MoveError)
      const moveError = result as MoveError
      expect(moveError.message).toBe("Minimove error")
    })

    test("should convert decimal error code to hex in default message", () => {
      const testCases = [
        { decimal: "1", hex: "0x1" },
        { decimal: "10", hex: "0xa" },
        { decimal: "255", hex: "0xff" },
        { decimal: "65540", hex: "0x10004" },
        { decimal: "1000000", hex: "0xf4240" },
      ]

      testCases.forEach(({ decimal, hex }) => {
        const errorCodeHex = `0x${parseInt(decimal, 10).toString(16)}`
        expect(errorCodeHex).toBe(hex)
      })
    })
  })
})
