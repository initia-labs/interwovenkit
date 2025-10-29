import ky from "ky"
import { useSignMessage } from "wagmi"
import { useInitiaAddress } from "@/public/data/hooks"
import { AUTH_SESSION_STORAGE_KEY, INTERWOVENKIT_API_URL, SESSION_DURATION } from "./constants"

interface AuthSession {
  signature: string
  expiresAt: string
}

// generate ky client for backend requests
export function useBackend() {
  const initiaAddress = useInitiaAddress()
  const { signMessageAsync } = useSignMessage()
  const localStorageKey = `${AUTH_SESSION_STORAGE_KEY}:${initiaAddress}`

  function getStoredAuthSession(): AuthSession | null {
    if (localStorage.getItem(localStorageKey)) {
      const session = JSON.parse(localStorage.getItem(localStorageKey)!) as AuthSession
      if (new Date(session.expiresAt).getTime() > Date.now()) {
        return session
      }
    }
    return null
  }

  async function getAuthSession(): Promise<AuthSession> {
    const storedSession = getStoredAuthSession()
    if (storedSession) return storedSession

    const expiration = new Date(Date.now() + SESSION_DURATION).toISOString()

    const { message } = await ky
      .get("auto-sign/get-message", {
        prefixUrl: INTERWOVENKIT_API_URL,
        headers: {
          "x-expiration": expiration,
        },
      })
      .json<{ message: string }>()

    const signature = await signMessageAsync({ message })

    const sessions = {
      signature,
      expiresAt: expiration,
    }

    localStorage.setItem(localStorageKey, JSON.stringify(sessions))
    return sessions
  }

  // client for authenticated requests
  async function getAuthClient() {
    const { signature, expiresAt } = await getAuthSession()

    return ky.create({
      prefixUrl: INTERWOVENKIT_API_URL,
      headers: {
        "user-address": initiaAddress,
        "auth-signature": signature,
        "x-expiration": expiresAt,
      },
    })
  }

  // simple client for requests that don't require authentication
  async function getClient() {
    return ky.create({
      prefixUrl: INTERWOVENKIT_API_URL,
    })
  }

  return { getAuthClient, getClient }
}
