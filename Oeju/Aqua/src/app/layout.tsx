import type { Metadata, Viewport } from "next";
import { Geist_Mono, Noto_Sans_KR } from "next/font/google";
import { AppBoot } from "@/components/AppBoot";
import "./globals.css";

const noto = Noto_Sans_KR({
  variable: "--font-noto",
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "아쿠아 도감",
  description: "수조 앞에서 카메라를 들고 물고기를 포획해 나만의 도감을 채우는 탐사 앱",
  applicationName: "아쿠아 도감",
  appleWebApp: { capable: true, title: "아쿠아 도감", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#050e14",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${noto.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <AppBoot />
      </body>
    </html>
  );
}
