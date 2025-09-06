import ky from "ky"
import type { Chain } from "@initia/initia-registry-types"

export interface ParsedMoveError {
  moduleAddress: string
  moduleName: string
  errorCode: string
}

export class MoveError extends Error {
  originalError: Error
  moduleAddress: string
  moduleName: string
  errorCode: string
  errorCodeHex: string
  isFromRegistry: boolean

  constructor(
    message: string,
    originalError: Error,
    moduleAddress: string,
    moduleName: string,
    errorCode: string,
    errorCodeHex: string,
    isFromRegistry: boolean,
  ) {
    super(message)
    this.name = "MoveError"
    this.originalError = originalError
    this.moduleAddress = moduleAddress
    this.moduleName = moduleName
    this.errorCode = errorCode
    this.errorCodeHex = errorCodeHex
    this.isFromRegistry = isFromRegistry
  }
}

const MOVE_ERROR_REGEX = /VM aborted: location=([0-9A-Fa-f]+)::(\w+), code=(\d+)/

const errorCache = new Map<string, Record<string, Record<string, string>>>()

export function parseMoveError(error: string): ParsedMoveError | null {
  const match = error.match(MOVE_ERROR_REGEX)
  if (!match) return null

  const [, moduleAddress, moduleName, errorCode] = match

  return {
    moduleAddress: `0x${moduleAddress.replace(/^0+/, "") || "0"}`,
    moduleName,
    errorCode: errorCode.replace(/^0+/, "") || "0",
  }
}

async function fetchErrorRegistry(
  chainName: string,
  moduleAddress: string,
  registryUrl: string,
): Promise<Record<string, Record<string, string>> | null> {
  const cacheKey = `${chainName}:${moduleAddress}`

  if (errorCache.has(cacheKey)) {
    return errorCache.get(cacheKey)!
  }

  try {
    const fileName = moduleAddress === "0x1" ? "0x1.json" : `${chainName}/${moduleAddress}.json`
    const url = `${registryUrl}/errors/${fileName}`

    const { errors = {} } = await ky
      .get(url)
      .json<{ errors: Record<string, Record<string, string>> }>()

    errorCache.set(cacheKey, errors)
    return errors
  } catch {
    return null
  }
}

function createMoveError(
  message: string,
  originalError: Error,
  moduleAddress: string,
  moduleName: string,
  errorCode: string,
  errorCodeHex: string,
  isFromRegistry: boolean,
): MoveError {
  return new MoveError(
    message,
    originalError,
    moduleAddress,
    moduleName,
    errorCode,
    errorCodeHex,
    isFromRegistry,
  )
}

export async function formatMoveError(
  error: Error,
  chain: Chain,
  registryUrl: string,
): Promise<Error> {
  if (!chain.metadata?.is_l1 && chain.metadata?.minitia?.type !== "minimove") {
    return error
  }

  const parsed = parseMoveError(error.message)
  if (!parsed) return error

  const errorRegistry = await fetchErrorRegistry(
    chain.chain_name,
    parsed.moduleAddress,
    registryUrl,
  )

  const errorCodeHex = `0x${parseInt(parsed.errorCode, 10).toString(16)}`
  const defaultMessage = `Failed with code ${errorCodeHex} in module ${parsed.moduleName} at ${parsed.moduleAddress}`

  const registryMessage = errorRegistry?.[parsed.moduleName]?.[parsed.errorCode]
  const message = registryMessage || defaultMessage
  const isFromRegistry = !!registryMessage

  return createMoveError(
    message,
    error,
    parsed.moduleAddress,
    parsed.moduleName,
    parsed.errorCode,
    errorCodeHex,
    isFromRegistry,
  )
}

export function clearErrorCache() {
  errorCache.clear()
}
