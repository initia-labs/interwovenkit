// FIXME: https://github.com/pmndrs/react-spring/issues/2358#issuecomment-2685163711

import reactSpring from "@react-spring/web"

declare module "@react-spring/web" {
  const animated = {
    children: React.ReactNode,
    ...reactSpring.animated,
  }
}
