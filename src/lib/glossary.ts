/**
 * どの会議でも共通して保護したい固有名詞。
 *
 * 仕様書 第6.2章:
 * - 変更頻度が低く、変えるのは開発者だけなので編集 UI を持たない
 * - Git で差分が追えるため、いつ何を足したかが残る
 *
 * 注意: 人名と所属（「河野」「琉球中」等）はここに入れない。
 * 参加者リストとして別途プロンプトに渡すため（第5.3章）。
 * 会議固有の語（議案名・来賓の所属等）は Project.glossary 側。
 */
export const GLOBAL_GLOSSARY: string[] = [
  // 連合会・組織
  "九附後連",
  "九附連",
  "九附P連",
  "九州地区国立大学附属学校PTA連合会",
  "全附P連",
  "全附",
  "教育後援会",
  "後援会",
  "PTA",
  "P",
  "連合会",
  "事務局",

  // 学校・地区名
  "附属",
  "附属小",
  "附属中",
  "小倉",
  "久留米",
  "福教大",
  "特支",

  // 会議・役職まわり
  "会長会",
  "主管校",
  "単位校",
  "単位会",
  "学校園",
  "校園",
  "議決権",
  "委任状",

  // 会議名
  "宮崎大会",
  "琉球大会",
];

/**
 * 全体リストと会議固有リストを結合する。重複は取り除く（第6.1章）。
 */
export function mergeGlossary(projectGlossary: string[] | undefined): string[] {
  const merged = [...GLOBAL_GLOSSARY, ...(projectGlossary ?? [])]
    .map((t) => t.trim())
    .filter(Boolean);
  return Array.from(new Set(merged));
}
