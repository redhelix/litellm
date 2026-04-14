"""
routers/intelligence.py — Phase 07 Wave 1

GET  /api/intelligence        — returns latest cached intelligence result
POST /api/intelligence/query  — single-shot Q&A against live LLM + metrics context
"""
import socket
import urllib.error

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import intelligence_job

router = APIRouter(prefix="/api", tags=["intelligence"])

# Re-export call_llm so tests can monkeypatch routers.intelligence.call_llm
call_llm = intelligence_job.call_llm


class QuestionBody(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)


@router.get("/intelligence")
def get_intelligence():
    """Return latest cached intelligence result.

    If no job has run yet, returns an empty-state object with nulls and empty lists.
    """
    with intelligence_job._cache_lock:
        cache = dict(intelligence_job._cache)

    if not cache:
        return {
            "generated_at": None,
            "model_used": None,
            "health_summary": None,
            "anomalies": [],
            "recommendations": [],
            "hf_models": [],
        }
    return cache


@router.post("/intelligence/query")
def query_intelligence(body: QuestionBody):
    """Single-shot Q&A: assemble metrics context and call local LLM.

    Returns 200 {"answer": "..."} on success.
    Returns 503 {"detail": "LLM call failed: <msg>"} on any LLM failure.
    """
    try:
        answer = intelligence_job.answer_question(body.question)
        return {"answer": answer}
    except (urllib.error.URLError, socket.timeout) as err:
        raise HTTPException(status_code=503, detail=f"LLM call failed: {err}")
    except Exception as err:
        raise HTTPException(status_code=503, detail=f"LLM call failed: {err}")
