import type { CapacitorConfig } from "@capacitor/cli";

// 앱은 배포된 웹(HTTPS)을 그대로 띄운다.
// - Roboflow 키가 서버에만 남는다
// - 웹만 다시 배포하면 앱도 바로 최신이 된다
// APP_URL 을 넣고 `npx cap sync android` 해야 주소가 앱에 들어간다.
const url = process.env.APP_URL;

const config: CapacitorConfig = {
  appId: "kr.aquadex.app",
  appName: "아쿠아 도감",
  // 서버에 닿지 못할 때만 보이는 안내 화면
  webDir: "mobile-shell",
  backgroundColor: "#050e14",
  server: url ? { url, cleartext: false, errorPath: "index.html" } : undefined,
  android: { allowMixedContent: false },
};

export default config;
