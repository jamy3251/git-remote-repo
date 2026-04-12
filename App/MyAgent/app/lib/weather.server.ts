// Seoul weather + time info using Open-Meteo API (no API key needed)
export interface SeoulWeather {
  temperature: number;
  weatherCode: number; // WMO code
  isDay: boolean;
  hour: number;
  description: string;
  icon: string;
}

const WMO_DESCRIPTIONS: Record<number, { text: string; icon: string }> = {
  0: { text: "Clear", icon: "clear" },
  1: { text: "Mostly Clear", icon: "clear" },
  2: { text: "Partly Cloudy", icon: "cloudy" },
  3: { text: "Overcast", icon: "cloudy" },
  45: { text: "Foggy", icon: "fog" },
  48: { text: "Rime Fog", icon: "fog" },
  51: { text: "Light Drizzle", icon: "rain" },
  53: { text: "Drizzle", icon: "rain" },
  55: { text: "Heavy Drizzle", icon: "rain" },
  61: { text: "Light Rain", icon: "rain" },
  63: { text: "Rain", icon: "rain" },
  65: { text: "Heavy Rain", icon: "rain" },
  71: { text: "Light Snow", icon: "snow" },
  73: { text: "Snow", icon: "snow" },
  75: { text: "Heavy Snow", icon: "snow" },
  80: { text: "Rain Showers", icon: "rain" },
  81: { text: "Rain Showers", icon: "rain" },
  82: { text: "Heavy Showers", icon: "rain" },
  85: { text: "Snow Showers", icon: "snow" },
  86: { text: "Heavy Snow Showers", icon: "snow" },
  95: { text: "Thunderstorm", icon: "thunder" },
  96: { text: "Thunderstorm w/ Hail", icon: "thunder" },
  99: { text: "Heavy Thunderstorm", icon: "thunder" },
};

let cachedWeather: SeoulWeather | null = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export async function getSeoulWeather(): Promise<SeoulWeather> {
  const now = Date.now();
  if (cachedWeather && now - cacheTime < CACHE_TTL) {
    // Update hour from system clock even with cached weather
    const seoulTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    return { ...cachedWeather, hour: seoulTime.getHours(), isDay: seoulTime.getHours() >= 6 && seoulTime.getHours() < 19 };
  }

  try {
    // Seoul coordinates: 37.5665, 126.9780
    const res = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978&current=temperature_2m,weather_code,is_day&timezone=Asia/Seoul",
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();

    const seoulTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const code = data.current.weather_code;
    const wmo = WMO_DESCRIPTIONS[code] || { text: "Unknown", icon: "clear" };

    cachedWeather = {
      temperature: Math.round(data.current.temperature_2m),
      weatherCode: code,
      isDay: data.current.is_day === 1,
      hour: seoulTime.getHours(),
      description: wmo.text,
      icon: wmo.icon,
    };
    cacheTime = now;
    return cachedWeather;
  } catch {
    // Fallback: use system time for Seoul timezone
    const seoulTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const hour = seoulTime.getHours();
    return {
      temperature: 15,
      weatherCode: 0,
      isDay: hour >= 6 && hour < 19,
      hour,
      description: "Clear",
      icon: "clear",
    };
  }
}
