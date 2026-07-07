import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { Theme } from '@radix-ui/themes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import App from './App'

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* panelBackground="solid": Radix panels default to translucent and
          would ignore the --color-panel-solid override */}
      <Theme accentColor="amber" grayColor="sand" radius="large" panelBackground="solid">
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </Theme>
    </QueryClientProvider>
  </StrictMode>,
)
