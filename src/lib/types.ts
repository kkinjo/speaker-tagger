/** アプリ全体で共有する型定義 */

/** WhisperX の単語単位タイムスタンプ */
export type Word = {
  /** 単語のテキスト */
  w: string;
  /** 開始秒。WhisperX が推定できなかった語は null */
  s: number | null;
  /** 終了秒。同上 */
  e: number | null;
  /** pyannote の話者ラベル (SPEAKER_00 等)。参考情報として保持する */
  spk?: string;
};

/** 事前登録する会議参加者。所属＋氏名で一意に扱う */
export type Participant = {
  id: string;
  /** 所属 (例: ●●小) */
  org: string;
  /** 氏名 (例: 太田) */
  name: string;
};

export type PaneMode = "left" | "right" | "both";

export type UserSettings = {
  fontSize: number;
  paneMode: PaneMode;
  playbackRate: number;
  followPlayback: boolean;
  /** 左右のペインのスクロールを連動させるか */
  syncScroll: boolean;
  /** 出力画面（③）の表示オプション。第7章 7.2 */
  exportIncludeTime: boolean;
  exportIncludeSpeaker: boolean;
  /** true: 整文後のテキストを使う（無ければ原文で補う） / false: 原文 */
  exportUseRefined: boolean;
};

export const DEFAULT_SETTINGS: UserSettings = {
  fontSize: 16,
  paneMode: "both",
  playbackRate: 1,
  followPlayback: true,
  syncScroll: true,
  exportIncludeTime: false,
  exportIncludeSpeaker: true,
  exportUseRefined: true,
};

export type User = {
  id: string;
  username: string;
  /** scrypt ハッシュ (hex) */
  hash: string;
  salt: string;
  createdAt: number;
  settings: UserSettings;
};

/** プロジェクト一覧に出す軽量な情報 */
export type ProjectSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  hasAudio: boolean;
};

/** 1行分の整文結果 */
export type Refinement = {
  /** 整文後のテキスト */
  text: string;
  /** AI 出力後に人が手で直したか */
  edited: boolean;
  /** 最終更新時刻 */
  updatedAt: number;
};

/** 整文結果の集合。キーは sourceKey(block) (src/editor/refine.ts) */
export type Refinements = Record<string, Refinement>;

/** 編集対象の本体。words は別レコードに分けて保存する */
export type Project = {
  id: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 左ペインの生テキスト */
  rawText: string;
  participants: Participant[];
  /** 直近に選んだ話者 id (MRU 順、先頭が最新) */
  mru: string[];
  /** pyannote が話者交代を検知した位置 (原文の文字オフセット) */
  hints: number[];
  /** 音声ファイルのメタ情報。実体はブラウザの IndexedDB に置く */
  audio: { name: string; size: number; type: string } | null;
  /** 取り込み済みか */
  imported: boolean;
  /** 整文画面の結果。キーは本文ハッシュ (sourceKey) */
  refinements: Refinements;
  /** この会議固有の固有名詞（全体リストは src/lib/glossary.ts 側） */
  glossary: string[];
  /**
   * 整文プロンプトのプリセット id（src/lib/refine.ts の PROMPT_PRESETS）。
   * 既存プロジェクトには無いので未設定を許容し、その場合は既定の
   * プリセット（formal）として扱う。
   */
  promptPresetId?: string;
};

/**
 * KV から読み出した Project を正規化する。
 * refinements / glossary は後から追加したフィールドなので、
 * それ以前に保存された既存プロジェクトには存在しない。
 */
export function normalizeProject(project: Project): Project {
  return {
    ...project,
    refinements: project.refinements ?? {},
    glossary: project.glossary ?? [],
  };
}

/** 単語列は更新頻度が低く量が多いので別キーに保存する */
export type ProjectWords = {
  words: Word[];
  /** words の w を連結した原文 (空白除去済み) */
  norm: string;
  /** norm の各文字がどの単語に属するか */
  normWordIdx: number[];
};

export type ProjectFull = Project & { data: ProjectWords | null };
