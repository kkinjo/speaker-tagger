/**
 * 音声ファイルはサイズが大きく無料枠のストレージに載らないため、
 * ブラウザの IndexedDB に置く。テキストと編集結果はサーバに保存される。
 */
const DB_NAME = "speaker-tagger-audio";
const STORE = "files";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 1回分の読み書き。結果はトランザクションが完了した時点で返す。
 *
 * 以前は要求（put）の success で「保存できた」としていたが、IndexedDB では
 * トランザクションが完了して初めて書き込みが確定する。大きな音声ファイルの
 * 保存中に容量不足などでトランザクションが中断されても気づけず、サーバーには
 * 「音声あり」と記録されたのに本体はブラウザに無い、という状態になっていた。
 */
function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(
          STORE,
          mode,
          // 書き込みはディスクへ確実に書き終わってから完了とする
          mode === "readwrite" ? { durability: "strict" } : undefined
        );
        const req = run(t.objectStore(STORE));
        let result: T;
        req.onsuccess = () => {
          result = req.result;
        };
        t.oncomplete = () => {
          db.close();
          resolve(result);
        };
        const fail = () => {
          db.close();
          reject(t.error ?? req.error ?? new DOMException("保存が中断されました", "AbortError"));
        };
        t.onabort = fail;
        t.onerror = fail;
      })
  );
}

/**
 * 音声を保存する。保存後に読み直してサイズを確かめ、食い違えば失敗とする。
 * 失敗したときは例外を投げる（呼び出し側で理由を画面に出す）。
 */
export async function putAudio(projectId: string, blob: Blob): Promise<void> {
  await tx("readwrite", (s) => s.put(blob, projectId));
  const saved = await tx<Blob | undefined>("readonly", (s) => s.get(projectId));
  if (!saved || saved.size !== blob.size) {
    throw new DOMException("保存した内容を確認できませんでした", "DataError");
  }
}

/** このブラウザに音声が保存されているか（本体は読まない） */
export async function hasStoredAudio(projectId: string): Promise<boolean> {
  try {
    return (await tx<number>("readonly", (s) => s.count(projectId))) > 0;
  } catch {
    return false;
  }
}

export async function getAudio(projectId: string): Promise<Blob | null> {
  try {
    const blob = await tx<Blob | undefined>("readonly", (s) => s.get(projectId));
    return blob ?? null;
  } catch {
    return null;
  }
}

export async function deleteAudio(projectId: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(projectId));
  } catch {
    /* 無ければ何もしない */
  }
}
