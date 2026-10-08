import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Willows Nest | Guest Operations',
  description: 'Standalone hotel guest service dashboard',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
