const DB_NAME = "us-options-entry-rationale-images";
const STORE_NAME = "images";
const DB_VERSION = 1;

type StoredImage = {
  id: string;
  dataUrl: string;
  mimeType: string;
  createdAt: string;
};

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("このブラウザではIndexedDBを利用できません。"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDBを開けませんでした。"));
  });
}

function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = run(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("画像ストア操作に失敗しました。"));
        transaction.oncomplete = () => db.close();
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error("画像ストア操作に失敗しました。"));
        };
      }),
  );
}

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("画像ファイルを読み込めませんでした。"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("画像サムネイルを作成できませんでした。"));
    image.src = dataUrl;
  });
}

async function createThumbnail(dataUrl: string, maxSize = 220): Promise<string> {
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

export async function saveJournalImage(file: File): Promise<{ imageRef: string; thumbnailRef: string }> {
  if (!file.type.startsWith("image/")) throw new Error("画像ファイルだけを添付できます。");
  const dataUrl = await readFileDataUrl(file);
  const thumbnail = await createThumbnail(dataUrl);
  const imageRef = createId("journal-image");
  const thumbnailRef = `${imageRef}-thumb`;
  const createdAt = new Date().toISOString();
  await transact("readwrite", (store) =>
    store.put({ id: imageRef, dataUrl, mimeType: file.type, createdAt } satisfies StoredImage),
  );
  await transact("readwrite", (store) =>
    store.put({ id: thumbnailRef, dataUrl: thumbnail, mimeType: "image/jpeg", createdAt } satisfies StoredImage),
  );
  return { imageRef, thumbnailRef };
}

export async function readJournalImage(ref: string | undefined): Promise<string | undefined> {
  if (!ref) return undefined;
  try {
    const image = await transact<StoredImage | undefined>("readonly", (store) => store.get(ref));
    return image?.dataUrl;
  } catch {
    return undefined;
  }
}
