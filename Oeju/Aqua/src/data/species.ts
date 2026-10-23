// 전시종 초안. 현장·공식 안내로 확인한 종만 verified: true 로 바꾼다.
// 2026-10-23 공식 사이트(visitsealife.com/coex-seoul)에서 확인: 샌드타이거샤크(Ocean Kingdom), 해마(Secret Garden of Seahorses), 피라루쿠(아마조니아 월드)·푸른바다거북(바다 왕국, 한국어 공식 페이지). 나머지는 공식 페이지에 종명이 없어 현장 확인 대기.

export type Rarity = "common" | "uncommon" | "rare" | "legendary";
export type ZoneId = "amazon" | "coast" | "reef" | "shark" | "deep";
export type GroupId = "shark" | "ray" | "jelly" | "turtle" | "eel" | "puffer";

export interface Zone {
  id: ZoneId;
  name: string;
  blurb: string;
}

export interface Species {
  id: string;
  name: string;
  nameEn: string;
  scientific: string;
  zone: ZoneId;
  group?: GroupId;
  rarity: Rarity;
  color: string;
  size: string;
  facts: string[];
  tip: string;
  /** 로보플로우 모델이 낼 수 있는 클래스명 후보 (대소문자·공백 무시) */
  aliases: string[];
  verified: boolean;
}

export const ZONES: Zone[] = [
  { id: "amazon", name: "아마존 강", blurb: "세상에서 가장 큰 민물고기들이 사는 열대 강" },
  { id: "coast", name: "강과 해안", blurb: "강물이 바다와 만나는 얕은 물가" },
  { id: "reef", name: "산호초 바다", blurb: "색이 가장 화려한 열대 바다" },
  { id: "shark", name: "상어 바다", blurb: "상어와 가오리가 머리 위를 지나가는 대형 수조" },
  { id: "deep", name: "심해와 해파리", blurb: "빛이 거의 닿지 않는 바다" },
];

export const GROUP_NAMES: Record<GroupId, string> = {
  shark: "상어류",
  ray: "가오리류",
  jelly: "해파리류",
  turtle: "바다거북류",
  eel: "곰치류",
  puffer: "복어류",
};

export const RARITY: Record<Rarity, { label: string; xp: number }> = {
  common: { label: "흔함", xp: 10 },
  uncommon: { label: "보통", xp: 25 },
  rare: { label: "희귀", xp: 60 },
  legendary: { label: "전설", xp: 150 },
};

export const SPECIES: Species[] = [
  {
    id: "arapaima",
    name: "피라루쿠",
    nameEn: "Arapaima",
    scientific: "Arapaima gigas",
    zone: "amazon",
    rarity: "legendary",
    color: "#b5543c",
    size: "최대 약 3m",
    facts: [
      "세계에서 가장 큰 민물고기 중 하나다.",
      "아가미 말고도 공기를 직접 들이마셔 숨을 쉰다. 그래서 주기적으로 수면에 올라온다.",
      "꼬리 쪽 비늘이 붉은빛을 띤다.",
    ],
    tip: "몇 분마다 수면으로 숨 쉬러 올라오는 순간을 노려보자.",
    aliases: ["arapaima", "arapaima gigas", "pirarucu"],
    verified: true,
  },
  {
    id: "red-bellied-piranha",
    name: "피라냐",
    nameEn: "Red-bellied piranha",
    scientific: "Pygocentrus nattereri",
    zone: "amazon",
    rarity: "common",
    color: "#c9473a",
    size: "약 30cm",
    facts: [
      "날카로운 삼각형 이빨이 위아래로 맞물린다.",
      "무리 지어 다니며, 사실은 겁이 많아 무리 속에 있을 때 안심한다.",
      "배 쪽이 붉어서 붉은배피라냐라고도 부른다.",
    ],
    tip: "무리 지어 다니니 한 마리만 화면 가운데에 오도록 잡자.",
    aliases: ["piranha", "red bellied piranha", "pygocentrus nattereri"],
    verified: false,
  },
  {
    id: "silver-arowana",
    name: "실버아로와나",
    nameEn: "Silver arowana",
    scientific: "Osteoglossum bicirrhosum",
    zone: "amazon",
    rarity: "uncommon",
    color: "#a9b4bd",
    size: "최대 약 90cm",
    facts: [
      "물 밖으로 뛰어올라 나뭇가지 위 곤충을 잡아먹기도 한다.",
      "아래턱 끝에 수염 두 가닥이 있다.",
      "수컷이 알과 새끼를 입안에 넣어 지킨다.",
    ],
    tip: "수면 가까이를 천천히 순찰하듯 헤엄친다.",
    aliases: ["arowana", "silver arowana", "osteoglossum bicirrhosum"],
    verified: false,
  },
  {
    id: "seahorse",
    name: "해마",
    nameEn: "Seahorse",
    scientific: "Hippocampus spp.",
    zone: "coast",
    rarity: "rare",
    color: "#d9a441",
    size: "종에 따라 2~35cm",
    facts: [
      "수컷이 배 주머니에 알을 품고 새끼를 낳는다.",
      "헤엄이 서툴러 꼬리로 해초를 감고 버틴다.",
      "두 눈을 따로따로 움직일 수 있다.",
    ],
    tip: "해초에 꼬리를 감고 거의 움직이지 않아 조준하기 쉽다. 대신 찾기가 어렵다.",
    aliases: ["seahorse", "sea horse", "hippocampus"],
    verified: true,
  },
  {
    id: "clownfish",
    name: "흰동가리",
    nameEn: "Ocellaris clownfish",
    scientific: "Amphiprion ocellaris",
    zone: "reef",
    rarity: "common",
    color: "#e8742c",
    size: "약 8~11cm",
    facts: [
      "말미잘의 독침에 쏘이지 않는 점액으로 몸을 보호한다.",
      "무리에서 가장 큰 개체가 암컷이며, 암컷이 사라지면 수컷이 암컷으로 바뀐다.",
      "말미잘을 지켜주고 말미잘은 집이 되어주는 공생 관계다.",
    ],
    tip: "말미잘 근처를 맴도니 말미잘을 먼저 찾자.",
    aliases: ["clownfish", "clown fish", "anemonefish", "amphiprion ocellaris", "nemo"],
    verified: false,
  },
  {
    id: "blue-tang",
    name: "블루탱",
    nameEn: "Blue tang",
    scientific: "Paracanthurus hepatus",
    zone: "reef",
    rarity: "common",
    color: "#2f5fd0",
    size: "약 30cm",
    facts: [
      "꼬리 양옆에 칼처럼 날카로운 가시가 숨어 있다.",
      "위협을 느끼면 산호 틈에 몸을 끼워 숨는다.",
      "어릴 때는 몸이 더 노랗다가 자라며 파래진다.",
    ],
    tip: "산호초 수조 가운데를 빠르게 지나간다. 지나갈 길목에서 기다리자.",
    aliases: ["blue tang", "regal tang", "paracanthurus hepatus", "dory"],
    verified: false,
  },
  {
    id: "yellow-tang",
    name: "옐로탱",
    nameEn: "Yellow tang",
    scientific: "Zebrasoma flavescens",
    zone: "reef",
    rarity: "common",
    color: "#f2c230",
    size: "약 20cm",
    facts: [
      "밤에는 몸 가운데 색이 옅어지고 흰 줄무늬가 나타난다.",
      "바위에 붙은 조류를 뜯어먹어 산호초를 청소한다.",
    ],
    tip: "노란색이 눈에 확 띄어 처음 포획하기 좋은 종이다.",
    aliases: ["yellow tang", "yello tang", "zebrasoma flavescens"],
    verified: false,
  },
  {
    id: "moorish-idol",
    name: "깃대돔",
    nameEn: "Moorish idol",
    scientific: "Zanclus cornutus",
    zone: "reef",
    rarity: "uncommon",
    color: "#e7e1c9",
    size: "약 20cm",
    facts: [
      "등지느러미가 깃발처럼 길게 뻗어 있다.",
      "사육이 까다로운 물고기로 알려져 있다.",
    ],
    tip: "길게 늘어진 등지느러미가 보이면 바로 그 녀석이다.",
    aliases: ["moorish idol", "morish idol", "zanclus cornutus"],
    verified: false,
  },
  {
    id: "lionfish",
    name: "쏠배감펭",
    nameEn: "Red lionfish",
    scientific: "Pterois volitans",
    zone: "reef",
    rarity: "uncommon",
    color: "#a8342b",
    size: "약 30~38cm",
    facts: [
      "부채처럼 펼친 지느러미 가시에 독이 있다.",
      "지느러미를 펼쳐 작은 물고기를 구석으로 몰아 사냥한다.",
    ],
    tip: "거의 제자리에 떠 있어서 조준이 쉽다.",
    aliases: ["lionfish", "lion fish", "pterois", "pterois volitans"],
    verified: false,
  },
  {
    id: "porcupinefish",
    name: "가시복",
    nameEn: "Porcupinefish",
    scientific: "Diodon holocanthus",
    zone: "reef",
    group: "puffer",
    rarity: "uncommon",
    color: "#c2a46b",
    size: "약 30cm",
    facts: [
      "위협을 느끼면 물을 들이켜 공처럼 부풀고 가시를 세운다.",
      "단단한 이빨로 조개와 성게를 깨먹는다.",
    ],
    tip: "큰 눈으로 사람을 빤히 쳐다보곤 한다. 유리 가까이 다가올 때를 노리자.",
    aliases: ["porcupinefish", "porcupine fish", "diodon"],
    verified: false,
  },
  {
    id: "moray-eel",
    name: "곰치",
    nameEn: "Moray eel",
    scientific: "Gymnothorax spp.",
    zone: "reef",
    group: "eel",
    rarity: "rare",
    color: "#6b7a3a",
    size: "종에 따라 1~3m",
    facts: [
      "입을 계속 벌렸다 닫는 것은 위협이 아니라 숨을 쉬기 위해서다.",
      "목 안쪽에 두 번째 턱이 있어 먹이를 끌어당긴다.",
    ],
    tip: "바위 틈에서 머리만 내밀고 있다. 바위 아래쪽을 살펴보자.",
    aliases: ["moray", "moray eel", "gymnothorax"],
    verified: false,
  },
  {
    id: "sand-tiger-shark",
    name: "샌드타이거샤크",
    nameEn: "Sand tiger shark",
    scientific: "Carcharias taurus",
    zone: "shark",
    group: "shark",
    rarity: "rare",
    color: "#8a8f86",
    size: "약 3m",
    facts: [
      "입을 다물어도 삐죽한 이빨이 밖으로 드러나 무서워 보이지만 온순한 편이다.",
      "수면에서 공기를 삼켜 위에 담아 물속에서 떠 있는다.",
    ],
    tip: "대형 수조를 일정한 경로로 돈다. 한 바퀴 지켜본 뒤 길목에서 기다리자.",
    aliases: ["sand tiger shark", "sand tiger", "carcharias taurus", "ragged tooth shark"],
    verified: true,
  },
  {
    id: "zebra-shark",
    name: "얼룩말상어",
    nameEn: "Zebra shark",
    scientific: "Stegostoma tigrinum",
    zone: "shark",
    group: "shark",
    rarity: "rare",
    color: "#c8b48a",
    size: "약 2.5m",
    facts: [
      "어릴 때는 줄무늬, 다 자라면 점무늬로 바뀐다. 이름은 어릴 때 무늬에서 왔다.",
      "바닥에 가만히 누워 쉬는 시간이 많다.",
      "꼬리지느러미가 몸길이의 절반 가까이 된다.",
    ],
    tip: "바닥에 누워 있을 때가 포획 찬스다.",
    aliases: ["zebra shark", "leopard shark", "stegostoma", "stegostoma fasciatum"],
    verified: false,
  },
  {
    id: "blacktip-reef-shark",
    name: "흑기흉상어",
    nameEn: "Blacktip reef shark",
    scientific: "Carcharhinus melanopterus",
    zone: "shark",
    group: "shark",
    rarity: "uncommon",
    color: "#5c6670",
    size: "약 1.6m",
    facts: [
      "지느러미 끝이 먹물을 찍은 듯 까맣다.",
      "얕은 산호초 바다에 살아 등지느러미가 물 밖으로 보이기도 한다.",
    ],
    tip: "까만 지느러미 끝을 확인하면 다른 상어와 구분된다.",
    aliases: ["blacktip reef shark", "blacktip shark", "carcharhinus melanopterus"],
    verified: false,
  },
  {
    id: "stingray",
    name: "가오리",
    nameEn: "Whiptail stingray",
    scientific: "Dasyatidae",
    zone: "shark",
    group: "ray",
    rarity: "uncommon",
    color: "#7d6a55",
    size: "종에 따라 다양",
    facts: [
      "배 쪽에 있는 콧구멍과 입이 웃는 얼굴처럼 보인다.",
      "꼬리에 독가시가 있는 종이 많다.",
      "몸 아래쪽 감각기관으로 모래 속 먹이의 전기 신호를 느낀다.",
    ],
    tip: "유리에 배를 붙이고 올라올 때 웃는 얼굴을 찍어보자.",
    // "stingray"는 민물가오리와 겹치므로 무리(ray) 이름으로 둔다
    aliases: ["whiptail stingray", "dasyatidae"],
    verified: false,
  },
  {
    id: "giant-grouper",
    name: "대왕바리",
    nameEn: "Giant grouper",
    scientific: "Epinephelus lanceolatus",
    zone: "shark",
    rarity: "legendary",
    color: "#55604a",
    size: "최대 약 2.7m",
    facts: [
      "산호초에 사는 뼈 있는 물고기 중 가장 큰 편에 속한다.",
      "먹이를 통째로 빨아들여 삼킨다.",
    ],
    tip: "상어 사이에서도 덩치로 존재감이 크다. 천천히 움직여 조준은 쉽다.",
    aliases: ["giant grouper", "grouper", "epinephelus lanceolatus"],
    verified: false,
  },
  {
    id: "green-sea-turtle",
    name: "푸른바다거북",
    nameEn: "Green sea turtle",
    scientific: "Chelonia mydas",
    zone: "shark",
    group: "turtle",
    rarity: "legendary",
    color: "#4f7a4a",
    size: "약 1~1.2m",
    facts: [
      "이름의 '푸른'은 등껍질이 아니라 몸속 지방 색에서 왔다.",
      "자란 뒤에는 주로 해초를 먹는다.",
      "알을 낳으러 자기가 태어난 해변으로 돌아온다.",
    ],
    tip: "숨 쉬러 수면으로 올라갔다 내려오는 길을 노리자.",
    aliases: ["green sea turtle", "chelonia mydas"],
    verified: true,
  },
  {
    id: "moon-jelly",
    name: "보름달물해파리",
    nameEn: "Moon jellyfish",
    scientific: "Aurelia aurita",
    zone: "deep",
    group: "jelly",
    rarity: "common",
    color: "#b9c8e8",
    size: "지름 약 25~40cm",
    facts: [
      "몸 가운데 네 잎 클로버 모양은 생식선이다.",
      "뇌도 심장도 없다. 몸의 약 95%가 물이다.",
    ],
    tip: "천천히 떠다녀서 조준 유지가 가장 쉬운 생물이다.",
    aliases: ["moon jelly", "moon jellyfish", "aurelia", "aurelia aurita"],
    verified: false,
  },
  {
    id: "black-stingray",
    name: "블랙 스팅레이",
    nameEn: "Black river stingray",
    scientific: "Potamotrygon spp.",
    zone: "amazon",
    group: "ray",
    rarity: "uncommon",
    color: "#2b2f33",
    size: "몸 지름 약 40~60cm",
    facts: [
      "바다가 아니라 남미의 강에 사는 민물가오리다.",
      "검은 몸에 흰 물방울무늬가 흩어져 있다.",
      "꼬리에 독가시가 있어 강가 사람들이 조심하는 물고기다.",
    ],
    tip: "바닥에 납작 붙어 있을 때가 많다. 아마존 수조 바닥을 살펴보자.",
    aliases: ["black stingray", "black river stingray", "potamotrygon", "potamotrygon leopoldi"],
    verified: false,
  },
  {
    id: "napoleon-wrasse",
    name: "나폴레옹피시",
    nameEn: "Humphead wrasse",
    scientific: "Cheilinus undulatus",
    zone: "reef",
    rarity: "legendary",
    color: "#3f8f86",
    size: "최대 약 2m",
    facts: [
      "다 자라면 이마가 혹처럼 불룩 튀어나온다.",
      "산호를 갉아먹는 악마불가사리를 잡아먹는 몇 안 되는 물고기다.",
      "남획으로 수가 줄어 멸종위기종으로 지정되어 있다.",
    ],
    tip: "덩치가 크고 유리 가까이 다가와 사람을 구경하곤 한다.",
    aliases: ["napoleon wrasse", "napoleonfish", "humphead wrasse", "cheilinus undulatus"],
    verified: false,
  },
  {
    id: "garden-eel",
    name: "가든일",
    nameEn: "Spotted garden eel",
    scientific: "Heteroconger hassi",
    zone: "reef",
    group: "eel",
    rarity: "common",
    color: "#d8d2bd",
    size: "약 40cm",
    facts: [
      "몸 아래쪽을 모래 구멍에 묻고 머리만 내밀어 떠다니는 플랑크톤을 먹는다.",
      "위협을 느끼면 모래 속으로 쏙 숨는다.",
      "무리 지어 솟아 있는 모습이 정원의 풀 같아서 이런 이름이 붙었다.",
    ],
    tip: "가까이 다가가면 숨으니 조금 떨어져서 조준하자.",
    aliases: ["garden eel", "spotted garden eel", "heteroconger hassi"],
    verified: false,
  },
  {
    id: "butterflyfish",
    name: "나비고기",
    nameEn: "Butterflyfish",
    scientific: "Chaetodontidae",
    zone: "reef",
    rarity: "common",
    color: "#f0d24a",
    size: "종에 따라 10~20cm",
    facts: [
      "눈을 가로지르는 검은 띠로 진짜 눈을 숨긴다.",
      "짝을 지어 함께 다니는 종이 많다.",
    ],
    tip: "납작하고 동그란 몸이 옆으로 보일 때 조준이 잘 된다.",
    aliases: ["butterflyfish", "butterfly fish", "chaetodontidae"],
    verified: false,
  },
  {
    id: "small-clawed-otter",
    name: "작은발톱수달",
    nameEn: "Asian small-clawed otter",
    scientific: "Aonyx cinereus",
    zone: "coast",
    rarity: "uncommon",
    color: "#7a5a3e",
    size: "몸길이 약 45~60cm",
    facts: [
      "세계에서 가장 작은 수달이다.",
      "발톱이 짧아 앞발을 손가락처럼 써서 게와 조개를 더듬어 잡는다.",
      "가족 단위로 모여 살며 여러 가지 소리로 대화한다.",
    ],
    tip: "쉬지 않고 움직이니 잠깐 멈춰 먹이를 먹을 때를 노리자.",
    aliases: ["small clawed otter", "asian small clawed otter", "otter", "aonyx cinereus"],
    verified: false,
  },
  {
    id: "humboldt-penguin",
    name: "훔볼트펭귄",
    nameEn: "Humboldt penguin",
    scientific: "Spheniscus humboldti",
    zone: "coast",
    rarity: "rare",
    color: "#3a3d42",
    size: "키 약 65~70cm",
    facts: [
      "남미 페루와 칠레 해안에 산다. 이름은 그 앞바다를 흐르는 훔볼트 해류에서 왔다.",
      "가슴에 검은 띠가 하나 있다.",
      "눈 주변의 분홍색 맨살로 몸의 열을 식힌다.",
    ],
    tip: "물속에서는 아주 빠르다. 바위 위에 서 있을 때가 기회다.",
    aliases: ["humboldt penguin", "spheniscus humboldti", "penguin"],
    verified: false,
  },
];

export const SPECIES_BY_ID: Record<string, Species> = Object.fromEntries(
  SPECIES.map((s) => [s.id, s]),
);

export const ZONE_BY_ID: Record<ZoneId, Zone> = Object.fromEntries(
  ZONES.map((z) => [z.id, z]),
) as Record<ZoneId, Zone>;

/** 모델이 무리 단위로만 알아볼 때 쓰는 클래스명 */
export const GROUP_ALIASES: Record<GroupId, string[]> = {
  shark: ["shark", "sharks"],
  ray: ["ray", "rays", "stingray", "sting ray", "manta", "skate"],
  jelly: ["jellyfish", "jelly", "jellyfishes"],
  // 장수거북은 도감에 없다. 모델이 바다거북을 이 이름으로 부르는 경우가 있어 무리로 받는다
  turtle: ["turtle", "sea turtle", "turtles", "leatherback sea turtle", "leatherback"],
  eel: ["eel", "eels"],
  puffer: ["puffer", "pufferfish", "puffer fish", "blowfish"],
};
