import { SignUp } from '@clerk/react'
import { Flex } from '@radix-ui/themes'

import { clerkAuthAppearance } from '../clerkAppearance'
import { Lockup } from './Lockup'

/**
 * Sign-up landing (issue #3), styled per design/Timla Auth.dc.html's
 * "Skapa konto" screen: a floating 980px card on a cream page background
 * — see SignInScreen for why Clerk's own card chrome is stripped via
 * clerkAuthAppearance rather than left to nest inside ours. signInUrl
 * keeps "Already have an account?" in-app (SignInScreen) instead of
 * Clerk's hosted Account Portal.
 */
export default function SignUpScreen() {
  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh' }} className="bg-paper">
      <Flex className="max-w-full overflow-hidden rounded-20 border border-warm-border shadow-[0_24px_70px_rgb(90_60_20/0.18)]">
        <Flex
          direction="column"
          justify="between"
          className="hidden w-100 shrink-0 bg-ink px-10.5 py-11.5 md:flex"
        >
          <Lockup variant="cream" className="h-7.5 w-auto" />
          <div>
            <h1 className="m-0 mb-5 max-w-[15ch] text-30 font-extrabold leading-none tracking-tight text-white">
              Kom igång på några minuter.
            </h1>
            <p className="m-0 max-w-[34ch] text-15 leading-relaxed text-sidebar-muted">
              Skapa ett konto, sätt upp din verksamhet och bjud in kollegor sen.
            </p>
          </div>
        </Flex>
        <Flex align="center" justify="center" className="shrink-0 bg-white">
          <SignUp routing="hash" signInUrl="/sign-in" appearance={clerkAuthAppearance} />
        </Flex>
      </Flex>
    </Flex>
  )
}
