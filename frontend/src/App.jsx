import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteBookRecord, getAllBooks, putBookRecord, requestPersistentStorage } from './db'

const API_BASE = (import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000').replace(/\/+$/, '')
const WORDS_PER_PAGE = 220
const READER_MAX_LINES_PER_PAGE = 18
const SUPPORTED_LANGS = ['de', 'es']

function CollapseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M10.71 10.71 6.41 6.41H8V4H3v5h2V7.41l4.29 4.3 1.42-1.42Zm2.58 0 1.42 1.42 4.29-4.3V9h2V4h-5v2h1.59l-4.3 4.29ZM9.29 13.29 5 17.59V16H3v5h5v-2H6.41l4.3-4.29-1.42-1.42Zm5.42 0-1.42 1.42 4.3 4.29H16v2h5v-5h-2v1.59l-4.29-4.3Z"
        fill="currentColor"
      />
    </svg>
  )
}

function detectGermanGender(text) {
  if (!text) return 'No detectado automaticamente'

  const normalized = text.trim().toLowerCase()
  const checks = [
    { article: 'der ', label: 'Masculino (der)' },
    { article: 'die ', label: 'Femenino (die)' },
    { article: 'das ', label: 'Neutro (das)' },
    { article: 'ein ', label: 'Masculino/Neutro (ein)' },
    { article: 'eine ', label: 'Femenino (eine)' },
    { article: 'einen ', label: 'Masculino (einen)' },
    { article: 'einem ', label: 'Masculino/Neutro (einem)' },
    { article: 'einer ', label: 'Femenino (einer)' }
  ]

  for (const check of checks) {
    if (normalized.startsWith(check.article)) return check.label
  }

  return 'No detectado automaticamente'
}

function scoreLanguage(text, lang) {
  const normalized = text.toLowerCase()
  const stopwords = {
    de: [' der ', ' die ', ' das ', ' und ', ' nicht ', ' ich ', ' ist ', ' mit ', ' den ', ' auf '],
    es: [' el ', ' la ', ' los ', ' las ', ' y ', ' no ', ' que ', ' de ', ' con ', ' para ']
  }

  const words = stopwords[lang] || []
  return words.reduce((acc, word) => acc + (normalized.split(word).length - 1), 0)
}

function detectPdfLanguages(text) {
  if (!text) return ['de', 'es']

  const sample = ` ${text.slice(0, 18000).replace(/\s+/g, ' ').toLowerCase()} `
  const deScore = scoreLanguage(sample, 'de')
  const esScore = scoreLanguage(sample, 'es')

  if (deScore === 0 && esScore === 0) return ['de', 'es']
  if (Math.abs(deScore - esScore) <= 2) return ['de', 'es']
  return deScore > esScore ? ['de', 'es'] : ['es', 'de']
}

function detectBlockType(lines) {
  if (lines.length !== 1) return 'paragraph'

  const text = lines[0].trim()
  if (!text) return 'paragraph'

  const isShort = text.length <= 80
  const endsAsSentence = /[.!?;:]$/.test(text)
  return isShort && !endsAsSentence ? 'heading' : 'paragraph'
}

function toLineTokens(line) {
  return line.split(/(\s+)/).map((token, index) => ({ token, index }))
}

function countWords(line) {
  const trimmed = line.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

function makeBookId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

function sortBooks(list) {
  return [...list].sort((a, b) => {
    const first = a.createdAt || ''
    const second = b.createdAt || ''
    return second.localeCompare(first)
  })
}

function formatStoredDate(isoDate) {
  if (!isoDate) return ''
  try {
    return new Date(isoDate).toLocaleDateString('es-ES')
  } catch {
    return ''
  }
}

function App() {
  const [view, setView] = useState('home')
  const [books, setBooks] = useState([])
  const [activeBookId, setActiveBookId] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [storageError, setStorageError] = useState('')
  const [vocab, setVocab] = useState([])
  const [vocabError, setVocabError] = useState('')
  const [readerPageIndex, setReaderPageIndex] = useState(0)
  const [readerPageInput, setReaderPageInput] = useState('1')
  const [turnDirection, setTurnDirection] = useState('next')
  const [turnKey, setTurnKey] = useState(0)
  const [saveMessage, setSaveMessage] = useState('')
  const [readerEdgeHover, setReaderEdgeHover] = useState(false)
  const [readerTopHover, setReaderTopHover] = useState(false)
  const [readerNavPulse, setReaderNavPulse] = useState(false)
  const [popup, setPopup] = useState({
    open: false,
    loading: false,
    word: '',
    translation: '',
    germanGender: 'No detectado automaticamente'
  })

  const readerModeRef = useRef(null)
  const readerPulseTimeoutRef = useRef(null)

  const activeBook = useMemo(() => books.find((book) => book.id === activeBookId) || null, [books, activeBookId])

  const structuredBlocks = useMemo(() => {
    if (!activeBook?.text?.trim()) return []

    const normalized = activeBook.text.replace(/\r\n/g, '\n').trim()
    const blockTexts = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)

    return blockTexts.map((blockText, index) => {
      const lines = blockText.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim() !== '')
      return {
        id: index,
        type: detectBlockType(lines),
        lines
      }
    })
  }, [activeBook])

  const pageItems = useMemo(() => {
    const items = []

    structuredBlocks.forEach((block, blockIndex) => {
      block.lines.forEach((line, lineIndex) => {
        items.push({
          kind: 'line',
          key: `${block.id}-${lineIndex}`,
          blockType: block.type,
          text: line,
          words: countWords(line)
        })
      })

      if (blockIndex < structuredBlocks.length - 1) {
        items.push({ kind: 'gap', key: `gap-${block.id}`, words: 0 })
      }
    })

    return items
  }, [structuredBlocks])

  const pages = useMemo(() => {
    if (pageItems.length === 0) return []

    const builtPages = []
    let currentPage = []
    let currentWords = 0
    let currentLines = 0

    for (const item of pageItems) {
      const nextWords = currentWords + item.words
      const nextLines = currentLines + 1
      const overLimit = currentPage.length > 0 && (nextWords > WORDS_PER_PAGE || nextLines > READER_MAX_LINES_PER_PAGE)

      if (overLimit) {
        builtPages.push(currentPage)
        currentPage = []
        currentWords = 0
        currentLines = 0
      }

      currentPage.push(item)
      currentWords += item.words
      currentLines += 1
    }

    if (currentPage.length > 0) builtPages.push(currentPage)
    return builtPages
  }, [pageItems])

  const currentPageItems = pages[readerPageIndex] || []
  const totalPages = pages.length
  const readerNavVisible = readerEdgeHover || readerNavPulse
  const readerStatusVisible = readerNavVisible || readerTopHover

  useEffect(() => {
    let cancelled = false

    async function init() {
      await requestPersistentStorage()

      try {
        const stored = await getAllBooks()
        if (!cancelled) setBooks(sortBooks(stored))
      } catch {
        if (!cancelled) setStorageError('No se pudo abrir la base de datos local (IndexedDB).')
      }

      await loadVocabulary()
    }

    init()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!activeBook) {
      setReaderPageIndex(0)
      return
    }
    const safeIndex = Math.max(0, Math.min(activeBook.lastPageIndex || 0, Math.max(totalPages - 1, 0)))
    setReaderPageIndex(safeIndex)
  }, [activeBookId])

  useEffect(() => {
    if (totalPages === 0) {
      setReaderPageIndex(0)
      setReaderPageInput('1')
      return
    }
    if (readerPageIndex > totalPages - 1) {
      setReaderPageIndex(totalPages - 1)
      return
    }
    setReaderPageInput(String(readerPageIndex + 1))
  }, [readerPageIndex, totalPages])

  useEffect(() => {
    if (view !== 'reader' || !activeBook) return

    setBooks((prev) => {
      let changed = false
      const next = prev.map((book) => {
        if (book.id !== activeBook.id) return book
        if (book.lastPageIndex === readerPageIndex) return book
        changed = true
        return { ...book, lastPageIndex: readerPageIndex }
      })
      return changed ? next : prev
    })

    const updatedBook = { ...activeBook, lastPageIndex: readerPageIndex }
    void putBookRecord(updatedBook).catch(() => setStorageError('No se pudo guardar la pagina en la base local.'))
  }, [readerPageIndex, view, activeBook])

  useEffect(() => {
    if (view !== 'vocab') return
    void loadVocabulary()
  }, [view])

  useEffect(() => {
    function handleKeyDown(event) {
      if (popup.open && event.key === 'Escape') {
        event.preventDefault()
        closePopup()
        return
      }

      if (event.key === 'Escape') {
        if (view !== 'home') setView('home')
        return
      }

      if (view !== 'reader' || popup.open || totalPages === 0) return

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goToPreviousPage()
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        goToNextPage()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [view, popup.open, totalPages, readerPageIndex])

  useEffect(() => {
    if (view !== 'reader') {
      setReaderEdgeHover(false)
      setReaderTopHover(false)
      setReaderNavPulse(false)
      if (readerPulseTimeoutRef.current) {
        clearTimeout(readerPulseTimeoutRef.current)
        readerPulseTimeoutRef.current = null
      }
      return
    }
    pulseReaderNav()
  }, [view, readerPageIndex])

  useEffect(() => {
    return () => {
      if (readerPulseTimeoutRef.current) clearTimeout(readerPulseTimeoutRef.current)
    }
  }, [])

  async function loadVocabulary() {
    try {
      setVocabError('')
      const response = await fetch(`${API_BASE}/vocab`)
      if (!response.ok) throw new Error('No se pudo cargar el vocabulario')
      setVocab(await response.json())
    } catch (err) {
      setVocabError(err.message)
    }
  }

  async function handleImportFile(fileToUpload) {
    if (!fileToUpload) return

    const formData = new FormData()
    formData.append('file', fileToUpload)

    setUploading(true)
    setUploadError('')

    try {
      const response = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Upload error')

      const detected = detectPdfLanguages(data.text)
      const sourceLang = detected[0]
      const targetLang = sourceLang === 'de' ? 'es' : 'de'

      const newBook = {
        id: makeBookId(),
        name: data.filename || fileToUpload.name,
        text: data.text,
        createdAt: new Date().toISOString(),
        lastPageIndex: 0,
        sourceOptions: detected,
        sourceLang,
        targetLang
      }

      try {
        await putBookRecord(newBook)
      } catch {
        setStorageError('No se pudo guardar el libro en la base de datos local.')
      }

      setBooks((prev) => sortBooks([newBook, ...prev]))
      setActiveBookId(newBook.id)
      setReaderPageIndex(0)
      setReaderPageInput('1')
      setView('reader')
      setSaveMessage('')
      setPopup({
        open: false,
        loading: false,
        word: '',
        translation: '',
        germanGender: 'No detectado automaticamente'
      })
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
    }
  }

  function openBook(bookId) {
    const selected = books.find((book) => book.id === bookId)
    if (!selected) return
    setActiveBookId(bookId)
    setReaderPageIndex(selected.lastPageIndex || 0)
    setReaderPageInput(String((selected.lastPageIndex || 0) + 1))
    setView('reader')
    setUploadError('')
  }

  async function deleteBook(bookId) {
    try {
      await deleteBookRecord(bookId)
    } catch {
      setStorageError('No se pudo borrar el libro de la base de datos local.')
    }

    setBooks((prev) => prev.filter((book) => book.id !== bookId))
    if (activeBookId === bookId) {
      setActiveBookId(null)
      setView('books')
    }
  }

  function markTurn(direction) {
    setTurnDirection(direction)
    setTurnKey((prev) => prev + 1)
  }

  function goToPreviousPage() {
    markTurn('prev')
    setReaderPageIndex((prev) => Math.max(prev - 1, 0))
  }

  function goToNextPage() {
    markTurn('next')
    setReaderPageIndex((prev) => Math.min(prev + 1, totalPages - 1))
  }

  function jumpToPage() {
    const parsed = Number.parseInt(readerPageInput, 10)
    if (Number.isNaN(parsed)) return
    const safePage = Math.min(Math.max(parsed, 1), Math.max(totalPages, 1))
    const nextIndex = safePage - 1
    if (nextIndex !== readerPageIndex) {
      markTurn(nextIndex > readerPageIndex ? 'next' : 'prev')
      setReaderPageIndex(nextIndex)
    }
    setReaderPageInput(String(safePage))
  }

  function pulseReaderNav() {
    setReaderNavPulse(true)
    if (readerPulseTimeoutRef.current) clearTimeout(readerPulseTimeoutRef.current)
    readerPulseTimeoutRef.current = setTimeout(() => {
      setReaderNavPulse(false)
    }, 900)
  }

  function handleReaderMouseMove(event) {
    if (!readerModeRef.current) return
    const rect = readerModeRef.current.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top
    const edgeThreshold = Math.min(130, rect.width * 0.16)
    const nearEdge = mouseX <= edgeThreshold || mouseX >= rect.width - edgeThreshold
    const topZoneWidth = Math.min(210, rect.width * 0.22)
    const nearTopStatus = mouseY <= 74 && Math.abs(mouseX - rect.width / 2) <= topZoneWidth
    setReaderEdgeHover(nearEdge)
    setReaderTopHover(nearTopStatus)
  }

  function handleReaderMouseLeave() {
    setReaderEdgeHover(false)
    setReaderTopHover(false)
  }

  async function translateWord(word) {
    if (!activeBook) return

    const normalized = word.replace(/[^\p{L}\-']/gu, '')
    if (!normalized) return

    if (!SUPPORTED_LANGS.includes(activeBook.sourceLang) || !SUPPORTED_LANGS.includes(activeBook.targetLang)) {
      setUploadError('Combinacion de idiomas no soportada por ahora (solo Aleman/Espanol).')
      return
    }

    setSaveMessage('')
    setPopup({
      open: true,
      loading: true,
      word: normalized,
      translation: '',
      germanGender: 'Calculando...'
    })

    try {
      const query = new URLSearchParams({
        word: normalized,
        source_lang: activeBook.sourceLang,
        target_lang: activeBook.targetLang
      })
      const response = await fetch(`${API_BASE}/translate?${query}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Translation error')

      const germanReference = activeBook.sourceLang === 'de' ? normalized : activeBook.targetLang === 'de' ? data.translation : ''
      const germanGender = detectGermanGender(germanReference)

      setPopup({
        open: true,
        loading: false,
        word: normalized,
        translation: data.translation,
        germanGender
      })
    } catch {
      setPopup({
        open: true,
        loading: false,
        word: normalized,
        translation: 'No disponible',
        germanGender: 'No disponible'
      })
    }
  }

  async function saveWord() {
    if (!activeBook || popup.loading || !popup.translation || popup.translation === 'No disponible') return

    const payload = {
      word: popup.word,
      translation: popup.translation,
      source_lang: activeBook.sourceLang,
      target_lang: activeBook.targetLang
    }

    const response = await fetch(`${API_BASE}/vocab`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!response.ok) return

    setSaveMessage('Guardado en vocabulario')
    await loadVocabulary()
  }

  function closePopup() {
    setPopup((prev) => ({ ...prev, open: false }))
  }

  function renderPageContent() {
    return (
      <div className="page-content reader-page-content">
        <div key={`${readerPageIndex}-${turnKey}-${turnDirection}`} className={`page-sheet reader-turn-${turnDirection}`}>
          {currentPageItems.map((item) => {
            if (item.kind === 'gap') return <div key={item.key} className="text-gap" />

            const lineTokens = toLineTokens(item.text)
            return (
              <div key={item.key} className={`text-line ${item.blockType === 'heading' ? 'text-line-heading' : ''}`}>
                {lineTokens.map(({ token, index }) =>
                  token.trim() ? (
                    <button key={index} className="word" onClick={() => translateWord(token)}>
                      {token}
                    </button>
                  ) : (
                    <span key={index}>{token}</span>
                  )
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function renderReader() {
    if (!activeBook) {
      return (
        <section className="page-screen simple-screen">
          <p>No hay libro seleccionado.</p>
          <button onClick={() => setView('books')}>Ir a libros</button>
        </section>
      )
    }

    return (
      <section className="reader-mode" role="dialog" aria-modal="true" ref={readerModeRef} onMouseMove={handleReaderMouseMove} onMouseLeave={handleReaderMouseLeave}>
        <div className="reader-top">
          <p className="reader-book-name">{activeBook.name}</p>

          <p className={`page-status page-status-discreet reader-page-status reader-top-status ${readerStatusVisible ? 'reader-ui-visible' : 'reader-ui-hidden'}`}>
            Pagina
            <input
              className="page-inline-input"
              inputMode="numeric"
              value={readerPageInput}
              onChange={(e) => setReaderPageInput(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={jumpToPage}
              onKeyDown={(e) => {
                if (e.key === 'Enter') jumpToPage()
              }}
            />
            de {totalPages}
          </p>

          <button type="button" onClick={() => setView('books')} className="icon-btn reader-close-btn" aria-label="Volver a libros" title="Volver a libros">
            <CollapseIcon />
          </button>
        </div>

        <div className="reader-surface">
          <div className="reader-layout">
            <div className="reader-page-row">
              <button
                className={`reader-nav reader-nav-prev ${readerNavVisible ? 'reader-ui-visible' : 'reader-ui-hidden'}`}
                onClick={goToPreviousPage}
                disabled={readerPageIndex === 0}
                aria-label="Pagina anterior"
              >
                {'<-'}
              </button>

              {renderPageContent()}

              <button
                className={`reader-nav reader-nav-next ${readerNavVisible ? 'reader-ui-visible' : 'reader-ui-hidden'}`}
                onClick={goToNextPage}
                disabled={readerPageIndex === totalPages - 1}
                aria-label="Pagina siguiente"
              >
                {'->'}
              </button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  function renderHome() {
    return (
      <section className="home-screen">
        <h1>E-read</h1>
        <div className="home-actions">
          <button onClick={() => setView('import')}>Importar</button>
          <button onClick={() => setView('books')}>Libros</button>
          <button
            onClick={() => {
              void loadVocabulary()
              setView('vocab')
            }}
          >
            Vocabulario
          </button>
        </div>
      </section>
    )
  }

  function renderImport() {
    return (
      <section className="page-screen import-screen">
        <div className="page-head">
          <button onClick={() => setView('home')}>Volver</button>
          <h2>Importar</h2>
          <span />
        </div>

        <div className="import-box">
          <input
            type="file"
            accept=".pdf,.epub"
            onChange={(e) => {
              const selectedFile = e.target.files?.[0] || null
              if (selectedFile) void handleImportFile(selectedFile)
              e.target.value = ''
            }}
          />
        </div>

        {uploading && <p className="loading-note">Procesando archivo...</p>}
        {uploadError && <p className="error">{uploadError}</p>}
        {storageError && <p className="error">{storageError}</p>}
      </section>
    )
  }

  function renderBooks() {
    return (
      <section className="page-screen books-screen">
        <div className="page-head">
          <button onClick={() => setView('home')}>Volver</button>
          <h2>Libros</h2>
          <span />
        </div>

        {storageError && <p className="error">{storageError}</p>}

        {books.length === 0 ? (
          <p>Aun no has importado libros.</p>
        ) : (
          <ul className="books-list">
            {books.map((book) => (
              <li key={book.id} className="book-item">
                <div className="book-meta">
                  <strong>{book.name}</strong>
                  <small>
                    Ultima pagina: {book.lastPageIndex + 1} | Importado: {formatStoredDate(book.createdAt)}
                  </small>
                </div>

                <div className="book-actions">
                  <button onClick={() => openBook(book.id)}>Abrir</button>
                  <button
                    onClick={() => {
                      if (window.confirm('Quieres borrar este libro?')) void deleteBook(book.id)
                    }}
                  >
                    Borrar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  function renderVocab() {
    return (
      <section className="page-screen vocab-screen">
        <div className="page-head">
          <button onClick={() => setView('home')}>Volver</button>
          <h2>Vocabulario</h2>
          <span />
        </div>

        {vocabError && <p className="error">{vocabError}</p>}

        {vocab.length === 0 ? (
          <p>Aun no hay palabras guardadas.</p>
        ) : (
          <ul className="vocab-page-list">
            {vocab.map((item) => (
              <li key={item.id}>
                {item.word} {' -> '} {item.translation} ({item.source_lang} {' -> '} {item.target_lang})
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  return (
    <main className="app-root">
      {view === 'home' && renderHome()}
      {view === 'import' && renderImport()}
      {view === 'books' && renderBooks()}
      {view === 'vocab' && renderVocab()}
      {view === 'reader' && renderReader()}

      {popup.open && (
        <div className="modal-overlay" onClick={closePopup}>
          <section className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Traduccion</h2>
            <p>
              <strong>Palabra:</strong> {popup.word}
            </p>
            <p>
              <strong>Traduccion:</strong> {popup.loading ? 'Cargando...' : popup.translation}
            </p>
            <p>
              <strong>Genero (aleman):</strong> {popup.loading ? 'Cargando...' : popup.germanGender}
            </p>

            {saveMessage && <p className="save-ok">{saveMessage}</p>}

            <div className="modal-actions">
              <button onClick={saveWord} disabled={popup.loading || !popup.translation || popup.translation === 'No disponible'}>
                Guardar para despues
              </button>
              <button onClick={closePopup}>Cerrar</button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default App