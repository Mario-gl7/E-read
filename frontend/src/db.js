const DB_NAME = 'eread_local_db'
const DB_VERSION = 1
const BOOKS_STORE = 'books'

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        db.createObjectStore(BOOKS_STORE, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'))
  })
}

async function withStore(mode, handler) {
  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, mode)
    const store = tx.objectStore(BOOKS_STORE)

    let requestResult
    try {
      requestResult = handler(store)
    } catch (err) {
      reject(err)
      return
    }

    tx.oncomplete = () => resolve(requestResult?.result)
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'))
  })
}

export async function requestPersistentStorage() {
  if (!('storage' in navigator) || !navigator.storage?.persist) return false
  try {
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function getAllBooks() {
  const result = await withStore('readonly', (store) => store.getAll())
  return Array.isArray(result) ? result : []
}

export async function putBookRecord(book) {
  await withStore('readwrite', (store) => store.put(book))
}

export async function deleteBookRecord(bookId) {
  await withStore('readwrite', (store) => store.delete(bookId))
}