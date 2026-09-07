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
  /** 所属 (例: 宮崎小) */
  org: string;
  /** 氏名 (例: 河野) */
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
};

export const DEFAULT_SETTINGS: UserSettings = {
  fontSize: 16,
  paneMode: "both",
  playbackRate: 1,
  followPlayback: true,
  syncScroll: true,
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
};

/** 単語列は更新頻度が低く量が多いので別キーに保存する */
export type ProjectWords = {
  words: Word[];
  /** words の w を連結した原文 (空白除去済み) */
  norm: string;
  /** norm の各文字がどの単語に属するか */
  normWordIdx: number[];
};

export type ProjectFull = Project & { data: ProjectWords | null };
