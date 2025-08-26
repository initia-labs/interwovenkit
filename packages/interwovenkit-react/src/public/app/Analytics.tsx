import { useAnalyticsInit, useAnalyticsIdentify } from "@/data/analytics"

const Analytics = () => {
  useAnalyticsInit()
  useAnalyticsIdentify()
  return null
}

export default Analytics
