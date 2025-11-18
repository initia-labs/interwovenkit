import { IconExternalLink } from "@initia/icons-react"
import SettingItem from "./SettingItem"

const PRIVY_EXPORT_URL = "https://export.initia.xyz/"

const ExportPrivateKey = () => {
  const windowFeatures = "width=600,height=768,scrollbars=yes,resizable=yes"

  return (
    <SettingItem
      title="Export private key"
      rightSection={<IconExternalLink size={16} />}
      onClick={() => window.open(PRIVY_EXPORT_URL, "_blank", windowFeatures)}
    />
  )
}

export default ExportPrivateKey
