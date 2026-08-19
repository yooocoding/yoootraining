import type { Metadata } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import Nav from '@/components/Nav';
import './globals.css';

// Self-hosted at build time — no runtime request to Google.
// Latin only; CJK falls through to the system stack in --mono.
// Mono carries everything, headers included — hierarchy comes from size and
// opacity, so there is deliberately no second face.
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'yoootraining',
  description: 'Personal training & check-in tracker',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={mono.variable}>
      <body>
        <div className="shell">
          <Nav />
          {children}
          <div className="signoff">yoootraining</div>
        </div>
      </body>
    </html>
  );
}
