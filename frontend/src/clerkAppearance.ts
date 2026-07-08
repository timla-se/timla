/** Shared Clerk appearance for SignInScreen/SignUpScreen: strips Clerk's own
 * card chrome (border/shadow/background — cl-cardBox and cl-card carry these
 * by default) so the form sits flush on our own panel instead of looking
 * like its own boxed product floating inside ours ("modal in modal").
 *
 * These MUST be style objects, not className strings: Clerk applies its own
 * card/cardBox/footer styling with enough specificity that an added
 * Tailwind class is outweighed rather than overriding it (confirmed via
 * getComputedStyle in the browser — a className-string version left the
 * box-shadow and border-radius in place). */
export const clerkAuthAppearance = {
  elements: {
    cardBox: { boxShadow: 'none', border: 'none', borderRadius: 0 },
    card: {
      boxShadow: 'none',
      border: 'none',
      borderRadius: 0,
      backgroundColor: 'transparent',
    },
    footer: { backgroundColor: 'transparent', boxShadow: 'none', border: 'none' },
    footerAction: { backgroundColor: 'transparent' },
  },
}
