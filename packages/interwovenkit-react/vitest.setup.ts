import BigNumber from "bignumber.js"

// Enable strict mode so every test acts as a regression check against
// re-introducing empty-string or otherwise invalid BigNumber inputs.
// Mirrors the default behavior consumers get on bignumber.js@>=10.
BigNumber.DEBUG = true
