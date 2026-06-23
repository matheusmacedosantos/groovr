import type { Metadata, Viewport } from "next";
import "./globals.css";

const SITE_URL = "https://groovr.xyz";
const TITLE = "Groovr — Free YouTube to MP3 & WAV Downloader";
const DESCRIPTION =
  "Download any YouTube video or playlist as MP3 320 kbps or lossless WAV 24-bit. Free, no signup required. Cover art and metadata embedded automatically. Built for DJs and audiophiles.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s | Groovr",
  },
  description: DESCRIPTION,
  applicationName: "Groovr",
  keywords: [
    "youtube to mp3",
    "youtube to wav",
    "youtube audio downloader",
    "free youtube downloader",
    "youtube 320kbps download",
    "lossless youtube download",
    "youtube wav download",
    "dj music download",
    "youtube playlist downloader",
    "high quality audio download",
    "youtube audio extractor",
    "free mp3 downloader",
    "download youtube music",
    "audio extractor",
    "groovr",
  ],
  authors: [{ name: "Groovr", url: SITE_URL }],
  creator: "Groovr",
  publisher: "Groovr",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "Groovr",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Groovr — Free YouTube to MP3 & WAV Downloader",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
    creator: "@groovr_xyz",
  },
  icons: [
    { rel: "icon", url: "/favicon.svg", type: "image/svg+xml" },
    { rel: "shortcut icon", url: "/favicon.svg" },
    { rel: "apple-touch-icon", url: "/favicon.svg" },
  ],
  manifest: "/manifest.json",
  alternates: {
    canonical: SITE_URL,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1d1d1f",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "Groovr",
              url: SITE_URL,
              description: DESCRIPTION,
              applicationCategory: "MusicApplication",
              operatingSystem: "Web",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              featureList: [
                "YouTube to MP3 320 kbps",
                "YouTube to WAV 24-bit lossless",
                "Playlist download",
                "Automatic cover art embedding",
                "Automatic metadata tagging",
                "Free, no signup required",
              ],
            }),
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
