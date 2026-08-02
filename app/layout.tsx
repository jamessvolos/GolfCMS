import type { Metadata, Viewport } from 'next';
import '@fontsource/libre-caslon-display';
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo-narrow/500.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './globals.css';
import { color, cssVars } from '@/lib/design/tokens';

export const metadata: Metadata = {
  title: 'SG Trainer',
  description:
    'Strokes-gained course management training: drop a pin where you would aim, and learn why the optimal target is optimal.',
};

export const viewport: Viewport = {
  themeColor: color.paper,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: cssVars() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
