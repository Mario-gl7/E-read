from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Literal

from bs4 import BeautifulSoup
from deep_translator import GoogleTranslator
from ebooklib import epub
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pypdf import PdfReader

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "vocab.db"
DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="E-read Vocabulary API", version="1.0.0")

ALLOWED_ORIGINS = [
    "https://e-read-mgl.vercel.app",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"^https://.*\\.vercel\\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TranslationResponse(BaseModel):
    word: str
    source_lang: Literal["de", "es"]
    target_lang: Literal["de", "es"]
    translation: str


class VocabItem(BaseModel):
    id: int | None = None
    word: str
    translation: str
    source_lang: Literal["de", "es"]
    target_lang: Literal["de", "es"]


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS vocabulary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                word TEXT NOT NULL,
                translation TEXT NOT NULL,
                source_lang TEXT NOT NULL,
                target_lang TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        )


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def extract_pdf_text(file_path: Path) -> str:
    try:
        reader = PdfReader(str(file_path), strict=False)
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid or unreadable PDF file: {exc}") from exc

    return text.strip()


def extract_epub_text(file_path: Path) -> str:
    try:
        book = epub.read_epub(str(file_path))
        text_parts: list[str] = []
        for item in book.get_items():
            if item.get_type() == 9:  # ebooklib.ITEM_DOCUMENT
                soup = BeautifulSoup(item.get_body_content(), "html.parser")
                text_parts.append(soup.get_text(" ", strip=True))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid or unreadable ePub file: {exc}") from exc

    return "\n".join(part for part in text_parts if part).strip()


@app.post("/upload")
async def upload_document(file: UploadFile = File(...)) -> dict[str, str]:
    extension = Path(file.filename).suffix.lower()
    if extension not in {".pdf", ".epub"}:
        raise HTTPException(status_code=400, detail="Only PDF and ePub files are supported.")

    tmp_file = DATA_DIR / f"upload{extension}"
    content = await file.read()
    tmp_file.write_bytes(content)

    text = extract_pdf_text(tmp_file) if extension == ".pdf" else extract_epub_text(tmp_file)
    if not text:
        raise HTTPException(status_code=422, detail="Could not extract text from this file.")

    return {"filename": file.filename, "text": text}


@app.get("/translate", response_model=TranslationResponse)
def translate_word(
    word: str = Query(..., min_length=1),
    source_lang: Literal["de", "es"] = Query("de"),
    target_lang: Literal["de", "es"] = Query("es"),
) -> TranslationResponse:
    if source_lang == target_lang:
        raise HTTPException(status_code=400, detail="source_lang and target_lang must be different")

    try:
        translated = GoogleTranslator(source=source_lang, target=target_lang).translate(word.strip())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Translation failed: {exc}") from exc

    return TranslationResponse(
        word=word,
        source_lang=source_lang,
        target_lang=target_lang,
        translation=translated,
    )


@app.post("/vocab", response_model=VocabItem)
def save_vocab(item: VocabItem) -> VocabItem:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO vocabulary (word, translation, source_lang, target_lang)
            VALUES (?, ?, ?, ?)
            """,
            (item.word, item.translation, item.source_lang, item.target_lang),
        )
        vocab_id = cursor.lastrowid
    return VocabItem(id=vocab_id, **item.model_dump(exclude={"id"}))


@app.get("/vocab", response_model=list[VocabItem])
def get_vocab() -> list[VocabItem]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, word, translation, source_lang, target_lang FROM vocabulary ORDER BY id DESC"
        ).fetchall()

    return [VocabItem(**dict(row)) for row in rows]
