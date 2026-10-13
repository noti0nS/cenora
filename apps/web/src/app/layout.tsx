import type { Metadata, Viewport } from 'next';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/600.css';
import '@fontsource/nunito-sans/700.css';
import './globals.css';
import './cenora.css';
import './landing.css';
import './avatars.css';
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f2eb' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0d' },
  ],
};
export const metadata: Metadata = {
  title: 'Cenora · filmes e séries em boa companhia',
  description: 'A estante de filmes e séries da sua turma: assista, acompanhe e dê nota.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Cenora',
    statusBarStyle: 'black-translucent',
  },
  robots: { index: false, follow: false },
  icons: {
    icon: { url: '/favicon.svg', type: 'image/svg+xml', sizes: 'any' },
    apple: { url: '/cenora-mark.svg', type: 'image/svg+xml', sizes: 'any' },
  },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{document.documentElement.dataset.theme=localStorage.getItem('watchlist:theme')||'dark'}catch(e){}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
