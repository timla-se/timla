import type { ReactNode } from 'react'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { ClerkProvider, useAuth } from '@clerk/react'
import { Theme } from '@radix-ui/themes'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'

import App from './App'
import { setTokenGetter } from './api'

import '@fontsource-variable/hanken-grotesk'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@radix-ui/themes/styles.css'
import '@swedev/ui/styles.css'
import './index.css'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in frontend/.env.local')
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

/** Bridges Clerk's session token into api.ts so every request carries the
 * current bearer (issue #3), and clears React Query's cache on sign-out —
 * otherwise the previous user's org/staff/shifts stay visible even though
 * every refetch would now 401/403. */
function ClerkBridge({ children }: { children: ReactNode }) {
  const { getToken, isSignedIn } = useAuth()
  const rqClient = useQueryClient()

  useEffect(() => {
    setTokenGetter(() => getToken())
  }, [getToken])

  useEffect(() => {
    if (isSignedIn === false) rqClient.clear()
  }, [isSignedIn, rqClient])

  return children
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
      <QueryClientProvider client={queryClient}>
        {/* panelBackground="solid": Radix panels default to translucent and
            would ignore the --color-panel-solid override */}
        <Theme accentColor="amber" grayColor="sand" radius="large" panelBackground="solid">
          <BrowserRouter>
            <ClerkBridge>
              <App />
            </ClerkBridge>
          </BrowserRouter>
        </Theme>
      </QueryClientProvider>
    </ClerkProvider>
  </StrictMode>,
)
