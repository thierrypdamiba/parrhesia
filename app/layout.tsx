import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from '@/lib/app';
import { Toasts } from '@/app/components/Toasts';

import './globals.css';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: `${APP_TAGLINE} ${APP_DESCRIPTION}`,
};

// Google Fonts for the two editorial faces (PLAN.md section 5); both have real fallback stacks
// in globals.css so the page reads correctly before the fonts arrive or when they never do.
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=IBM+Plex+Mono:wght@400;500&display=swap';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS_HREF} />
      </head>
      <body>
        {children}
        <Toasts />
      </body>
    </html>
  );
}
