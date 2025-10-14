import { useAnalyticsIdentify, useAnalyticsInit } from "@/data/analytics"

const Analytics = () => {
  useAnalyticsInit()
  useAnalyticsIdentify()
  return null
}

export default Analytics
