import type { AppProps } from 'next/app';
import Head from 'next/head';
import { Navbar } from '../components/Navbar';
import { AuthModal } from '../components/AuthModal';
import { CommandPalette } from '../components/CommandPalette';
import { AuthProvider } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';
import '../styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Coding Harness</title>
        <meta
          name="description"
          content="Inspect repositories, run coding tasks, and generate clean Git diffs."
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </Head>
      <ToastProvider>
        <AuthProvider>
          <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans">
            {/* Ultra-subtle top ambient blue edge wash — restrained, not neon */}
            <div
              className="pointer-events-none fixed inset-x-0 top-0 h-[360px] z-0"
              style={{
                background:
                  'radial-gradient(60% 100% at 50% 0%, rgba(37, 99, 235, 0.08) 0%, rgba(9, 9, 11, 0) 100%)',
              }}
              aria-hidden="true"
            />
            <Navbar />
            <main className="relative z-10 flex-1">
              <Component {...pageProps} />
            </main>
            <AuthModal />
            <CommandPalette />
          </div>
        </AuthProvider>
      </ToastProvider>
    </>
  );
}
