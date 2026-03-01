diff --git a/README.md b/README.md
index de19997071cd0ff51440c6d7a268a1a09d18e944..4e04e965c00fbd14429bdf9caae9c50c4be40c8f 100644
--- a/README.md
+++ b/README.md
@@ -1 +1,130 @@
-# E-read
\ No newline at end of file
+# E-read Vocabulary Web (React + FastAPI)
+
+Proyecto web gratuito para aprender vocabulario entre alemán y español.
+
+## Funcionalidades
+
+- Subida de archivos **PDF** y **ePub**.
+- Extracción de texto en backend y visualización en frontend.
+- Click en cualquier palabra para traducir:
+  - Alemán → Español
+  - Español → Alemán
+- Guardado de palabra + traducción en un vocabulario persistente.
+- Revisión del vocabulario guardado desde la interfaz.
+- 100% con librerías gratuitas, sin APIs de pago.
+
+## Stack técnico
+
+- **Frontend**: React + Vite
+- **Backend**: FastAPI
+- **Traducción**: `deep-translator` usando `GoogleTranslator` (gratuito)
+- **Extracción PDF**: `pypdf`
+- **Extracción ePub**: `ebooklib` + `beautifulsoup4`
+- **Persistencia**: SQLite (`backend/data/vocab.db`)
+
+---
+
+## Estructura
+
+```text
+backend/
+  app/main.py
+  requirements.txt
+frontend/
+  src/App.jsx
+  src/main.jsx
+  src/styles.css
+  package.json
+```
+
+---
+
+## Ejecución local
+
+### 1) Backend
+
+```bash
+cd backend
+python -m venv .venv
+source .venv/bin/activate   # En Windows: .venv\Scripts\activate
+pip install -r requirements.txt
+uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
+```
+
+API disponible en: `http://127.0.0.1:8000`
+
+### 2) Frontend
+
+```bash
+cd frontend
+npm install
+npm run dev
+```
+
+App disponible en: `http://127.0.0.1:5173`
+
+> Si el backend corre en otra URL, define:
+>
+> ```bash
+> VITE_API_BASE=http://TU_BACKEND:8000 npm run dev
+> ```
+
+---
+
+## Endpoints backend
+
+- `POST /upload`  
+  Recibe `.pdf` o `.epub`, extrae texto y devuelve `{ filename, text }`.
+
+- `GET /translate?word=...&source_lang=de|es&target_lang=es|de`  
+  Traduce una palabra usando `deep-translator`.
+
+- `POST /vocab`  
+  Guarda una entrada en SQLite.
+
+- `GET /vocab`  
+  Lista vocabulario guardado.
+
+- `GET /health`  
+  Healthcheck.
+
+---
+
+## Despliegue gratuito (GitHub + Render + Vercel)
+
+### A) Subir a GitHub
+
+1. Crear repositorio en GitHub.
+2. Push del branch `vocab-web`.
+3. Abrir Pull Request a `main`.
+
+### B) Backend en Render (free tier)
+
+1. Crear servicio **Web Service** desde el repo.
+2. Root directory: `backend`
+3. Build command:
+   ```bash
+   pip install -r requirements.txt
+   ```
+4. Start command:
+   ```bash
+   uvicorn app.main:app --host 0.0.0.0 --port $PORT
+   ```
+5. Deploy.
+
+### C) Frontend en Vercel (hobby/free)
+
+1. Importar repo en Vercel.
+2. Root directory: `frontend`
+3. Framework: Vite.
+4. Variable de entorno:
+   - `VITE_API_BASE=https://<tu-backend-render>.onrender.com`
+5. Deploy.
+
+---
+
+## Notas
+
+- El primer request de Render free puede tardar unos segundos (cold start).
+- SQLite funciona bien para MVP y uso personal.
+- Para producción con más usuarios, mover vocabulario a una DB gestionada.
