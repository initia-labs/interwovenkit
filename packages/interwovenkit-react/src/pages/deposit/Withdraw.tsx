import TransferFlow from "./wallet/TransferFlow"

// /withdraw route: not a deposit-hub method, so it lives at the deposit root
// instead of a method folder. The TransferFlow engine it wraps lives in
// wallet/ — withdraw, like the wallet method, is a transfer signed by the
// connected wallet.
export const Withdraw = () => {
  return <TransferFlow mode="withdraw" />
}

export default Withdraw
