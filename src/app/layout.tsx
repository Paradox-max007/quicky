import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "sonner";

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
        <SonnerToaster
          theme="dark"
          position="top-center"
          toastOptions={{
            style: {
              background: '#1A1A2E',
              color: '#F5F5F7',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            },
          }}
        />
      </body>
    </html>
  );
}
