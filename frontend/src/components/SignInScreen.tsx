import { SignIn } from '@clerk/react'
import { Flex } from '@radix-ui/themes'

import { clerkAuthAppearance } from '../clerkAppearance'
import { Lockup } from './Lockup'

/**
 * Sign-in landing for unauthenticated visitors (issue #3), styled per
 * design/Timla Auth.dc.html's "Logga in" screen: a floating 980px card
 * (dark ink brand panel with the lockup + tagline, white form panel) on
 * a cream page background. Clerk's inline <SignIn> renders its own card
 * chrome by default (shadow/radius/background on cl-card/cl-cardBox) —
 * that's stripped via clerkAuthAppearance so it sits flush inside ours
 * rather than nesting a second boxed card inside it. The mockup's own
 * e-mail/password/BankID form fields are replaced by Clerk's component —
 * see the plan's Design Decision 3. signUpUrl keeps "Don't have an
 * account?" in-app (SignUpScreen) instead of bouncing to Clerk's
 * unstyled hosted Account Portal.
 */
export default function SignInScreen() {
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
            <h1 className="m-0 mb-3.5 max-w-[14ch] text-[34px] font-extrabold leading-[1.1] tracking-[-.03em] text-white">
              Tid, bokning &amp; schema — samlat.
            </h1>
            <p className="m-0 max-w-[34ch] text-[15px] leading-relaxed text-[#c9bdaa]">
              Logga in för att hantera dina bokningar, scheman och resurser.
            </p>
          </div>
        </Flex>
        <Flex align="center" justify="center" className="shrink-0 bg-white">
          <SignIn routing="hash" signUpUrl="/sign-up" appearance={clerkAuthAppearance} />
        </Flex>
      </Flex>
    </Flex>
  )
}
