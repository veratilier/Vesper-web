import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./chat.css";
import "./music.css";
import "./settings.css";
import "./theme.css";
import "./home.css";
import "./memory.css";
import "./stickers.css";
import "./typography.css";
import "./refinement.css";
import "./anniversary.css";
import "./home-cards.css";
import "./floating-interface.css";
import "./type-scale.css";
import "./backgrounds.css";
import "./home-glass.css";
import "./compact-interface.css";
import "./chat-capture.css";
import "./home-desktop.css";
import "./control-glass.css";
import "./ios-parity.css";
import "./web-proportions.css";
import "./pwa-viewport.css";

export const metadata: Metadata = {
  title: "Vesper — Your private corner",
  description: "Weather, notes, meaningful dates, reminders and music in a quiet space.",
  manifest: "/manifest.webmanifest?v=11",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Vesper",
  },
  icons: {
    icon: [
      {
        url: "/favicon-20260907-moon-v1.png",
        sizes: "64x64",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/apple-touch-icon-20260907-moon-v1.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#eaf0f5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-US">
      <head><link rel="preload" as="image" href="/opening/sky-v5.png" fetchPriority="high" /></head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
