import { useMemo, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000'

function App() {
  const [file, setFile] = useState(null)
  const [rawText, setRawText] = useState('')
  const [loading, setLoading] = useState(false)
  const [languageMode, setLanguageMode] = useState('de-es')
  const [selectedWord, setSelectedWord] = useState('')
  const [translation, setTranslation] = useState('')
  const [vocab, setVocab] = useState([])
  const [error, setError] = useState('')

  const tokens = useMemo(() => {
    return rawText
      .split(/(\s+)/)
      .map((token, index) => ({ token, index }))
  }, [rawText])

  const [sourceLang, targetLang] = languageMode.split('-')

  async function loadVocabulary() {
    const response = await fetch(`${API_BASE}/vocab`)
    if (!response.ok) return
    setVocab(await response.json())
  }

  async function handleUpload(e) {
    e.preventDefault()
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)

    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Upload error')
      setRawText(data.text)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function translateWord(word) {
    const normalized = word.replace(/[^\p{L}\-']/gu, '')
    if (!normalized) return

    setSelectedWord(normalized)
    setTranslation('...')
    setError('')

    try {
      const query = new URLSearchParams({
        word: normalized,
        source_lang: sourceLang,
        target_lang: targetLang
      })
      const response = await fetch(`${API_BASE}/translate?${query}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Translation error')
      setTranslation(data.translation)
    } catch (err) {
      setError(err.message)
      setTranslation('')
    }
  }

  async function saveWord() {
    if (!selectedWord || !translation) return
    const payload = {
      word: selectedWord,
      translation,
      source_lang: sourceLang,
      target_lang: targetLang
    }

    const response = await fetch(`${API_BASE}/vocab`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const data = await response.json()
      setError(data.detail || 'Error saving word')
      return
    }

    await loadVocabulary()
  }

  return (
    <main>
      <h1>E-read Vocabulary Web</h1>
      <p>Sube un PDF/ePub, haz click en palabras y construye tu vocabulario bilingüe.</p>

      <section className="card">
        <form onSubmit={handleUpload} className="row">
          <input type="file" accept=".pdf,.epub" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button disabled={loading}>{loading ? 'Procesando...' : 'Subir archivo'}</button>
        </form>

        <div className="row">
          <label>
            Dirección:
            <select value={languageMode} onChange={(e) => setLanguageMode(e.target.value)}>
              <option value="de-es">Alemán → Español</option>
              <option value="es-de">Español → Alemán</option>
            </select>
          </label>
          <button onClick={loadVocabulary}>Actualizar vocabulario</button>
        </div>

        {error && <p className="error">{error}</p>}
      </section>

      <section className="card text-panel">
        {tokens.length > 0 ? (
          tokens.map(({ token, index }) =>
            token.trim() ? (
              <button key={index} className="word" onClick={() => translateWord(token)}>
                {token}
              </button>
            ) : (
              <span key={index}>{token}</span>
            )
          )
        ) : (
          <p>El texto extraído aparecerá aquí.</p>
        )}
      </section>

      <section className="card">
        <h2>Traducción</h2>
        <p>
          <strong>{selectedWord || 'Selecciona una palabra'}</strong>
          {translation && ` → ${translation}`}
        </p>
        <button onClick={saveWord} disabled={!selectedWord || !translation || translation === '...'}>
          Guardar en vocabulario
        </button>
      </section>

      <section className="card">
        <h2>Vocabulario guardado</h2>
        {vocab.length === 0 ? (
          <p>Aún no hay palabras guardadas.</p>
        ) : (
          <ul>
            {vocab.map((item) => (
              <li key={item.id}>
                {item.word} → {item.translation} ({item.source_lang}→{item.target_lang})
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

export default App
