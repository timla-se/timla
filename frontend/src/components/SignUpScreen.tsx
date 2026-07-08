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
      <Flex className="max-w-full overflow-hidden rounded-[22px] border border-warm-border shadow-[0_24px_70px_rgb(90_60_20/0.18)]">
        <Flex
          direction="column"
          justify="between"
          className="hidden w-[400px] shrink-0 bg-ink p-[46px_42px] md:flex"
        >
          <Lockup variant="cream" className="h-[30px] w-auto" />
          <div>
            <h1 className="m-0 mb-5 max-w-[15ch] text-[34px] font-extrabold leading-[1.1] tracking-[-.03em] text-white">
              Kom igång på några minuter.
            </h1>
            <p className="m-0 max-w-[34ch] text-[15px] leading-relaxed text-[#c9bdaa]">
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
