import Button from "@/components/Button"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import { useNavigate } from "@/lib/router"

const FooterWithError = ({ error }: { error: Error }) => {
  const navigate = useNavigate()

  return (
    <Footer extra={<FormHelp level="error">{error.message}</FormHelp>}>
      <Button.White onClick={() => navigate("/bridge")}>Home</Button.White>
    </Footer>
  )
}

export default FooterWithError
