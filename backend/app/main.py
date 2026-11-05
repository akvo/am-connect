from fastapi import FastAPI
from sqlmodel import text

from app.db import engine

app = FastAPI(title="AMConnect API")


@app.get("/health")
def health():
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok"}
