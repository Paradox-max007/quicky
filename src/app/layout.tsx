import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Quicky — Instant sparks. Real connections.",
  description: "Premium dating app with disappearing Quickies, streaks, exclusive games, and clear visibility advantages for Premium subscribers.",
  keywords: ["Quicky", "dating app", "premium dating", "disappearing media"],
  authors: [{ name: "Quicky" }],
  openGraph: {
    title: "Quicky — Instant sparks. Real connections.",
    description: "Premium dating app with disappearing Quickies, streaks, and exclusive games.",
    type: "website",
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}
