export const normalizeWalletName = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replace(/\s+(wallet|extension|app)$/, "")
