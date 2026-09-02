import type { Metadata } from 'next';
import { Outfit, DM_Sans } from 'next/font/google';
import './globals.css';

const outfit = Outfit({ 
  subsets: ['latin'], 
  variable: '--font-outfit',
  display: 'swap'
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'FotoBareng - Public Multiplayer Photobooth',
  description: 'Buat room, kirim link ke teman, lalu foto bareng langsung dari browser.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${outfit.variable} ${dmSans.variable} h-full`}>
      <body className="font-sans antialiased bg-[#fdfdfd] text-neutral-900 selection:bg-blue-100 h-full flex flex-col overflow-x-hidden" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
