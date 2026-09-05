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

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      })
  );
}

export async function putAudio(projectId: string, blob: Blob): Promise<void> {
  await tx("readwrite", (s) => s.put(blob, projectId));
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
