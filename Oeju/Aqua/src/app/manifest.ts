import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "아쿠아 도감",
    short_name: "아쿠아 도감",
    description: "수조 앞에서 카메라를 들고 물고기를 포획해 나만의 도감을 채우는 탐사 앱",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#050e14",
    theme_color: "#050e14",
    lang: "ko",
    categories: ["education", "entertainment"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "탐사 시작", url: "/scan", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "도감", url: "/dex", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
