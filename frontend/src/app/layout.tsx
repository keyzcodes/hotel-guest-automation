import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Willows Nest | Guest Operations',
  description: 'Hotel guest services and operations dashboard',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved preference before content paints, avoiding a light flash. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t;try{t=localStorage.getItem('hotel-theme')}catch(e){}var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.style.colorScheme=d?'dark':'light'})();` }} />
        <style>{`html[data-theme=dark],html[data-theme=dark] body{background:#18191a;color:#e4e6eb}html[data-theme=light],html[data-theme=light] body{background:#f0f2f5;color:#1c1e21}`}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
