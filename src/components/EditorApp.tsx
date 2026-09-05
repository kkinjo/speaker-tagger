"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PaneMode,
  Participant,
  Project,
  ProjectWords,
  UserSettings,
} from "@/lib/types";
import { blockAtOffset, parseDoc, unassignedBlocks } from "@/editor/parse";
import { alignNorm, blockTimes, mapHintsToEditor, type BlockTime } from "@/editor/align";
import { moveCaret, replaceRange } from "@/editor/textEdit";
import { getAudio, putAudio, deleteAudio } from "@/editor/audioStore";
import { formatBytes } from "@/editor/format";
import type { ImportResult } from "@/editor/whisperx";
import RawEditor from "./RawEditor";
import TableView from "./TableView";
import AudioBar from "./AudioBar";
import ParticipantsPanel from "./ParticipantsPanel";
import ImportPanel from "./ImportPanel";

type SaveState = "saved" | "dirty" | "saving" | "error";

const EMPTY_TIMES: BlockTime[] = [];

export default function EditorApp({
  project,
  words,
  settings,
  username,
}: {
  project: Project;
  words: ProjectWords | null;
  settings: UserSettings;
  username: string;
}) {
  /* ---- 保存対象の状態 ---- */
  const [title, setTitle] = useState(project.title);
  const [rawText, setRawText] = useState(project.rawText);
  const [participants, setParticipants] = useState<Participant[]>(
    project.participants
  );
  const [mru, setMru] = useState<string[]>(project.mru);
  const [hints, setHints] = useState<number[]>(project.hints);
  const [audioMeta, setAudioMeta] = useState(project.audio);
  const [imported, setImported] = useState(project.imported);
  const [wordData, setWordData] = useState<ProjectWords | null>(words);

  /* ---- 画面の状態 ---- */
  const [fontSize, setFontSize] = useState(settings.fontSize);
  const [paneMode, setPaneMode] = useState<PaneMode>(settings.paneMode);
  const [rate, setRate] = useState(settings.playbackRate);
  const [follow, setFollow] = useState(settings.followPlayback);
  const [drawerOpen, setDrawerOpen] = useState(!project.imported);
  const [caretOffset, setCaretOffset] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("saved");

  /* ---- 音声 ---- */
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /* ---- 解析 ---- */
  const doc = useMemo(
    () => parseDoc(rawText, participants),
    [rawText, participants]
  );

  // 時刻とヒントは必ず「いま画面にある文章」から求める。
  // 一手遅れた文章を混ぜると、ヒントの位置が本文と 1 文字ずつずれ、
  // 装飾レイヤが毎回まるごと描き直しになって入力が重くなる。
  const timing = useMemo(() => {
    if (!wordData || wordData.words.length === 0) {
      return { times: EMPTY_TIMES, editorHints: [] as number[] };
    }
    const map = alignNorm(doc.norm, wordData.norm);
    return {
      times: blockTimes(
        doc.blocks.length,
        doc.normBlock,
        map,
        wordData.normWordIdx,
        wordData.words
      ),
      editorHints: mapHintsToEditor(hints, map, doc.normOffsets),
    };
  }, [doc, wordData, hints]);

  const times = timing.times;

  const totals = useMemo(() => {
    const utterances = doc.blocks.filter((b) => b.kind === "utterance");
    const todo = utterances.filter((b) => b.speakers.length === 0);
    return { total: utterances.length, todo: todo.length };
  }, [doc.blocks]);

  // 再生位置に対応するブロック
  const activeBlock = useMemo(() => {
    if (!playing && currentTime === 0) return null;
    let found: number | null = null;
    for (const b of doc.blocks) {
      const t = times[b.index]?.start;
      if (t == null) continue;
      if (t <= currentTime + 0.05) found = b.index;
      else break;
    }
    return found;
  }, [doc.blocks, times, currentTime, playing]);

  const caretBlock = useMemo(
    () => blockAtOffset(doc, caretOffset)?.index ?? null,
    [doc, caretOffset]
  );

  /* ---- 保存 ---- */
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const payloadRef = useRef({ title, rawText, participants, mru, audioMeta });
  payloadRef.current = { title, rawText, participants, mru, audioMeta };
  const firstRender = useRef(true);

  const save = useCallback(async () => {
    setSaveState("saving");
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: payloadRef.current.title,
          rawText: payloadRef.current.rawText,
          participants: payloadRef.current.participants,
          mru: payloadRef.current.mru,
          audio: payloadRef.current.audioMeta,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      dirtyRef.current = false;
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [project.id]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    dirtyRef.current = true;
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [title, rawText, participants, mru, audioMeta, save]);

  // 未保存のまま閉じようとしたら、送れるだけ送りつつ引き止める
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    const pageHide = () => {
      if (!dirtyRef.current) return;
      void fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: payloadRef.current.title,
          rawText: payloadRef.current.rawText,
          participants: payloadRef.current.participants,
          mru: payloadRef.current.mru,
          audio: payloadRef.current.audioMeta,
        }),
        keepalive: true,
      });
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", pageHide);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", pageHide);
    };
  }, [project.id]);

  /* ---- 表示設定の保存 ---- */
  const settingsRef = useRef<UserSettings>(settings);
  settingsRef.current = {
    fontSize,
    paneMode,
    playbackRate: rate,
    followPlayback: follow,
  };

  const saveSettings = useCallback((keepalive: boolean) => {
    void fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settingsRef.current),
      keepalive,
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => saveSettings(false), 400);
    return () => clearTimeout(t);
  }, [fontSize, paneMode, rate, follow, saveSettings]);

  // 直後にタブを閉じたり再読み込みしても設定が失われないようにする
  useEffect(() => {
    const flush = () => saveSettings(true);
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [saveSettings]);

  /* ---- 音声の読み込み ---- */
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    if (audioMeta) {
      void getAudio(project.id).then((blob) => {
        if (cancelled || !blob) return;
        url = URL.createObjectURL(blob);
        setAudioUrl(url);
      });
    } else {
      setAudioUrl(null);
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [audioMeta, project.id]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = rate;
  }, [rate, audioUrl]);

  /* ---- 位置移動 ---- */
  const scrollToOffset = useCallback(
    (offset: number, smooth: boolean) => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      const line = rawText.slice(0, offset).split("\n").length - 1;
      const overlay = scroller.querySelector(".editor-overlay");
      const el = overlay?.children[line] as HTMLElement | undefined;
      if (!el) return;
      const target = Math.max(0, el.offsetTop - scroller.clientHeight / 3);
      scroller.scrollTo({ top: target, behavior: smooth ? "smooth" : "auto" });
    },
    [rawText]
  );

  const seek = useCallback((sec: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, sec);
    setCurrentTime(el.currentTime);
  }, []);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || !audioUrl) return;
    if (el.paused) void el.play();
    else el.pause();
  }, [audioUrl]);

  const jumpToNextTodo = useCallback(() => {
    const ta = textareaRef.current;
    const todos = unassignedBlocks(doc);
    if (todos.length === 0) return;
    const next =
      todos.find((b) => b.start > caretOffset) ?? todos[0];
    if (ta) moveCaret(ta, next.start, true);
    setCaretOffset(next.start);
    scrollToOffset(next.start, true);
  }, [doc, caretOffset, scrollToOffset]);

  const insertSeparator = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const at = ta.selectionStart;
    const before = ta.value.slice(0, at);
    const prefix = before.length === 0 || before.endsWith("\n") ? "" : "\n";
    replaceRange(ta, at, ta.selectionEnd, `${prefix}--\n`);
  }, []);

  const openMention = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    replaceRange(ta, ta.selectionStart, ta.selectionEnd, "@");
  }, []);

  const selectBlock = useCallback(
    (blockIndex: number) => {
      const block = doc.blocks[blockIndex];
      if (!block) return;
      const ta = textareaRef.current;
      if (ta && paneMode !== "right") moveCaret(ta, block.start);
      setCaretOffset(block.start);
      scrollToOffset(block.start, true);
      const t = times[blockIndex]?.start;
      if (t != null && audioUrl) seek(t);
    },
    [doc.blocks, paneMode, scrollToOffset, times, audioUrl, seek]
  );

  /* ---- 再生に合わせて左ペインを追従させる ---- */
  const lastFollowed = useRef<number | null>(null);
  useEffect(() => {
    if (!follow || !playing || activeBlock == null) return;
    if (lastFollowed.current === activeBlock) return;
    lastFollowed.current = activeBlock;
    const block = doc.blocks[activeBlock];
    if (block) scrollToOffset(block.start, true);
  }, [follow, playing, activeBlock, doc.blocks, scrollToOffset]);

  /* ---- ショートカット ---- */
  useEffect(() => {
    const isTextField = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return (
        tag === "TEXTAREA" ||
        tag === "INPUT" ||
        tag === "SELECT" ||
        node.isContentEditable
      );
    };

    const onKey = (e: KeyboardEvent) => {
      // 入力欄の外なら Space だけで再生/一時停止できる
      if (e.code === "Space" && !e.altKey && !e.metaKey) {
        if (e.ctrlKey || !isTextField(e.target)) {
          e.preventDefault();
          togglePlay();
          return;
        }
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;

      switch (e.code) {
        case "ArrowLeft":
          e.preventDefault();
          seek((audioRef.current?.currentTime ?? 0) - 3);
          break;
        case "ArrowRight":
          e.preventDefault();
          seek((audioRef.current?.currentTime ?? 0) + 3);
          break;
        case "ArrowUp":
          e.preventDefault();
          setRate((r) => Math.min(2, Math.round((r + 0.25) * 100) / 100));
          break;
        case "ArrowDown":
          e.preventDefault();
          setRate((r) => Math.max(0.5, Math.round((r - 0.25) * 100) / 100));
          break;
        case "Digit1":
          e.preventDefault();
          setPaneMode("left");
          break;
        case "Digit2":
          e.preventDefault();
          setPaneMode("both");
          break;
        case "Digit3":
          e.preventDefault();
          setPaneMode("right");
          break;
        case "Equal":
        case "Semicolon":
          e.preventDefault();
          setFontSize((s) => Math.min(32, s + 1));
          break;
        case "Minus":
          e.preventDefault();
          setFontSize((s) => Math.max(11, s - 1));
          break;
        case "KeyJ":
          e.preventDefault();
          jumpToNextTodo();
          break;
        case "KeyD":
          e.preventDefault();
          insertSeparator();
          break;
        case "KeyA":
          e.preventDefault();
          openMention();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seek, jumpToNextTodo, insertSeparator, openMention]);

  /* ---- 取り込み後の反映 ---- */
  function handleImported(result: ImportResult) {
    setRawText(result.rawText);
    setHints(result.hints);
    setWordData({
      words: result.words,
      norm: result.norm,
      normWordIdx: result.normWordIdx,
    });
    setImported(true);
    dirtyRef.current = false;
    setSaveState("saved");
  }

  async function pickAudio(file: File) {
    await putAudio(project.id, file);
    setAudioMeta({ name: file.name, size: file.size, type: file.type });
  }

  async function removeAudio() {
    await deleteAudio(project.id);
    setAudioMeta(null);
    setPlaying(false);
    setCurrentTime(0);
  }

  function useSpeaker(participantId: string) {
    setMru((prev) => [participantId, ...prev.filter((id) => id !== participantId)]);
  }

  const saveLabel =
    saveState === "saved"
      ? "保存済み"
      : saveState === "saving"
        ? "保存中…"
        : saveState === "error"
          ? "保存できませんでした"
          : "未保存の変更あり";

  return (
    <div
      className="editor-app"
      style={{ ["--editor-size" as string]: `${fontSize}px` } as React.CSSProperties}
    >
      <header className="topbar">
        <a href="/projects" className="btn btn-sm" title="一覧へ戻る">
          ← 一覧
        </a>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ fontWeight: 600, minWidth: 180 }}
          aria-label="議事録のタイトル"
        />
        <span
          className={`save-state ${
            saveState === "saved"
              ? "saved"
              : saveState === "error"
                ? "error"
                : "dirty"
          }`}
        >
          {saveLabel}
        </span>

        <div className="progress">
          <span>
            全 <strong>{totals.total}</strong> ブロック中、話者未割り当て{" "}
            <span className={totals.todo > 0 ? "count-todo" : "count-done"}>
              {totals.todo}
            </span>{" "}
            件
          </span>
          <button
            className="btn btn-sm"
            onClick={jumpToNextTodo}
            disabled={totals.todo === 0}
            title="未割り当ての次の箇所へ（Alt+J）"
          >
            次の未割り当てへ
          </button>
        </div>

        <div className="spacer" />

        <div style={{ display: "flex", gap: 4 }}>
          <button
            className={`btn btn-sm${paneMode === "left" ? " btn-on" : ""}`}
            onClick={() => setPaneMode("left")}
            title="左のみ（Alt+1）"
          >
            左
          </button>
          <button
            className={`btn btn-sm${paneMode === "both" ? " btn-on" : ""}`}
            onClick={() => setPaneMode("both")}
            title="両方（Alt+2）"
          >
            両方
          </button>
          <button
            className={`btn btn-sm${paneMode === "right" ? " btn-on" : ""}`}
            onClick={() => setPaneMode("right")}
            title="右のみ（Alt+3）"
          >
            右
          </button>
        </div>

        <label
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
          title="文字サイズ（Alt+- / Alt+=）"
        >
          文字
          <input
            type="range"
            min={11}
            max={32}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            style={{ width: 90 }}
          />
          <span style={{ width: 28 }}>{fontSize}px</span>
        </label>

        <button
          className={`btn btn-sm${drawerOpen ? " btn-on" : ""}`}
          onClick={() => setDrawerOpen((v) => !v)}
        >
          {drawerOpen ? "設定を閉じる" : "取り込み・参加者"}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          {username}
        </span>
      </header>

      {drawerOpen ? (
        <div className="drawer">
          <ol className="steps">
            <li className={imported ? "done" : ""}>
              <span className="num">{imported ? "✓" : "1"}</span>
              <span>
                WhisperX の JSON を取り込む
                {imported ? "（済み）" : "（まずはここから）"}
              </span>
            </li>
            <li className={participants.length > 0 ? "done" : ""}>
              <span className="num">{participants.length > 0 ? "✓" : "2"}</span>
              <span>
                参加者を登録する（<kbd>@</kbd> の候補になります）
              </span>
            </li>
            <li className={audioMeta ? "done" : ""}>
              <span className="num">{audioMeta ? "✓" : "3"}</span>
              <span>
                音声ファイルを取り込む（任意。聞きながら編集できます）
                {audioMeta ? `　${audioMeta.name}（${formatBytes(audioMeta.size)}）` : ""}
              </span>
            </li>
            <li>
              <span className="num">4</span>
              <span>
                左側で <kbd>@</kbd> 話者、<kbd>--</kbd> 区切り、<kbd>#</kbd>{" "}
                議題見出しを付けていく。右側の表ができたら「表をコピー」で Word へ。
              </span>
            </li>
          </ol>

          <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "14px 0" }} />
          <ImportPanel
            projectId={project.id}
            imported={imported}
            onImported={handleImported}
          />

          <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "14px 0" }} />
          <ParticipantsPanel
            participants={participants}
            onChange={setParticipants}
          />

          <div className="shortcut-list">
            <span>
              <kbd>Space</kbd> 再生 / 一時停止（<kbd>Ctrl</kbd>+<kbd>Space</kbd>
              は編集中でも）
            </span>
            <span>
              <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> 3秒 戻す / 進める
            </span>
            <span>
              <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> 再生速度
            </span>
            <span>
              <kbd>Alt</kbd>+<kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> 左 / 両方 / 右
            </span>
            <span>
              <kbd>Alt</kbd>+<kbd>-</kbd>/<kbd>=</kbd> 文字サイズ
            </span>
            <span>
              <kbd>Alt</kbd>+<kbd>J</kbd> 未割り当ての次へ
            </span>
            <span>
              <kbd>Alt</kbd>+<kbd>D</kbd> 区切り <code>--</code> を入れる
            </span>
            <span>
              <kbd>Alt</kbd>+<kbd>A</kbd> 話者を選ぶ（<kbd>@</kbd>）
            </span>
            <span>
              <kbd>Ctrl</kbd>+<kbd>Z</kbd> 取り消し / <kbd>Ctrl</kbd>+
              <kbd>Shift</kbd>+<kbd>Z</kbd> やり直し
            </span>
          </div>
        </div>
      ) : null}

      <div className="panes">
        {paneMode !== "right" ? (
          <div className="pane">
            <div className="pane-header">
              <span className="pane-title">生テキスト編集</span>
              <button className="btn btn-sm" onClick={openMention} title="Alt+A">
                @ 話者
              </button>
              <button className="btn btn-sm" onClick={insertSeparator} title="Alt+D">
                -- 区切り
              </button>
              <div className="spacer" />
              {timing.editorHints.length > 0 ? (
                <span className="muted" title="pyannote が話者交代を検知した位置">
                  話者交代の候補 {timing.editorHints.length} 箇所（点線）
                </span>
              ) : null}
            </div>
            <RawEditor
              value={rawText}
              onChange={setRawText}
              participants={participants}
              mru={mru}
              onUseSpeaker={useSpeaker}
              doc={doc}
              hints={timing.editorHints}
              activeBlock={activeBlock}
              caretBlock={caretBlock}
              onCaretChange={setCaretOffset}
              textareaRef={textareaRef}
              scrollRef={scrollRef}
            />
          </div>
        ) : null}

        {paneMode !== "left" ? (
          <TableView
            doc={doc}
            times={times}
            activeBlock={activeBlock}
            hasAudio={Boolean(audioUrl)}
            onSeek={seek}
            onSelectBlock={selectBlock}
          />
        ) : null}
      </div>

      <AudioBar
        hasAudio={Boolean(audioMeta)}
        fileName={audioMeta?.name ?? null}
        playing={playing}
        currentTime={currentTime}
        duration={duration}
        rate={rate}
        follow={follow}
        onToggle={togglePlay}
        onSeek={seek}
        onSkip={(d) => seek((audioRef.current?.currentTime ?? 0) + d)}
        onRateChange={setRate}
        onFollowChange={setFollow}
        onPickFile={(file) => void pickAudio(file)}
        onRemoveAudio={() => void removeAudio()}
      />

      {audioUrl ? (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration || 0);
            e.currentTarget.playbackRate = rate;
          }}
        />
      ) : null}
    </div>
  );
}
