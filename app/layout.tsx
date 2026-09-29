import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VECTOR — From brief to proof.',
  description: 'A persistent workspace for Solidity gas-optimization briefs, patch submissions, evidence and sponsor review.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
