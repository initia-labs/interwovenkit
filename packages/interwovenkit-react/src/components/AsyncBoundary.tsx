import type { PropsWithChildren, ReactNode } from "react"
import { Suspense } from "react"
import type { ErrorBoundaryProps } from "react-error-boundary"
import { ErrorBoundary } from "react-error-boundary"
import Status from "./Status"

interface Props {
  errorBoundaryProps?: ErrorBoundaryProps
  suspenseFallback?: ReactNode
}

const AsyncBoundary = ({
  errorBoundaryProps = { fallbackRender: ({ error }) => <Status error>{error.message}</Status> },
  suspenseFallback = <Status>Loading...</Status>,
  children,
}: PropsWithChildren<Props>) => {
  return (
    <ErrorBoundary {...errorBoundaryProps}>
      <Suspense fallback={suspenseFallback}>{children}</Suspense>
    </ErrorBoundary>
  )
}

export default AsyncBoundary
