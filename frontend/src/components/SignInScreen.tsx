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
      <Flex className="max-w-full overflow-hidden rounded-20 border border-warm-border shadow-[0_24px_70px_rgb(90_60_20/0.18)]">
        <Flex
          direction="column"
          justify="between"
          className="hidden w-100 shrink-0 bg-ink px-10.5 py-11.5 lg:flex"
        >
          <Lockup variant="cream" className="h-7.5 w-auto" />
          <div>
            <h1 className="m-0 mb-3.5 max-w-[14ch] text-30 font-extrabold leading-none tracking-tight text-white">
              Tid, bokning &amp; schema — samlat.
            </h1>
            <p className="m-0 max-w-[34ch] text-15 leading-relaxed text-sidebar-muted">
              Logga in för att hantera dina bokningar, scheman och resurser.
            </p>
          </div>
        </Flex>
        {/* Fixed footprint: Clerk's steps (e-mail → password → code) differ in
            height, and without a reserved size the whole card jumps (#54).
            The panel may shrink below w-120 (and the brand panel waits for
            lg:) so the 880px pair never clips on 768–880px viewports. */}
        <Flex align="center" justify="center" className="min-h-144 w-120 min-w-0 max-w-full bg-white">
          <SignIn routing="hash" signUpUrl="/sign-up" appearance={clerkAuthAppearance} />
        </Flex>
      </Flex>
    </Flex>
  )
}
