import BigNumber from "bignumber.js"

// Enable strict mode so every test acts as a regression check against
// re-introducing empty-string or otherwise invalid BigNumber inputs.
// v9 throws on invalid input when `DEBUG = true`; v10 made that the default
// (DEBUG removed); v11 reaches the same default via
// `BigNumber.config({ STRICT: true })`. Setting DEBUG is meaningful on v9
// only and a no-op on v10+, but the cast keeps the assignment
// type-compatible across all peer-dep versions (>=9).
;(BigNumber as unknown as { DEBUG?: boolean }).DEBUG = true
