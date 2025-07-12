import { LegacyLocalStorageKey, LegacyLocalStorageObject } from "./constants"

export function migrateLegacyLocalStorage() {
  Object.entries(LegacyLocalStorageKey).forEach(([legacyKey, newKey]) => {
    const value = localStorage.getItem(legacyKey)
    if (value) {
      localStorage.setItem(newKey, value)
      localStorage.removeItem(legacyKey)
    }
  })

  Object.entries(LegacyLocalStorageObject).forEach(([legacyKey, newKey]) => {
    const value = localStorage.getItem(legacyKey)
    if (value) {
      Object.entries(JSON.parse(value) as Record<string, string>).forEach(([key, value]) => {
        localStorage.setItem(`${newKey}:${key}`, value)
      })
    }
    localStorage.removeItem(legacyKey)
  })
}
