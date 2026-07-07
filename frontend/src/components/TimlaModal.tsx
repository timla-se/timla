import type { ReactNode } from 'react'
import { Dialog, VisuallyHidden } from '@radix-ui/themes'
import { X } from 'lucide-react'

/** Modal chrome per the Personal design (design/Timla App - Personal.dc.html):
 * paper panel radius 20, header with an icon square + title + subtitle and
 * a soft close button, footer band #faf3e6 with right-aligned actions.
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
          border: '1px solid #e4d9c2',
          boxShadow: '0 30px 90px rgb(35 29 22 / 0.4)',
          overflow: 'auto',
        }}
      >
        <VisuallyHidden>
          <Dialog.Title>{title}</Dialog.Title>
        </VisuallyHidden>
        <div className="flex items-start justify-between gap-4 border-b border-[#ecdfc8] px-[30px] pb-5 pt-7">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink text-cream">
              {icon}
            </div>
            <div>
              <h2 className="m-0 mb-0.5 text-[22px] font-extrabold tracking-[-.025em]">{title}</h2>
              {subtitle && <p className="m-0 text-[13.5px] text-warm-gray">{subtitle}</p>}
            </div>
          </div>
          <button
            aria-label="Stäng"
            onClick={onClose}
            className="flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-[9px] border-0 bg-[#f2e8d5] text-warm-gray"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className="px-[30px] py-6">{children}</div>
        <div className="flex items-center justify-end gap-2.5 rounded-b-[20px] border-t border-[#ecdfc8] bg-[#faf3e6] px-[30px] py-[18px]">
          {footer}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}

/** Etikett field label per the design's modal forms. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="etikett mb-[7px] block">{children}</span>
}
