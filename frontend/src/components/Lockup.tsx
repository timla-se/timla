/** The Timla lockup, inlined. The SVG assets draw the wordmark with a
 * <text> element; loaded via <img> they are separate documents without
 * access to the app's @font-face fonts, so "timla" would fall back to the
 * renderer's default font. Inline SVG shares the document's fonts.
 * Geometry mirrors public/timla-lockup.svg — keep them in sync. */
export function Lockup({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 166 48"
      fill="none"
      role="img"
      aria-label="Timla"
      className={className}
    >
      <g transform="rotate(-90 24 24)">
        <rect x="12" y="14" width="5.5" height="24" rx="2.75" fill="#231d16" />
        <rect x="21.25" y="23" width="5.5" height="15" rx="2.75" fill="#e69a2e" />
        <circle cx="24" cy="17" r="2.9" fill="#e69a2e" />
        <rect x="30.5" y="19" width="5.5" height="19" rx="2.75" fill="#231d16" />
      </g>
      <text
        x="47"
        y="36"
        fontWeight="800"
        fontSize="40"
        letterSpacing="-1.8"
        fill="#231d16"
        fontFamily="var(--font-sans)"
      >
        timla
      </text>
    </svg>
  )
}
