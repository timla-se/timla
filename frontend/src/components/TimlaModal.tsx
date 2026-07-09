import type { ReactNode } from 'react'
import { Dialog, VisuallyHidden } from '@radix-ui/themes'
import { X } from 'lucide-react'

/** Modal chrome per the Personal design (design/Timla App - Personal.dc.html):
 * paper panel radius 20, header with an icon square + title + subtitle and
 * a soft close button, footer band (--color-band) with right-aligned actions.
 * Radix Dialog supplies portal/focus-trap/escape; the design supplies the
 * skin, so the swedev Modal chrome is bypassed on purpose. */
export function TimlaModal({ open, onClose, icon, title, subtitle, footer, width = 580, children }: {
  open: boolean
  onClose: () => void
  /** Rendered inside the 44px ink icon square. */
  icon: ReactNode
  title: string
  subtitle?: string
  footer: ReactNode
  width?: number
  children: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Content
        aria-describedby={undefined}
        style={{
          width,
          maxWidth: '100%',
          padding: 0,
          background: 'var(--paper)',
          borderRadius: 20,
          border: '1px solid var(--color-warm-line-strong)',
          boxShadow: '0 30px 90px rgb(35 29 22 / 0.4)',
          overflow: 'auto',
        }}
      >
        <VisuallyHidden>
          <Dialog.Title>{title}</Dialog.Title>
        </VisuallyHidden>
        <div className="flex items-start justify-between gap-4 border-b border-warm-line px-7.5 pb-5 pt-7">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink text-cream">
              {icon}
            </div>
            <div>
              <h2 className="m-0 mb-0.5 text-22 font-extrabold tracking-tight">{title}</h2>
              {subtitle && <p className="m-0 text-13 text-warm-gray">{subtitle}</p>}
            </div>
          </div>
          <button
            aria-label="Stäng"
            onClick={onClose}
            className="flex h-8.5 w-8.5 shrink-0 cursor-pointer items-center justify-center rounded-10 border-0 bg-chip text-warm-gray"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className="px-7.5 py-6">{children}</div>
        <div className="flex items-center justify-end gap-2.5 rounded-b-20 border-t border-warm-line bg-band px-7.5 py-4.5">
          {footer}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}

/** Etikett field label per the design's modal forms. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="etikett mb-2 block">{children}</span>
}
