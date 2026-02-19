import type { FeeJson } from "@skip-go/client"
import FormattedAmount from "./FormattedAmount"

interface Props {
  fees: FeeJson[]
}

const FormattedFeeList = ({ fees }: Props) => {
  return fees.map((fee, index) => (
    <span key={`${fee.origin_asset.denom}-${index}`}>
      {index > 0 && ", "}
      <FormattedAmount amount={fee.amount} decimals={fee.origin_asset.decimals ?? 0} />{" "}
      {fee.origin_asset.symbol}
    </span>
  ))
}

export default FormattedFeeList
