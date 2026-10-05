import json
import os
import shutil
import subprocess
import time
import traceback
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
ANALYSIS_MODEL = os.getenv("OPENAI_ANALYSIS_MODEL", "gpt-5.6-terra")
POLL_SECONDS = int(os.getenv("POLL_SECONDS", "5"))
WORK_DIR = Path(os.getenv("WORK_DIR", "/tmp/sales-call-ai"))
WORK_DIR.mkdir(parents=True, exist_ok=True)

SB_HEADERS = {
    "apikey": SUPABASE_SECRET_KEY,
    "Authorization": f"Bearer {SUPABASE_SECRET_KEY}",
    "Content-Type": "application/json",
}
OPENAI_HEADERS = {"Authorization": f"Bearer {OPENAI_API_KEY}"}

RUBRIC = [
    (1, "Приветствие / смол-толк", "Есть короткий естественный контакт до деловой части."),
    (2, "Присутствие родителя", "Менеджер обозначил присутствие и роль родителя, если это применимо."),
    (3, "План урока", "Клиенту понятна структура и последовательность встречи/урока."),
    (4, "Знакомство с Р и У", "Корректно проведён этап знакомства с Р и У по методологии."),
    (5, "ВП", "Выявлены потребности, контекст, мотивация и ограничения клиента."),
    (6, "Практика", "Практическая часть проведена и связана с задачей клиента."),
    (7, "Постановка целей", "Зафиксированы конкретные цели и желаемый результат."),
    (8, "Презентация продукта", "Продукт представлен через потребности и цели клиента, а не списком функций."),
    (9, "Предзакрытие до тарифов", "До тарифов получено промежуточное согласие/готовность рассматривать покупку."),
    (10, "Тарифы / попытка сделки", "Тарифы презентованы понятно и есть конкретная попытка сделки."),
    (11, "Отработка возражений", "Возражения уточняются, прорабатываются и приводятся к следующему шагу."),
]


def sb_get(path: str, params: dict | None = None):
    with httpx.Client(timeout=60) as c:
        r = c.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=SB_HEADERS, params=params)
        r.raise_for_status()
        return r.json()


def sb_patch(path: str, data: dict, params: dict):
    headers = {**SB_HEADERS, "Prefer": "return=representation"}
    with httpx.Client(timeout=60) as c:
        r = c.patch(f"{SUPABASE_URL}/rest/v1/{path}", headers=headers, params=params, json=data)
        r.raise_for_status()
        return r.json()


def sb_post(path: str, data: Any, upsert: bool = False):
    prefer = "return=minimal"
    if upsert:
        prefer += ",resolution=merge-duplicates"
    headers = {**SB_HEADERS, "Prefer": prefer}
    with httpx.Client(timeout=60) as c:
        r = c.post(f"{SUPABASE_URL}/rest/v1/{path}", headers=headers, json=data)
        r.raise_for_status()


def sb_delete(path: str, params: dict):
    with httpx.Client(timeout=60) as c:
        r = c.delete(f"{SUPABASE_URL}/rest/v1/{path}", headers=SB_HEADERS, params=params)
        r.raise_for_status()


def download_audio(storage_path: str, dest: Path):
    url = f"{SUPABASE_URL}/storage/v1/object/sales-audio/{storage_path}"
    with httpx.stream("GET", url, headers={"apikey": SUPABASE_SECRET_KEY, "Authorization": f"Bearer {SUPABASE_SECRET_KEY}"}, timeout=300) as r:
        r.raise_for_status()
        with dest.open("wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)


def ensure_small_audio(src: Path, dest: Path) -> Path:
    if src.stat().st_size < 24 * 1024 * 1024:
        return src
    cmd = [
        "ffmpeg", "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", "24000",
        "-b:a", "32k", str(dest)
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if dest.stat().st_size >= 25 * 1024 * 1024:
        raise RuntimeError("После сжатия запись всё ещё больше 25 MB. Уменьшите битрейт или разделите запись.")
    return dest


def transcribe_diarized(audio: Path) -> dict:
    with audio.open("rb") as f, httpx.Client(timeout=1800) as c:
        files = {"file": (audio.name, f, "audio/mpeg" if audio.suffix.lower() == ".mp3" else "application/octet-stream")}
        data = {
            "model": "gpt-4o-transcribe-diarize",
            "response_format": "diarized_json",
            "chunking_strategy": "auto",
        }
        r = c.post("https://api.openai.com/v1/audio/transcriptions", headers=OPENAI_HEADERS, files=files, data=data)
        r.raise_for_status()
        return r.json()


def transcript_for_analysis(segments: list[dict]) -> str:
    lines = []
    for seg in segments:
        start = float(seg.get("start", 0))
        mm = int(start // 60); ss = int(start % 60)
        speaker = seg.get("speaker", "?")
        text = (seg.get("text") or "").strip()
        lines.append(f"[{mm:02d}:{ss:02d}] {speaker}: {text}")
    return "\n".join(lines)


def analysis_schema() -> dict:
    evidence = {
        "type": "object",
        "properties": {
            "quote": {"type": "string"},
            "speaker": {"type": "string"},
            "start": {"type": "number"},
            "end": {"type": "number"},
        },
        "required": ["quote", "speaker", "start", "end"],
        "additionalProperties": False,
    }
    step = {
        "type": "object",
        "properties": {
            "step_id": {"type": "integer"},
            "status": {"type": "string", "enum": ["passed", "partial", "failed", "not_applicable"]},
            "score": {"type": "number", "minimum": 0, "maximum": 100},
            "comment": {"type": "string"},
            "recommendation": {"type": "string"},
            "evidence": {"type": "array", "items": evidence},
        },
        "required": ["step_id", "status", "score", "comment", "recommendation", "evidence"],
        "additionalProperties": False,
    }
    insight = {
        "type": "object",
        "properties": {
            "insight_type": {"type": "string", "enum": ["praise","issue","pain","objection","objection_handled","objection_unhandled","product_link","goal","decision"]},
            "label": {"type": "string"},
            "detail": {"type": "string"},
            "speaker": {"type": "string"},
            "start": {"type": "number"},
            "end": {"type": "number"},
            "related_start": {"type": "number"},
            "related_end": {"type": "number"},
            "severity": {"type": "integer", "minimum": 1, "maximum": 3},
            "tags": {"type": "array", "items": {"type": "string"}}
        },
        "required": ["insight_type","label","detail","speaker","start","end","related_start","related_end","severity","tags"],
        "additionalProperties": False
    }
    return {
        "type": "object",
        "properties": {
            "overall_score": {"type": "number", "minimum": 0, "maximum": 100},
            "summary": {"type": "string"},
            "strengths": {"type": "array", "items": {"type": "string"}},
            "improvements": {"type": "array", "items": {"type": "string"}},
            "steps": {"type": "array", "items": step},
            "insights": {"type": "array", "items": insight},
        },
        "required": ["overall_score", "summary", "strengths", "improvements", "steps", "insights"],
        "additionalProperties": False,
    }


def analyze(transcript: str) -> tuple[dict, dict]:
    rubric = "\n".join(f"{i}. {title}: {desc}" for i, title, desc in RUBRIC)
    prompt = f"""
Ты руководитель отдела продаж и QA-аналитик. Проанализируй запись строго по методологии ниже.
Не додумывай отсутствующие действия. Каждый вывод должен опираться на текст записи.
Если этап объективно неприменим, используй not_applicable и объясни почему.
Критически важно: этап 9 — предзакрытие должен происходить ДО выхода на тарифы.
Баллы должны отражать качество конкретного этапа. Для evidence используй короткие точные цитаты из транскрипта с таймкодами.
Верни ровно 11 элементов steps, по одному на каждый step_id 1..11 в исходном порядке.
Дополнительно создай insights — ключевые моменты звонка для навигации по транскрипту:
- pain: клиент сформулировал боль/проблему;
- objection: клиент озвучил возражение;
- objection_handled / objection_unhandled: качество отработки возражения;
- product_link: менеджер связал продукт с ранее озвученной болью/целью;
- praise: сильное действие менеджера;
- issue: ошибка или упущение менеджера;
- goal / decision: цель или решение клиента.
Для каждого insight укажи точный start/end исходного момента. Если insight связан с другим моментом (например pain → product_link), укажи related_start/related_end второго момента, иначе повтори start/end.

МЕТОДОЛОГИЯ:
{rubric}

ТРАНСКРИПТ:
{transcript}
""".strip()

    payload = {
        "model": ANALYSIS_MODEL,
        "reasoning": {"effort": "medium"},
        "input": prompt,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "sales_call_analysis",
                "strict": True,
                "schema": analysis_schema(),
            }
        },
    }
    with httpx.Client(timeout=1200) as c:
        r = c.post("https://api.openai.com/v1/responses", headers={**OPENAI_HEADERS, "Content-Type": "application/json"}, json=payload)
        r.raise_for_status()
        raw = r.json()
    text = raw.get("output_text")
    if not text:
        for item in raw.get("output", []):
            for content in item.get("content", []):
                if content.get("type") == "output_text":
                    text = content.get("text")
                    break
            if text:
                break
    if not text:
        raise RuntimeError("OpenAI Responses API не вернул output_text")
    return json.loads(text), raw


def claim_next_call() -> dict | None:
    rows = sb_get("calls", {
        "select": "*",
        "status": "eq.queued",
        "order": "created_at.asc",
        "limit": "1",
    })
    if not rows:
        return None
    call = rows[0]
    updated = sb_patch("calls", {"status": "transcribing", "error_message": None}, {"id": f"eq.{call['id']}", "status": "eq.queued"})
    return updated[0] if updated else None


def process_call(call: dict):
    call_id = call["id"]
    work = WORK_DIR / call_id
    work.mkdir(parents=True, exist_ok=True)
    src = work / (Path(call["source_filename"]).name or "audio.bin")
    compressed = work / "normalized.mp3"
    try:
        download_audio(call["storage_path"], src)
        audio = ensure_small_audio(src, compressed)
        diarized = transcribe_diarized(audio)
        segments = diarized.get("segments", [])
        if not segments:
            raise RuntimeError("Транскрибация не вернула сегменты")

        sb_delete("transcript_segments", {"call_id": f"eq.{call_id}"})
        sb_post("transcript_segments", [
            {
                "call_id": call_id,
                "segment_index": idx,
                "start_seconds": seg.get("start", 0),
                "end_seconds": seg.get("end", 0),
                "speaker": seg.get("speaker"),
                "text": (seg.get("text") or "").strip(),
            }
            for idx, seg in enumerate(segments)
        ])
        sb_patch("calls", {
            "status": "analyzing",
            "duration_seconds": round(float(diarized.get("duration") or max(float(s.get("end", 0)) for s in segments))),
            "transcript_text": diarized.get("text") or transcript_for_analysis(segments),
        }, {"id": f"eq.{call_id}"})

        result, raw = analyze(transcript_for_analysis(segments))
        if len(result.get("steps", [])) != 11:
            raise RuntimeError("ИИ вернул не 11 этапов анализа")

        sb_delete("analysis_step_results", {"call_id": f"eq.{call_id}"})
        sb_post("analysis_step_results", [
            {
                "call_id": call_id,
                "step_id": int(step["step_id"]),
                "status": step["status"],
                "score": float(step["score"]),
                "comment": step["comment"],
                "recommendation": step["recommendation"],
                "evidence": step["evidence"],
            }
            for step in result["steps"]
        ])
        usage = raw.get("usage") or {}
        sb_delete("call_insights", {"call_id": f"eq.{call_id}"})
        if result.get("insights"):
            sb_post("call_insights", [
                {
                    "call_id": call_id,
                    "insight_type": insight["insight_type"],
                    "label": insight["label"],
                    "detail": insight["detail"],
                    "speaker": insight.get("speaker"),
                    "start_seconds": insight.get("start"),
                    "end_seconds": insight.get("end"),
                    "related_start_seconds": insight.get("related_start"),
                    "related_end_seconds": insight.get("related_end"),
                    "severity": insight.get("severity", 1),
                    "tags": insight.get("tags", []),
                }
                for insight in result["insights"]
            ])

        sb_post("analysis_runs", {
            "call_id": call_id,
            "model": ANALYSIS_MODEL,
            "prompt_version": "sales-rubric-v1",
            "raw_response": raw,
            "input_tokens": usage.get("input_tokens"),
            "output_tokens": usage.get("output_tokens"),
            "status": "completed",
        })
        sb_patch("calls", {
            "status": "completed",
            "overall_score": float(result["overall_score"]),
            "summary": result["summary"],
            "strengths": result["strengths"],
            "improvements": result["improvements"],
            "error_message": None,
        }, {"id": f"eq.{call_id}"})
        print(f"completed {call_id}")
    except Exception as exc:
        print(traceback.format_exc())
        try:
            sb_patch("calls", {"status": "failed", "error_message": str(exc)[:2000]}, {"id": f"eq.{call_id}"})
            sb_post("analysis_runs", {"call_id": call_id, "model": ANALYSIS_MODEL, "prompt_version": "sales-rubric-v1", "status": "failed", "error_message": str(exc)[:2000]})
        except Exception:
            print("failed to record error", traceback.format_exc())
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    print("sales-call-ai worker started")
    while True:
        call = None
        try:
            call = claim_next_call()
            if call:
                process_call(call)
            else:
                time.sleep(POLL_SECONDS)
        except KeyboardInterrupt:
            break
        except Exception:
            print(traceback.format_exc())
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
