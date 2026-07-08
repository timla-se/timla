import type { ReactNode } from 'react'
import { StrictMode, useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { createRoot } from 'react-dom/client'
import { ClerkProvider, useAuth } from '@clerk/react'
import { Theme } from '@radix-ui/themes'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'

import App from './App'
import SvarView from './pages/SvarView'
import { setTokenGetter } from './api'

import '@fontsource-variable/hanken-grotesk'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@radix-ui/themes/styles.css'
import '@swedev/ui/styles.css'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

const themeProps = {
  accentColor: 'amber',
  grayColor: 'sand',
  radius: 'large',
  // panelBackground="solid": Radix panels default to translucent and would
  // ignore the --color-panel-solid override.
  panelBackground: 'solid',
} as const

/** Bridges Clerk's session token into api.ts so every request carries the
 * current bearer (issue #3), and clears React Query's cache on sign-out. */
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

/** The authenticated manager app. Clerk (and the publishable-key requirement)
 * live here so the public /svar link page needs neither (issue #13). */
function AuthedRoot() {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
  if (!publishableKey) {
    throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY (frontend/.env.local for dev, or the Docker build arg)')
  }
  return (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      <QueryClientProvider client={queryClient}>
        <Theme {...themeProps}>
          <BrowserRouter>
            <ClerkBridge>
              <App />
            </ClerkBridge>
          </BrowserRouter>
        </Theme>
      </QueryClientProvider>
    </ClerkProvider>
  )
}

/** The login-free staff share-link page. No ClerkProvider — a forwardable
 * public token URL must not mount third-party auth or depend on the Clerk key
 * (issue #13). */
function SvarRoot() {
  return (
    <QueryClientProvider client={queryClient}>
      <Theme {...themeProps}>
        <BrowserRouter>
          <Routes>
            <Route path="/svar/:token" element={<SvarView />} />
          </Routes>
        </BrowserRouter>
      </Theme>
    </QueryClientProvider>
  )
}

const isSvar = window.location.pathname.startsWith('/svar/')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isSvar ? <SvarRoot /> : <AuthedRoot />}</StrictMode>,
)
