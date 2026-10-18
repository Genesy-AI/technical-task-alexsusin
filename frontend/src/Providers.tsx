import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { FC, PropsWithChildren } from 'react'
import { Toaster } from 'react-hot-toast'

const queryClient = new QueryClient()

export const Providers: FC<PropsWithChildren> = ({ children }) => {
  return (
    <QueryClientProvider client={queryClient}>
      <ReactQueryDevtools initialIsOpen={false} />
      <Toaster
        position="top-right"
        gutter={8}
        containerClassName="!top-5 !right-5"
        toastOptions={{
          duration: 4000,
          className:
            'bg-white/95 text-gray-700 border border-gray-200/30 rounded-xl shadow-xl backdrop-blur-md text-sm font-medium px-4 py-3 max-w-sm',
          success: {
            duration: 3000,
            className:
              'bg-green-50/95 text-emerald-700 border border-emerald-200/20 rounded-xl shadow-xl backdrop-blur-md text-sm font-medium px-4 py-3 max-w-sm',
            iconTheme: {
              primary: '#10b981',
              secondary: '#ffffff',
            },
          },
          error: {
            duration: 5000,
            className:
              'bg-red-50/95 text-red-700 border border-red-200/20 rounded-xl shadow-xl backdrop-blur-md text-sm font-medium px-4 py-3 max-w-sm',
            iconTheme: {
              primary: '#ef4444',
              secondary: '#ffffff',
            },
          },
          loading: {
            // Loading toasts stay until they are replaced by the outcome; otherwise they inherit the 4s default.
            duration: Infinity,
            className:
              'bg-gray-50/95 text-gray-600 border border-gray-200/30 rounded-xl shadow-xl backdrop-blur-md text-sm font-medium px-4 py-3 max-w-sm',
            iconTheme: {
              primary: '#6b7280',
              secondary: '#ffffff',
            },
          },
        }}
      />
      {children}
    </QueryClientProvider>
  )
}
