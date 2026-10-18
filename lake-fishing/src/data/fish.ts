import type { FishDefinition, FishRarity } from "../types/game";

/** Fish ids that were renamed between save versions: old id -> current id. */
export const LEGACY_FISH_ID_MAP: Readonly<Record<string, string>> = {
  fish_cultrure: "fish_xenocypris"
};

const autoSellByRarity = (rarity: FishRarity) =>
  rarity === "common" || rarity === "uncommon";

export const FISH: FishDefinition[] = [
  { id: "fish_crucian_carp", name: "小鯽魚", rarity: "common", sellPrice: 5, description: "湖邊常見的小魚，安靜又親切。", imageKey: "fish-crucian-carp", unlockCollectionCount: 0, autoSell: autoSellByRarity("common") },
  { id: "fish_river_sprat", name: "溪哥", rarity: "common", sellPrice: 6, description: "喜歡在清澈水域成群游動。", imageKey: "fish-river-sprat", unlockCollectionCount: 0, autoSell: autoSellByRarity("common") },
  { id: "fish_carp", name: "鯉魚", rarity: "common", sellPrice: 8, description: "湖中熟悉而沉穩的居民。", imageKey: "fish-carp", unlockCollectionCount: 0, autoSell: autoSellByRarity("common") },
  { id: "fish_loach", name: "泥鰍", rarity: "common", sellPrice: 5, description: "常躲在湖底泥沙附近。", imageKey: "fish-loach", unlockCollectionCount: 0, autoSell: autoSellByRarity("common") },
  { id: "fish_gibel", name: "鯽魚", rarity: "common", sellPrice: 6, description: "適應力強，是湖泊裡的老朋友。", imageKey: "fish-gibel", unlockCollectionCount: 0, autoSell: autoSellByRarity("common") },
  { id: "fish_bitterling", name: "鰟鮍", rarity: "common", sellPrice: 7, description: "體型小巧，鱗片帶著淡淡光澤。", imageKey: "fish-bitterling", unlockCollectionCount: 0, autoSell: autoSellByRarity("common") },
  { id: "fish_silver_bream", name: "白條魚", rarity: "common", sellPrice: 6, description: "常在水面附近閃過銀色身影。", imageKey: "fish-silver-bream", unlockCollectionCount: 0, autoSell: autoSellByRarity("common") },
  { id: "fish_tank_goby", name: "塘鱧", rarity: "common", sellPrice: 8, description: "安靜地守在水草與石頭之間。", imageKey: "fish-tank-goby", unlockCollectionCount: 0, autoSell: autoSellByRarity("common") },

  { id: "fish_catfish", name: "鯰魚", rarity: "uncommon", sellPrice: 12, description: "觸鬚靈敏，善於在昏暗水域活動。", imageKey: "fish-catfish", unlockCollectionCount: 5, autoSell: autoSellByRarity("uncommon") },
  { id: "fish_mandarin_fish", name: "鱖魚", rarity: "uncommon", sellPrice: 15, description: "身上的斑紋讓牠看起來格外精神。", imageKey: "fish-mandarin-fish", unlockCollectionCount: 5, autoSell: autoSellByRarity("uncommon") },
  { id: "fish_largemouth_bass", name: "鱸魚", rarity: "uncommon", sellPrice: 14, description: "反應敏捷，喜歡躲在水草邊。", imageKey: "fish-largemouth-bass", unlockCollectionCount: 5, autoSell: autoSellByRarity("uncommon") },
  { id: "fish_bream", name: "鯿魚", rarity: "uncommon", sellPrice: 11, description: "身形扁平，游姿平穩。", imageKey: "fish-bream", unlockCollectionCount: 5, autoSell: autoSellByRarity("uncommon") },
  { id: "fish_xenocypris", name: "鯝魚", rarity: "uncommon", sellPrice: 10, description: "在水流與湖灣之間尋找食物。", imageKey: "fish-xenocypris", unlockCollectionCount: 5, autoSell: autoSellByRarity("uncommon") },
  { id: "fish_koi_gibel", name: "彩鯽", rarity: "uncommon", sellPrice: 15, description: "色彩柔和，像湖面映出的晚霞。", imageKey: "fish-koi-gibel", unlockCollectionCount: 5, autoSell: autoSellByRarity("uncommon") },
  { id: "fish_silver_gibel", name: "銀鯽", rarity: "uncommon", sellPrice: 13, description: "銀白鱗片在陽光下微微閃亮。", imageKey: "fish-silver-gibel", unlockCollectionCount: 5, autoSell: autoSellByRarity("uncommon") },

  { id: "fish_golden_carp", name: "金色鯉魚", rarity: "rare", sellPrice: 40, description: "金色鱗片在水中像一小束陽光。", imageKey: "fish-golden-carp", unlockCollectionCount: 10, autoSell: autoSellByRarity("rare") },
  { id: "fish_koi", name: "錦鯉", rarity: "rare", sellPrice: 50, description: "花紋獨特，被視為幸運的象徵。", imageKey: "fish-koi", unlockCollectionCount: 10, autoSell: autoSellByRarity("rare") },
  { id: "fish_sturgeon", name: "鱘魚", rarity: "rare", sellPrice: 45, description: "古老而沉穩的魚，身形修長。", imageKey: "fish-sturgeon", unlockCollectionCount: 10, autoSell: autoSellByRarity("rare") },
  { id: "fish_eel", name: "鰻魚", rarity: "rare", sellPrice: 35, description: "柔軟靈活，喜歡在夜色中活動。", imageKey: "fish-eel", unlockCollectionCount: 10, autoSell: autoSellByRarity("rare") },
  { id: "fish_rainbow_trout", name: "彩鱒", rarity: "rare", sellPrice: 45, description: "側身帶著像彩虹般的微光。", imageKey: "fish-rainbow-trout", unlockCollectionCount: 10, autoSell: autoSellByRarity("rare") },

  { id: "fish_moonlight_carp", name: "月光鯉", rarity: "epic", sellPrice: 100, description: "夜晚出現時，鱗片泛著月色。", imageKey: "fish-moonlight-carp", unlockCollectionCount: 15, autoSell: autoSellByRarity("epic") },
  { id: "fish_starry_trout", name: "星紋鱒", rarity: "epic", sellPrice: 110, description: "身上的點點光紋宛如星空。", imageKey: "fish-starry-trout", unlockCollectionCount: 15, autoSell: autoSellByRarity("epic") },
  { id: "fish_jade_dragonfish", name: "翡翠龍魚", rarity: "epic", sellPrice: 120, description: "翡翠般的鱗片帶有奇幻光澤。", imageKey: "fish-jade-dragonfish", unlockCollectionCount: 15, autoSell: autoSellByRarity("epic") },

  { id: "fish_lake_guardian", name: "湖之守護者", rarity: "legendary", sellPrice: 500, description: "傳說中守護湖泊與所有小魚的存在。", imageKey: "fish-lake-guardian", unlockCollectionCount: 20, autoSell: autoSellByRarity("legendary") },
  { id: "fish_moonshadow", name: "月影神魚", rarity: "legendary", sellPrice: 450, description: "只有在湖面平靜時才會現身。", imageKey: "fish-moonshadow", unlockCollectionCount: 20, autoSell: autoSellByRarity("legendary") }
];

const FISH_BY_ID: ReadonlyMap<string, FishDefinition> = new Map(FISH.map((fish) => [fish.id, fish]));

/** Look up a fish definition; undefined for unknown ids. */
export function getFishById(id: string): FishDefinition | undefined {
  return FISH_BY_ID.get(id);
}

/** True when `id` is the id of a fish in `FISH`. */
export function isKnownFishId(id: unknown): id is string {
  return typeof id === "string" && FISH_BY_ID.has(id);
}
