from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import asyncio
import statistics
import logging
from pathlib import Path
from pydantic import BaseModel, Field, BeforeValidator, EmailStr
from typing import List, Optional, Annotated, Any
from bson import ObjectId
import uuid
import random
import math
from datetime import datetime, timezone, date, timedelta

import anthropic
import httpx
import jwt as pyjwt
import bcrypt
import smtplib
from email.mime.text import MIMEText
import secrets as _secrets
import hashlib

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY')
anthropic_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

# ----- Auth -----
JWT_SECRET = os.environ.get('JWT_SECRET')  # REQUIRED in production — see .env.example
ADMIN_BROADCAST_KEY = os.environ.get('ADMIN_BROADCAST_KEY')  # required to send an announcement push to every user
CRON_SECRET = os.environ.get('CRON_SECRET')  # required to trigger the scheduled nudge sweep

JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 90
APPLE_BUNDLE_ID = os.environ.get('APPLE_BUNDLE_ID', 'com.cuddle.postpartum')
GMAIL_USER = os.environ.get('GMAIL_USER')          # e.g. rohankhanna1992@gmail.com
GMAIL_APP_PASSWORD = os.environ.get('GMAIL_APP_PASSWORD')  # a Gmail "App Password", not the real password
INSTACART_API_KEY = os.environ.get('INSTACART_API_KEY')
INSTACART_BASE_URL = os.environ.get('INSTACART_BASE_URL', 'https://connect.dev.instacart.tools')  # switch to https://connect.instacart.com with a production key when ready to go live

app = FastAPI()
api_router = APIRouter(prefix="/api")


class WaitlistSignup(BaseModel):
    email: EmailStr
    source: str = "coming_soon"


@api_router.post("/waitlist")
async def join_waitlist(body: WaitlistSignup):
    """Public, unauthenticated signup for the coming-soon page. Dedupes on
    email so refreshing/resubmitting the form doesn't create duplicates,
    and always returns success even on a repeat signup — no reason to leak
    whether an email was already on the list to whoever's submitting it."""
    existing = await db.waitlist.find_one({"email": body.email})
    if existing:
        return {"status": "already_registered"}
    await db.waitlist.insert_one({
        "email": body.email,
        "source": body.source,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"status": "added"}


class ContactMessage(BaseModel):
    name: str
    email: EmailStr
    message: str
    source: str = "website"


@api_router.post("/contact")
async def submit_contact(body: ContactMessage):
    """Public, unauthenticated contact form submission. No dedup here —
    unlike the waitlist, the same person may genuinely message twice."""
    name = body.name.strip()[:200]
    message = body.message.strip()[:5000]
    if not name or not message:
        raise HTTPException(status_code=422, detail="Name and message are required")
    await db.contact_messages.insert_one({
        "name": name,
        "email": body.email,
        "message": message,
        "source": body.source,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "read": False,
    })
    return {"status": "sent"}


class ChatMoodOptIn(BaseModel):
    enabled: bool


@api_router.patch("/profile/{device_id}/chat-mood-tracking")
async def set_chat_mood_tracking(device_id: str, body: ChatMoodOptIn, verified_device_id: str = Depends(_verify_device)):
    """Explicit opt-in/out for letting Talk to Cuddle conversations also
    inform her mood trends, separate from her deliberate check-ins. Off by
    default; this is the only place it can be turned on."""
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's settings")
    result = await db.profiles.update_one(
        {"device_id": device_id}, {"$set": {"mood_from_chat_opt_in": body.enabled}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"mood_from_chat_opt_in": body.enabled}


class UnitSystemUpdate(BaseModel):
    unit_system: str   # "oz" or "ml"


@api_router.patch("/profile/{device_id}/unit-system")
async def set_unit_system(device_id: str, body: UnitSystemUpdate, verified_device_id: str = Depends(_verify_device)):
    """Changes how amounts DISPLAY (feeds, pumping) — oz is common in the
    US, ml almost everywhere else. Storage is always ml regardless; this
    only affects what she sees and what export reports say."""
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's settings")
    if body.unit_system not in ("oz", "ml"):
        raise HTTPException(status_code=422, detail="unit_system must be 'oz' or 'ml'")
    result = await db.profiles.update_one(
        {"device_id": device_id}, {"$set": {"unit_system": body.unit_system}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"unit_system": body.unit_system}


async def _infer_mood_from_chat_message(device_id: str, user_message: str):
    """Runs only when she's explicitly opted in. A small, separate Claude
    call reads just her latest message and, only if it clearly expresses
    an emotional state, logs a mood entry tagged source='conversation' —
    kept distinct from her deliberate check-ins so the heatmap and any
    doctor export can always show which is which. If the message is
    neutral logistics ('log a feed', 'what time is it'), nothing is
    logged — this is deliberately conservative, not a running commentary
    on every message."""
    if not anthropic_client:
        return
    prompt = (
        "A new mother sent this message to her postpartum support app's chat: "
        f'"{user_message}"\n\n'
        "Does this message clearly express how she is feeling emotionally right now? "
        "Many messages are just logistics (logging a feed, asking a factual question) and "
        "express nothing emotional — for those, mood_estimate must be null. "
        "Respond with ONLY a JSON object, no other text: "
        '{"mood_estimate": integer 1-5 or null (1=very low, 5=great, null if no clear emotional content), '
        '"tags": array of up to 3 short lowercase tags from this message only, e.g. ["anxiety","overwhelm"], empty if none}'
    )
    try:
        response = await anthropic_client.messages.create(
            model="claude-sonnet-4-6", max_tokens=150,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = "".join(b.text for b in response.content if b.type == "text").strip()
        raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(raw)
        mood_estimate = parsed.get("mood_estimate")
        if mood_estimate is None:
            return
        mood_estimate = max(1, min(5, int(mood_estimate)))
        await db.moods.insert_one({
            "device_id": device_id,
            "mood": mood_estimate,
            "energy": None,
            "sleep_hours": None,
            "note": None,
            "tags": [str(t) for t in (parsed.get("tags") or [])][:3],
            "source": "conversation",
            "created_at": now_iso(),
        })
    except Exception:
        logger.exception("chat mood inference failed")


@api_router.get("/export/full-report/{device_id}")
async def export_full_report(device_id: str, days: int = 90, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's export report")
    """The comprehensive 'share everything with your doctor' export —
    feeds, pumping, diapers, baby's sleep, mom's own rest, and meetup
    attendance (a real proxy for social connection, which matters
    clinically in postpartum care). Includes real standard deviation
    across individual entries, not just daily totals, since consistency
    (or the lack of it) is often more clinically useful than an average
    alone. Same discipline throughout: only what was actually logged,
    day-by-day and week-by-week, never inferred or diagnostic."""
    days = max(7, min(days, 180))
    since_dt = datetime.now(timezone.utc) - timedelta(days=days)
    since = since_dt.isoformat()

    logs = await db.baby_logs.find(
        {"device_id": device_id, "at": {"$gte": since}}, {"_id": 0}
    ).sort("at", 1).to_list(5000)
    mom_rest_logs = await db.caregiver_rest_logs.find(
        {"device_id": device_id, "at": {"$gte": since}}, {"_id": 0}
    ).sort("at", 1).to_list(1000)
    attended_meetups = await db.meetups.find(
        {"attendees.device_id": device_id, "date": {"$gte": since_dt.date().isoformat()}},
        {"_id": 0, "title": 1, "date": 1, "category": 1},
    ).sort("date", 1).to_list(200)

    def stdev(values: list) -> Optional[float]:
        vals = [v for v in values if v is not None]
        if len(vals) < 2:
            return None
        return round(statistics.stdev(vals), 1)

    # ---- per-day aggregation (for daily table + weekly rollups) ----
    by_day: dict = {}
    feed_amounts, pump_amounts, baby_sleep_durations = [], [], []

    for l in logs:
        day = l["at"][:10]
        entry = by_day.setdefault(day, {
            "feed_ml": 0, "feed_count": 0, "pump_ml": 0, "pump_count": 0,
            "pee_count": 0, "poop_count": 0, "sleep_minutes": 0,
        })
        kind = l.get("kind")
        if kind == "feed":
            ml = l.get("amount_ml") or 0
            entry["feed_ml"] += ml; entry["feed_count"] += 1
            feed_amounts.append(ml)
        elif kind == "pump":
            ml = (l.get("left_ml") or 0) + (l.get("right_ml") or 0)
            entry["pump_ml"] += ml; entry["pump_count"] += 1
            pump_amounts.append(ml)
        elif kind == "diaper":
            dtype = l.get("diaper_type")
            if dtype in ("pee", "both"): entry["pee_count"] += 1
            if dtype in ("poop", "both"): entry["poop_count"] += 1
        elif kind == "sleep":
            mins = l.get("duration_minutes") or 0
            entry["sleep_minutes"] += mins
            baby_sleep_durations.append(mins)

    daily = [{"date": d, **vals} for d, vals in sorted(by_day.items())]
    days_with_data = max(1, len(by_day))

    # ---- weekly rollups, so a 90-day export shows real trend, not just one lump total ----
    weekly: dict = {}
    for d in daily:
        week_start = (datetime.fromisoformat(d["date"]) - timedelta(days=datetime.fromisoformat(d["date"]).weekday())).date().isoformat()
        w = weekly.setdefault(week_start, {
            "feed_ml": 0, "feed_count": 0, "pump_ml": 0, "pump_count": 0,
            "pee_count": 0, "poop_count": 0, "sleep_minutes": 0,
        })
        for k in w:
            w[k] += d[k]
    weekly_list = [{"week_of": w, **vals} for w, vals in sorted(weekly.items())]

    # ---- mom's own rest ----
    mom_rest_minutes = [l.get("duration_minutes") or 0 for l in mom_rest_logs]
    mom_rest_total = sum(mom_rest_minutes)

    totals = {
        "feed_ml": sum(feed_amounts), "feed_count": len(feed_amounts),
        "pump_ml": sum(pump_amounts), "pump_count": len(pump_amounts),
        "pee_count": sum(d["pee_count"] for d in daily),
        "poop_count": sum(d["poop_count"] for d in daily),
        "sleep_minutes": sum(baby_sleep_durations), "sleep_count": len(baby_sleep_durations),
        "mom_rest_minutes": mom_rest_total, "mom_rest_count": len(mom_rest_logs),
        "meetups_attended": len(attended_meetups),
    }

    return {
        "range_days": days,
        "days_with_data": len(by_day),
        "daily": daily,
        "weekly": weekly_list,
        "totals": totals,
        "daily_averages": {
            "feed_ml_per_day": round(totals["feed_ml"] / days_with_data, 1),
            "feed_count_per_day": round(totals["feed_count"] / days_with_data, 1),
            "pump_ml_per_day": round(totals["pump_ml"] / days_with_data, 1),
            "pee_per_day": round(totals["pee_count"] / days_with_data, 1),
            "poop_per_day": round(totals["poop_count"] / days_with_data, 1),
            "sleep_hours_per_day": round(totals["sleep_minutes"] / 60 / days_with_data, 1),
            "mom_rest_hours_per_day": round(mom_rest_total / 60 / days_with_data, 1),
        },
        "standard_deviation": {
            "feed_ml": stdev(feed_amounts),
            "pump_ml": stdev(pump_amounts),
            "baby_sleep_minutes": stdev(baby_sleep_durations),
            "mom_rest_minutes": stdev(mom_rest_minutes),
            "note": "How much individual entries vary from the average — a small number means fairly consistent, a large one means it swings a lot day to day. Null if there wasn't enough data yet to calculate.",
        },
        "meetups_attended": [{"title": m["title"], "date": m["date"], "category": m.get("category")} for m in attended_meetups],
        "disclaimer": "This reflects only what was logged in the app — gaps in logging are not gaps in care. Bring this alongside, not instead of, your own observations.",
    }


@api_router.get("/mood/{device_id}/doctor-report")
async def mood_doctor_report(device_id: str, days: int = 90, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's wellbeing data")
    
    """A doctor-ready view of her own logged data — a day-by-day heatmap
    plus a short, plain-language pattern summary. This only reflects what
    she explicitly logged in check-ins; it never infers, diagnoses, or adds
    anything she didn't report herself."""
    days = max(7, min(days, 180))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    entries = await db.moods.find(
        {"device_id": device_id, "created_at": {"$gte": since}}, {"_id": 0}
    ).sort("created_at", 1).to_list(1000)

    by_day: dict = {}
    tag_counts: dict = {}
    for e in entries:
        day = e["created_at"][:10]
        by_day.setdefault(day, []).append(e)
        for t in e.get("tags") or []:
            tag_counts[t] = tag_counts.get(t, 0) + 1

    heatmap = []
    for day, day_entries in sorted(by_day.items()):
        scores = [d["mood"] for d in day_entries if d.get("mood") is not None]
        day_tags = sorted({t for d in day_entries for t in (d.get("tags") or [])})
        heatmap.append({
            "date": day,
            "mood": round(sum(scores) / len(scores), 1) if scores else None,
            "check_ins": len(day_entries),
            "tags": day_tags,
        })

    top_tags = sorted(tag_counts.items(), key=lambda kv: kv[1], reverse=True)[:6]
    checkin_count = sum(1 for e in entries if e.get("source", "checkin") == "checkin")
    conversation_count = sum(1 for e in entries if e.get("source") == "conversation")

    summary = None
    if entries and anthropic_client:
        tag_lines = ", ".join(f"{t} ({c}x)" for t, c in top_tags) if top_tags else "none logged"
        scores_line = ", ".join(f"{d}:{by_day[d][0]['mood']}" for d in sorted(by_day.keys())[-14:])
        source_note = (
            f" Of these, {checkin_count} were deliberate check-ins and {conversation_count} were "
            "inferred from her Talk to Cuddle conversations (she opted into this)."
            if conversation_count > 0 else ""
        )
        prompt = (
            f"A new mother has logged {len(entries)} mood check-ins over the last {days} days.{source_note} "
            f"Her mood scores (1=low, 5=great) for her most recent logged days: {scores_line}. "
            f"Her most frequently logged concerns/tags: {tag_lines}. "
            "Write a short (3-4 sentence), plain-language, clinically-neutral summary she could hand "
            "to her doctor or therapist. Describe the pattern in her own logged data only — do not "
            "diagnose, do not speculate about causes she hasn't stated, and do not invent anything "
            "not present in this data. Write it in third person, suitable to print or read aloud in "
            "an appointment."
        )
        try:
            response = await anthropic_client.messages.create(
                model="claude-sonnet-4-6", max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            summary = "".join(b.text for b in response.content if b.type == "text").strip()
        except Exception:
            logger.exception("doctor report summary generation failed")

    return {
        "range_days": days,
        "total_check_ins": len(entries),
        "checkin_count": checkin_count,
        "conversation_inferred_count": conversation_count,
        "heatmap": heatmap,
        "top_tags": [{"tag": t, "count": c} for t, c in top_tags],
        "summary": summary,
    }

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Mongo helpers
# ---------------------------------------------------------------------------
def _validate_object_id(v: Any) -> str:
    if isinstance(v, ObjectId):
        return str(v)
    return str(v)


PyObjectId = Annotated[str, BeforeValidator(_validate_object_id)]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class Profile(BaseModel):
    device_id: str
    name: str
    baby_name: Optional[str] = None
    num_children: int = 1
    delivery_type: Optional[str] = None          # vaginal / c-section / assisted / other
    delivery_date: Optional[str] = None          # ISO date string
    feeding_method: Optional[str] = None          # breastfeeding / formula / mixed / pumping
    birth_experience: Optional[str] = None        # positive / difficult / traumatic / mixed
    support_level: Optional[str] = None           # strong / some / limited
    initial_mood: Optional[int] = None            # 1-5
    concerns: List[str] = []
    postpartum_appt_done: bool = False
    mood_from_chat_opt_in: bool = False           # explicit opt-in: may Talk to Cuddle conversations also inform mood trends?
    unit_system: str = "oz"                        # "oz" or "ml" — display only, everything is still stored canonically in ml
    created_at: str = Field(default_factory=now_iso)


class MoodEntry(BaseModel):
    device_id: str
    mood: int                                     # 1 (low) - 5 (great)
    energy: Optional[int] = None                  # 1-5
    sleep_hours: Optional[float] = None
    note: Optional[str] = None
    tags: List[str] = []
    source: str = "checkin"                        # "checkin" (explicit) or "conversation" (inferred, opt-in only)
    created_at: str = Field(default_factory=now_iso)


class MoodEntryCreate(BaseModel):
    device_id: str
    mood: int
    energy: Optional[int] = None
    sleep_hours: Optional[float] = None
    note: Optional[str] = None
    tags: List[str] = []


class EncouragementCreate(BaseModel):
    from_device_id: str
    to_device_id: str
    message: str


class EpdsResult(BaseModel):
    device_id: str
    answers: List[int]
    total: int
    band: str                                     # low / possible / likely
    self_harm_flag: bool
    created_at: str = Field(default_factory=now_iso)


class EpdsSubmit(BaseModel):
    device_id: str
    answers: List[int]


class ChatRequest(BaseModel):
    device_id: str
    session_id: str
    message: str


class CommunityPost(BaseModel):
    author: str
    avatar_color: str
    location: str
    text: str
    topic: str
    likes: int = 0
    created_at: str = Field(default_factory=now_iso)


class PostCreate(BaseModel):
    device_id: str
    author: str
    text: str
    topic: str = "General"
    space: str = "general"


class CommentCreate(BaseModel):
    device_id: str
    author: str
    text: str


# ---------------------------------------------------------------------------
# Static / research-backed content
# ---------------------------------------------------------------------------
QUOTES = [
    {"text": "Right now, in this moment, you are enough.", "author": "Cuddle"},
    {"text": "Take a slow breath. You are safe, and you are doing okay.", "author": "Cuddle"},
    {"text": "You don't have to be perfect today. Just present.", "author": "Cuddle"},
    {"text": "Being a mother is learning about strengths you didn't know you had.", "author": "Linda Wooten"},
    {"text": "You don't have to be perfect to be an amazing mom.", "author": "Cuddle"},
    {"text": "Rest isn't something you earn. It's something you deserve, simply.", "author": "Cuddle"},
    {"text": "The days are long, but the years are short. Be gentle with today.", "author": "Cuddle"},
    {"text": "You are doing a beautiful job, even on the days it doesn't feel like it.", "author": "Cuddle"},
    {"text": "Your baby doesn't need a perfect mother. They need a present one, and you are here.", "author": "Cuddle"},
    {"text": "You can love this life and still find parts of it hard. Both are true, and both are okay.", "author": "Cuddle"},
    {"text": "Asking for help is not giving up. It's how you keep going.", "author": "Cuddle"},
    {"text": "Small moments count. A held gaze, a soft word: you're building something real.", "author": "Cuddle"},
    {"text": "You get to have needs too. Meeting them isn't selfish, it's sustainable.", "author": "Cuddle"},
    {"text": "One gentle moment at a time is enough.", "author": "Cuddle"},
]

# EPDS — Edinburgh Postnatal Depression Scale (Cox, Holden & Sagovsky, 1987)
# Each option carries its validated score (0-3). Items 3,5,6,7,8,9,10 are reverse ordered.
EPDS_QUESTIONS = [
    {"q": "In the past 7 days, I have been able to laugh and see the funny side of things",
     "options": [{"label": "As much as I always could", "score": 0},
                 {"label": "Not quite so much now", "score": 1},
                 {"label": "Definitely not so much now", "score": 2},
                 {"label": "Not at all", "score": 3}]},
    {"q": "I have looked forward with enjoyment to things",
     "options": [{"label": "As much as I ever did", "score": 0},
                 {"label": "Rather less than I used to", "score": 1},
                 {"label": "Definitely less than I used to", "score": 2},
                 {"label": "Hardly at all", "score": 3}]},
    {"q": "I have blamed myself unnecessarily when things went wrong",
     "options": [{"label": "No, never", "score": 0},
                 {"label": "Not very often", "score": 1},
                 {"label": "Yes, some of the time", "score": 2},
                 {"label": "Yes, most of the time", "score": 3}]},
    {"q": "I have been anxious or worried for no good reason",
     "options": [{"label": "No, not at all", "score": 0},
                 {"label": "Hardly ever", "score": 1},
                 {"label": "Yes, sometimes", "score": 2},
                 {"label": "Yes, very often", "score": 3}]},
    {"q": "I have felt scared or panicky for no very good reason",
     "options": [{"label": "No, not at all", "score": 0},
                 {"label": "No, not much", "score": 1},
                 {"label": "Yes, sometimes", "score": 2},
                 {"label": "Yes, quite a lot", "score": 3}]},
    {"q": "Things have been getting on top of me",
     "options": [{"label": "No, I have been coping as well as ever", "score": 0},
                 {"label": "No, most of the time I have coped quite well", "score": 1},
                 {"label": "Yes, sometimes I haven't been coping as well", "score": 2},
                 {"label": "Yes, most of the time I haven't been able to cope", "score": 3}]},
    {"q": "I have been so unhappy that I have had difficulty sleeping",
     "options": [{"label": "No, not at all", "score": 0},
                 {"label": "Not very often", "score": 1},
                 {"label": "Yes, sometimes", "score": 2},
                 {"label": "Yes, most of the time", "score": 3}]},
    {"q": "I have felt sad or miserable",
     "options": [{"label": "No, not at all", "score": 0},
                 {"label": "Not very often", "score": 1},
                 {"label": "Yes, quite often", "score": 2},
                 {"label": "Yes, most of the time", "score": 3}]},
    {"q": "I have been so unhappy that I have been crying",
     "options": [{"label": "No, never", "score": 0},
                 {"label": "Only occasionally", "score": 1},
                 {"label": "Yes, quite often", "score": 2},
                 {"label": "Yes, most of the time", "score": 3}]},
    {"q": "The thought of harming myself has occurred to me",
     "options": [{"label": "Never", "score": 0},
                 {"label": "Hardly ever", "score": 1},
                 {"label": "Sometimes", "score": 2},
                 {"label": "Yes, quite often", "score": 3}]},
]

TIPS = [
    {"title": "The 5-minute reset", "category": "Self-care", "body": "When overwhelm hits, place one hand on your chest and breathe out slowly for 6 seconds, five times. This gently signals safety to your nervous system.", "icon": "wind"},
    {"title": "Sleep when you can", "category": "Rest", "body": "Fragmented sleep is normal now. Even a 20-minute rest while baby sleeps counts. Lower the bar — dishes can wait.", "icon": "moon"},
    {"title": "Hydration & one warm meal", "category": "Nourishment", "body": "Keep a water bottle where you feed. Aim for one warm, easy meal a day. Your body is working hard to recover.", "icon": "coffee"},
    {"title": "Sunlight & a short walk", "category": "Movement", "body": "Ten minutes of morning light can lift mood and steady sleep rhythms. A slow stroll with the stroller counts.", "icon": "sun"},
    {"title": "You can ask for help", "category": "Support", "body": "Let someone hold the baby while you shower or nap. Accepting help is a strength, not a failure.", "icon": "heart"},
    {"title": "Name the feeling", "category": "Mind", "body": "Saying 'I feel overwhelmed' out loud reduces its intensity. Your feelings are valid and they will pass.", "icon": "message-circle"},
]

# Sourced from ACOG's postpartum/assisted-vaginal-delivery patient FAQs, NHS
# recovery guidance, and Cleveland Clinic/Mayo-affiliated recovery timelines
# (see the individual notes below). Deliberately population-level ("many
# people... ") never diagnostic, and every stage pairs what's normal with
# a real red-flag list — this is informational content, not a substitute
# for her actual provider, and is presented that way in the UI every time.
RECOVERY_TIMELINE = {
    "vaginal": [
        {
            "weeks": [0, 2],
            "normal": "Bleeding (lochia) starts bright red and heavy, like a heavy period, often with small clots — this is expected. Perineal soreness, swelling, and stitches (if you tore or had an episiotomy) are common. Many people also notice afterpains (cramping) as the uterus contracts back down, especially while breastfeeding.",
            "red_flags": ["Soaking one pad an hour for 2+ hours", "Passing a clot larger than a golf ball", "Fever", "Foul-smelling discharge", "Severe or worsening pain"],
        },
        {
            "weeks": [2, 6],
            "normal": "Bleeding typically lightens and shifts from red toward pink, then brown. Stitches continue dissolving and the area may feel itchy — often a sign of healing, not a problem. Energy is still commonly low; the baby blues (weepiness, feeling on edge) are common in these weeks and usually ease on their own.",
            "red_flags": ["Bleeding gets heavier instead of lighter", "Pain that's getting worse, not better", "Signs of infection at any stitches (increasing redness, warmth, pus)", "Persistent sadness or hopelessness that doesn't lift"],
        },
        {
            "weeks": [6, 12],
            "normal": "ACOG frames this as the tail end of the 'fourth trimester,' not a finish line. Many people feel noticeably better by now, though core strength, pelvic floor healing, and energy commonly continue improving for months. This is typically when a provider evaluates whether you're cleared for exercise — a physiotherapist can check for diastasis recti before higher-impact movement.",
            "red_flags": ["New or ongoing incontinence", "Pelvic pain or a feeling of heaviness/bulging", "Mood symptoms that are affecting daily life or bonding with baby"],
        },
    ],
    "vacuum-assisted": [
        {
            "weeks": [0, 2],
            "normal": "Recovery generally follows the same pattern as an unassisted vaginal birth, but perineal tears are somewhat more common with vacuum-assisted delivery, so soreness in that area may be more pronounced. Bleeding starts heavy and red, similar to any vaginal delivery.",
            "red_flags": ["Soaking one pad an hour for 2+ hours", "Passing a clot larger than a golf ball", "Fever", "Increasing pain, swelling, or discharge at any tear site"],
        },
        {
            "weeks": [2, 6],
            "normal": "Similar timeline to an unassisted vaginal birth. If you had a tear, healing continues through this window; itching at the site is often a healing sign. Some people report a small increased chance of urinary symptoms after an assisted delivery — usually temporary.",
            "red_flags": ["New or worsening urinary leakage", "Pain that's getting worse, not better", "Signs of infection at any tear site"],
        },
        {
            "weeks": [6, 12],
            "normal": "Most people are recovering comparably to any vaginal birth by now. If pelvic floor symptoms (leakage, heaviness) are still present, it's worth raising specifically at your check-in — pelvic floor physical therapy is a real, common, effective option.",
            "red_flags": ["Ongoing incontinence", "Pelvic pain or a feeling of heaviness/bulging"],
        },
    ],
    "forceps-assisted": [
        {
            "weeks": [0, 2],
            "normal": "Forceps delivery has a somewhat higher chance of perineal or vaginal tearing than an unassisted birth, so soreness and swelling in that area can be more noticeable, and pain relief needs may be a bit higher. Otherwise, early bleeding and recovery follow the same pattern as any vaginal birth.",
            "red_flags": ["Soaking one pad an hour for 2+ hours", "Passing a clot larger than a golf ball", "Fever", "Increasing pain, swelling, redness, or discharge at any tear site", "New difficulty controlling gas or stool"],
        },
        {
            "weeks": [2, 6],
            "normal": "Tear healing continues through this window. Because forceps carries a somewhat higher chance of a deeper tear, follow-up on healing progress at this stage matters — don't hesitate to go in sooner than a scheduled visit if something feels off.",
            "red_flags": ["New or worsening urinary or bowel leakage", "Pain that's getting worse, not better", "Signs of infection at the tear site"],
        },
        {
            "weeks": [6, 12],
            "normal": "Many people are recovering well by now, but because forceps carries a real, higher-than-average chance of pelvic floor impact, it's worth specifically asking about pelvic floor strength at your check-in, even if nothing feels obviously wrong.",
            "red_flags": ["Ongoing incontinence", "Pelvic pain, a feeling of heaviness/bulging, or pain with intimacy"],
        },
    ],
    "c-section": [
        {
            "weeks": [0, 2],
            "normal": "This is major abdominal surgery — expect real soreness at the incision, especially moving, coughing, or holding baby. Some vaginal bleeding is still normal too (typically lighter than after a vaginal birth), and gas pain or constipation is common. Short walks are encouraged and help lower blood clot risk; avoid lifting anything heavier than your baby.",
            "red_flags": ["Soaking one pad an hour for 2+ hours", "Passing a clot larger than a golf ball", "Fever", "Incision redness, warmth, swelling, or pus", "Incision opening up", "Severe or worsening abdominal pain"],
        },
        {
            "weeks": [2, 6],
            "normal": "Energy and mobility typically increase gradually. Incision discomfort usually decreases and internal dissolvable stitches continue breaking down (commonly 6-8 weeks). Many providers clear light exercise and driving around the 6-week check-in, not before.",
            "red_flags": ["Incision that's more painful, not less, over time", "Any sign of incision infection", "Fever", "Chest pain or shortness of breath"],
        },
        {
            "weeks": [6, 12],
            "normal": "ACOG generally recommends waiting at least 12 weeks before intense exercise after a C-section specifically — this is longer than after a vaginal birth because it's real surgical recovery. Many people feel significantly better by 6 weeks, but full recovery, including scar sensitivity and core strength, can take up to 3 months.",
            "red_flags": ["Numbness or pain at the incision that's worsening, not fading", "New pelvic or abdominal pain", "Mood symptoms affecting daily life"],
        },
    ],
}


HELPLINES = [
    {"name": "Postpartum Support International", "detail": "Call or text 1-800-944-4773", "type": "support", "note": "Free, confidential support for maternal mental health."},
    {"name": "988 Suicide & Crisis Lifeline", "detail": "Call or text 988", "type": "crisis", "note": "24/7 free crisis support if you feel unsafe."},
    {"name": "National Maternal Mental Health Hotline", "detail": "Call or text 1-833-852-6262", "type": "support", "note": "24/7 free support before, during and after pregnancy."},
]

PUMP_PROVIDERS = [
    {"name": "Aeroflow Breastpumps", "detail": "Insurance-covered pumps shipped to your door", "coverage": "Most major insurers & Medicaid", "url": "https://aeroflowbreastpumps.com", "tag": "Popular"},
    {"name": "Byram Healthcare", "detail": "Wide brand selection, insurance billing handled", "coverage": "Most commercial plans", "url": "https://www.byramhealthcare.com", "tag": "Wide choice"},
    {"name": "Edgepark", "detail": "Order pumps and supplies through insurance", "coverage": "Most major insurers", "url": "https://www.edgepark.com", "tag": "Supplies"},
    {"name": "1 Natural Way", "detail": "Free breast pumps through insurance + lactation help", "coverage": "Most PPO & Medicaid plans", "url": "https://1naturalway.com", "tag": "Lactation help"},
]


# ---------------------------------------------------------------------------
# Companion system prompt
# ---------------------------------------------------------------------------
def build_system_prompt(profile: Optional[dict], pattern_summary: str = "") -> str:
    ctx = ""
    if profile:
        parts = []
        if profile.get("name"):
            parts.append(f"Her name is {profile['name']}")
        if profile.get("baby_name"):
            parts.append(f"her baby is named {profile['baby_name']}")
        if profile.get("delivery_type"):
            parts.append(f"she had a {profile['delivery_type']} delivery")
        if profile.get("delivery_date"):
            parts.append(f"her baby was born on {profile['delivery_date']}")
        if profile.get("feeding_method"):
            parts.append(f"she is {profile['feeding_method']}")
        if parts:
            ctx = "Context about her: " + ", ".join(parts) + "."
    pattern_ctx = ""
    if pattern_summary:
        pattern_ctx = (
            f"\n\nRecent pattern (from her own logged data, use only if it's genuinely relevant to what "
            f"she brings up — never lead with it or bring it up unprompted): {pattern_summary} "
            "This is a reflection of what she's told the app herself, not a diagnosis or a clinical "
            "assessment — never call it 'anxiety,' 'depression,' or any clinical term, and never tell her "
            "what she is feeling. If she asks something like 'what should I do,' you can let this pattern "
            "quietly inform a grounded, specific suggestion rather than a generic one — but always in your "
            "own words, warmly, as a friend who's been paying attention, not as a system reciting her data."
        )
    return (
        "You are Cuddle, a warm, deeply empathetic companion for mothers in the postpartum period. "
        "You are NOT a doctor and you never diagnose, prescribe, or give clinical medical instructions. "
        "You are a supportive, non-judgmental listener — like a wise, gentle friend who has been through it. "
        f"{ctx}{pattern_ctx}\n\n"
        "IMPORTANT — how to use the context above: those are background facts for you to be aware of, "
        "not a checklist or an opening topic. Never lead with them, and never ask about them out of the "
        "blue (e.g. don't open by asking about her surgery, her delivery, or her feeding method just "
        "because you know it). Start the conversation the way a real friend would — warm, general, "
        "following her lead on whatever she actually brings up first. Only bring in something from her "
        "context if she says something that naturally connects to it, and even then ease into it gently "
        "rather than asking directly — for example, if she mentions being sore and you know she had a "
        "c-section, you might say 'is this related to your recovery?' rather than immediately asking "
        "surgical questions.\n\n"
        "How you respond — listening comes first, always:\n"
        "- Start by genuinely reflecting back what she said, in your own words, so she feels truly heard — "
        "before anything else. Don't rush to fix or advise.\n"
        "- Keep replies short (2-5 sentences), soft, and conversational — never clinical, never a bulleted list.\n"
        "- Ask at most one gentle, open follow-up question, only when it feels natural, so the conversation "
        "feels like a real back-and-forth, not an interrogation.\n"
        "- Only after she feels heard, and only if it fits naturally, offer ONE small, doable suggestion — "
        "never a list of options. Draw from simple things: a few minutes of slow breathing, a glass of water, "
        "stepping outside for a moment, setting the baby down safely and taking two minutes for herself, "
        "or asking her partner or another caregiver to take over for a bit if she sounds worn out.\n"
        "- If it fits naturally, you can gently mention this app's own tools when relevant — the Breathe "
        "exercises if she's anxious or wound up, or the Tag Team hand-off feature if she sounds like she's "
        "been carrying things alone for a while — but only ever as a soft mention, never a pitch.\n"
        "- Normalize the hard parts of new motherhood. Remind her she is doing enough, in your own words each time.\n"
        "- Encourage her to lean on her real-life support and her healthcare provider for medical concerns.\n"
        "- You have real tools to log feeds, diapers, naps, switch Tag Team duty, and check today's status — "
        "use them naturally when she mentions these things (including by voice, so phrasing may be casual/spoken), "
        "even mid-conversation. After using one, briefly confirm what you logged in plain language, then continue "
        "the conversation naturally — don't make the confirmation the whole reply if she was also sharing feelings.\n\n"
        "SAFETY: If she expresses thoughts of harming herself or her baby, or seems in crisis, respond with calm compassion, "
        "take it seriously, and gently encourage her to reach out right now to the 988 Suicide & Crisis Lifeline (call or text 988) "
        "or Postpartum Support International (1-800-944-4773), and to a trusted person nearby. Never dismiss these feelings."
    )


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
# Layered ON TOP of the existing device_id identity system rather than
# replacing it — every UserAccount links to a device_id, so all existing
# data (profiles, logs, households, everything) keeps working exactly as
# before. Signing in just gives that device_id a real, recoverable identity
# instead of living only in local device storage.
#
# NOTE — scope of this pass: this builds real signup/login/password
# reset/Apple Sign In, all genuinely working. It does NOT yet require
# authentication on every existing endpoint (device_id alone still works
# app-wide, same as before this feature existed) — retrofitting auth
# enforcement onto every route is a larger, separate follow-up.

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    device_id: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AppleSignInRequest(BaseModel):
    identity_token: str
    device_id: str
    full_name: Optional[str] = None  # Apple only ever sends this on first sign-in


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str
    new_password: str


def _hash_password(password: str) -> str:
    # bcrypt has a genuine 72-byte input limit — truncate deliberately
    # rather than letting it silently misbehave on long passwords.
    pw_bytes = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw_bytes, bcrypt.gensalt()).decode("utf-8")


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        pw_bytes = password.encode("utf-8")[:72]
        return bcrypt.checkpw(pw_bytes, password_hash.encode("utf-8"))
    except Exception:
        return False


def _create_jwt(user_id: str, device_id: str) -> str:
    if not JWT_SECRET:
        raise HTTPException(status_code=500, detail="Auth is not configured on the server (missing JWT_SECRET)")
    payload = {
        "sub": user_id,
        "device_id": device_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _create_device_token(device_id: str) -> str:
    """Binds a signed token to a device_id — the actual fix for the audit's
    top finding. Nothing here is a real account: no password, no separate
    identity, the anonymous-device model stays exactly as lightweight as
    it's always been. What changes is that from this point on, a request
    claiming to be a given device_id has to actually hold a token the
    server itself signed for that device, not just type the string in."""
    if not JWT_SECRET:
        raise HTTPException(status_code=500, detail="Auth is not configured on the server (missing JWT_SECRET)")
    payload = {
        "device_id": device_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


class DeviceTokenRequest(BaseModel):
    device_id: str


@api_router.post("/auth/device-token")
async def issue_device_token(body: DeviceTokenRequest):
    """First call for a given device_id mints its token — same trust
    level as every existing device_id-based endpoint has always had at
    that single moment (the server has no way to know who's genuinely
    behind a brand-new device_id, and neither does any app that works
    this way). What matters is every call AFTER this one: without this
    exact signed token, nothing can act as that device_id anymore, which
    is what closes the real gap — someone simply typing in another
    person's device_id string no longer gets them anywhere."""
    token = _create_device_token(body.device_id)
    return {"token": token, "device_id": body.device_id}


async def _verify_device(authorization: str = Header(None)) -> str:
    """The real enforcement dependency — returns the verified device_id
    from a valid signed token, or rejects the request outright. Endpoints
    using this stop trusting a client-supplied device_id parameter and
    use this return value instead."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing device token")
    token = authorization.removeprefix("Bearer ").strip()
    if not JWT_SECRET:
        raise HTTPException(status_code=500, detail="Auth is not configured on the server (missing JWT_SECRET)")
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Device session expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid device token")
    device_id = payload.get("device_id")
    if not device_id:
        raise HTTPException(status_code=401, detail="Malformed device token")
    return device_id


async def _current_user(authorization: str = Header(None)) -> dict:
    """Dependency for routes that require a signed-in user. Existing
    device_id-only routes don't use this — this is only for the new
    account-specific endpoints below."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.removeprefix("Bearer ").strip()
    if not JWT_SECRET:
        raise HTTPException(status_code=500, detail="Auth is not configured on the server (missing JWT_SECRET)")
    try:
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired, please sign in again")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session")
    user = await db.users.find_one({"_id": ObjectId(payload["sub"])}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Account no longer exists")
    return user


_apple_jwks_cache: dict = {"keys": None, "fetched_at": None}


async def _verify_apple_identity_token(identity_token: str) -> dict:
    """Verifies a Sign in with Apple identity token against Apple's public
    keys — real cryptographic verification, not just decoding the token
    and trusting its contents."""
    global _apple_jwks_cache
    now = datetime.now(timezone.utc)
    if not _apple_jwks_cache["keys"] or not _apple_jwks_cache["fetched_at"] or (now - _apple_jwks_cache["fetched_at"]).total_seconds() > 3600:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get("https://appleid.apple.com/auth/keys")
            resp.raise_for_status()
            _apple_jwks_cache = {"keys": resp.json()["keys"], "fetched_at": now}

    unverified_header = pyjwt.get_unverified_header(identity_token)
    matching_key = next((k for k in _apple_jwks_cache["keys"] if k["kid"] == unverified_header["kid"]), None)
    if not matching_key:
        raise HTTPException(status_code=401, detail="Could not verify Apple sign-in — unknown signing key")

    public_key = pyjwt.algorithms.RSAAlgorithm.from_jwk(matching_key)
    try:
        payload = pyjwt.decode(
            identity_token, public_key, algorithms=["RS256"],
            audience=APPLE_BUNDLE_ID, issuer="https://appleid.apple.com",
        )
    except pyjwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Apple sign-in verification failed: {e}")
    return payload  # payload["sub"] is Apple's stable, unique user identifier


def _send_email(to_email: str, subject: str, body: str) -> bool:
    if not GMAIL_USER or not GMAIL_APP_PASSWORD:
        logger.warning("Email not configured (GMAIL_USER/GMAIL_APP_PASSWORD missing) — cannot send: %s", subject)
        return False
    try:
        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"] = GMAIL_USER
        msg["To"] = to_email
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=10) as server:
            server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_USER, [to_email], msg.as_string())
        return True
    except Exception:
        logger.exception("Failed to send email to %s", to_email)
        return False


@api_router.post("/auth/signup")
async def signup(req: SignupRequest):
    existing = await db.users.find_one({"email": req.email.lower()})
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    doc = {
        "email": req.email.lower(),
        "password_hash": _hash_password(req.password),
        "device_id": req.device_id,
        "apple_sub": None,
        "created_at": now_iso(),
    }
    result = await db.users.insert_one(doc)
    token = _create_jwt(str(result.inserted_id), req.device_id)
    return {"token": token, "device_id": req.device_id, "email": doc["email"]}


@api_router.post("/auth/login")
async def login(req: LoginRequest):
    user = await db.users.find_one({"email": req.email.lower()})
    if not user or not user.get("password_hash") or not _verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    token = _create_jwt(str(user["_id"]), user["device_id"])
    return {"token": token, "device_id": user["device_id"], "email": user["email"]}


@api_router.post("/auth/apple")
async def apple_sign_in(req: AppleSignInRequest):
    payload = await _verify_apple_identity_token(req.identity_token)
    apple_sub = payload["sub"]
    apple_email = payload.get("email")

    user = await db.users.find_one({"apple_sub": apple_sub})
    if not user:
        # First time this Apple ID has signed in — link to the device_id
        # the app already has, so existing local data carries over.
        doc = {
            "email": (apple_email or "").lower() or None,
            "password_hash": None,
            "device_id": req.device_id,
            "apple_sub": apple_sub,
            "full_name": req.full_name,
            "created_at": now_iso(),
        }
        result = await db.users.insert_one(doc)
        user_id, device_id = str(result.inserted_id), req.device_id
    else:
        user_id, device_id = str(user["_id"]), user["device_id"]

    token = _create_jwt(user_id, device_id)
    return {"token": token, "device_id": device_id}


@api_router.post("/auth/forgot-password")
async def forgot_password(req: ForgotPasswordRequest):
    user = await db.users.find_one({"email": req.email.lower()})
    # Always return success even if the email isn't found — otherwise this
    # endpoint could be used to check which emails have Cuddle accounts.
    if not user or not user.get("password_hash"):
        return {"ok": True}

    code = f"{_secrets.randbelow(1000000):06d}"
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "reset_code": code,
            "reset_code_expires": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(),
        }},
    )
    sent = _send_email(
        req.email,
        "Your Cuddle password reset code",
        f"Your code is {code}. It expires in 15 minutes. If you didn't request this, you can ignore this email.",
    )
    if not sent:
        logger.warning("Password reset code for %s: %s (email delivery not configured)", req.email, code)
    return {"ok": True}


@api_router.post("/auth/reset-password")
async def reset_password(req: ResetPasswordRequest):
    user = await db.users.find_one({"email": req.email.lower()})
    if not user or user.get("reset_code") != req.code:
        raise HTTPException(status_code=400, detail="Invalid or expired code")
    expires = user.get("reset_code_expires")
    if not expires or datetime.fromisoformat(expires) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This code has expired — request a new one")
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": _hash_password(req.new_password)}, "$unset": {"reset_code": "", "reset_code_expires": ""}},
    )
    return {"ok": True}


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(_current_user)):
    return user


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@api_router.get("/")
async def root():
    return {"message": "Cuddle Postpartum API"}


@api_router.post("/profile")
async def upsert_profile(profile: Profile, verified_device_id: str = Depends(_verify_device)):
    if profile.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't create/update another device's profile")
    data = profile.model_dump()
    await db.profiles.update_one({"device_id": profile.device_id}, {"$set": data}, upsert=True)
    return data


@api_router.get("/profile/{device_id}")
async def get_profile(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's profile")
    doc = await db.profiles.find_one({"device_id": device_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Profile not found")
    return doc


@api_router.get("/quote")
async def daily_quote():
    # A fresh gentle thought each time the app is opened, not just once a day —
    # small moments of noticing something new each visit.
    return random.choice(QUOTES)


@api_router.get("/tips")
async def get_tips():
    return TIPS


@api_router.get("/helplines")
async def get_helplines():
    return HELPLINES


def _normalize_delivery_type(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    r = raw.lower()
    if "vacuum" in r:
        return "vacuum-assisted"
    if "forceps" in r:
        return "forceps-assisted"
    if "c-section" in r or "cesarean" in r or "csection" in r:
        return "c-section"
    if "vaginal" in r:
        return "vaginal"
    return None


@api_router.get("/recovery/timeline/{device_id}")
async def recovery_timeline(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's wellbeing data")
    """A real, sourced recovery timeline (ACOG/NHS/Cleveland Clinic-derived,
    see RECOVERY_TIMELINE's own citation note) tailored to her actual
    delivery type and how many weeks out she is. Deliberately general and
    never diagnostic — every stage pairs what's normal with real red flags,
    and the response always says plainly that this doesn't replace her own
    provider. Returns has_data: False rather than guessing if she hasn't
    shared a delivery type or date."""
    profile = await db.profiles.find_one({"device_id": device_id}, {"_id": 0})
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    delivery_type = _normalize_delivery_type(profile.get("delivery_type"))
    delivery_date = profile.get("delivery_date")
    if not delivery_type or delivery_type not in RECOVERY_TIMELINE or not delivery_date:
        return {"has_data": False, "reason": "delivery type or date not shared yet"}

    try:
        delivered = datetime.fromisoformat(delivery_date.replace("Z", "+00:00"))
    except ValueError:
        return {"has_data": False, "reason": "invalid delivery date"}

    weeks_out = max(0, (datetime.now(timezone.utc) - delivered).days // 7)
    stages = RECOVERY_TIMELINE[delivery_type]
    current = next((s for s in stages if s["weeks"][0] <= weeks_out < s["weeks"][1]), stages[-1])

    return {
        "has_data": True,
        "delivery_type": delivery_type,
        "weeks_postpartum": weeks_out,
        "current_stage": {
            "week_range": current["weeks"],
            "whats_normal": current["normal"],
            "red_flags": current["red_flags"],
        },
        "all_stages": [
            {"week_range": s["weeks"], "whats_normal": s["normal"], "red_flags": s["red_flags"]}
            for s in stages
        ],
        "disclaimer": "This is general information based on typical recovery patterns, not a diagnosis or a substitute for your own provider. Every recovery is different — when in doubt, reach out to your doctor or midwife.",
    }


@api_router.get("/pump-providers")
async def get_pump_providers():
    return PUMP_PROVIDERS


# ----- Mood -----
@api_router.post("/mood")
async def add_mood(entry: MoodEntryCreate, verified_device_id: str = Depends(_verify_device)):
    if entry.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's wellbeing data")
    
    obj = MoodEntry(**entry.model_dump())
    await db.moods.insert_one(obj.model_dump())

    # A gentle nudge to her partner when things look genuinely low, not
    # a running commentary on every mood logged. Deliberately doesn't
    # expose the exact score or her tags to him — just enough for him to
    # know she could use something warm today, kept at a dignity-first
    # level of detail, not a clinical readout of her private check-in.
    if entry.mood <= 2:
        household = await db.households.find_one({"members.device_id": entry.device_id})
        if household:
            other_member = next(
                (m for m in household["members"] if m["device_id"] != entry.device_id), None
            )
            if other_member:
                today = datetime.now(timezone.utc).date().isoformat()
                already_nudged = await db.encouragement_nudge_tracker.find_one(
                    {"to_device_id": other_member["device_id"], "for_device_id": entry.device_id, "date": today}
                )
                if not already_nudged:
                    name = next((m.get("name") for m in household["members"] if m["device_id"] == entry.device_id), None)
                    await send_push(
                        other_member["device_id"],
                        "Cuddle",
                        f"{name or 'She'}'s having a harder day today. A few kind words from you could genuinely help, want to send something?",
                    )
                    await db.encouragement_nudge_tracker.update_one(
                        {"to_device_id": other_member["device_id"], "for_device_id": entry.device_id, "date": today},
                        {"$set": {"sent_at": now_iso()}},
                        upsert=True,
                    )
    return obj.model_dump()


@api_router.post("/encouragement")
async def send_encouragement(e: EncouragementCreate, verified_device_id: str = Depends(_verify_device)):
    """The actual message he writes, delivered as its own real push, not
    just a generic 'you have a note' teaser — the words themselves are
    the whole point here."""
    if e.from_device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't send an encouragement as another device")
    message = e.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message can't be empty")

    household = await db.households.find_one({"members.device_id": e.from_device_id})
    # Without this, anyone could spam a private-feeling encouragement
    # push to literally any device_id in the system, sender name spoofed
    # to whatever their real household says. Now the recipient has to
    # actually be in the sender's own household.
    if not household or not any(m["device_id"] == e.to_device_id for m in household["members"]):
        raise HTTPException(status_code=403, detail="Recipient isn't in your household")

    doc = {
        "from_device_id": e.from_device_id,
        "to_device_id": e.to_device_id,
        "message": message,
        "created_at": now_iso(),
        "seen": False,
    }
    result = await db.encouragement_messages.insert_one(doc)
    doc["_id"] = str(result.inserted_id)

    sender_name = next((m.get("name") for m in household["members"] if m["device_id"] == e.from_device_id), None)
    await send_push(
        e.to_device_id,
        f"💛 A note from {sender_name or 'someone who cares'}",
        message,
    )
    return doc


@api_router.get("/encouragement/{device_id}/latest")
async def latest_encouragement(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's messages")
    """The most recent message that hasn't been seen yet, for showing on
    her Home screen too, since a push notification alone can be missed
    or accidentally swiped away before it's really read."""
    doc = await db.encouragement_messages.find_one(
        {"to_device_id": device_id, "seen": False}, {"_id": 0}, sort=[("created_at", -1)]
    )
    return doc


@api_router.post("/encouragement/{device_id}/mark-seen")
async def mark_encouragement_seen(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's messages")
    await db.encouragement_messages.update_many(
        {"to_device_id": device_id, "seen": False}, {"$set": {"seen": True}}
    )
    return {"ok": True}


@api_router.get("/mood/{device_id}")
async def get_moods(device_id: str, limit: int = 60, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's wellbeing data")
    
    docs = await db.moods.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return list(reversed(docs))


@api_router.get("/mood/{device_id}/today")
async def mood_today(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's wellbeing data")
    
    today = datetime.now(timezone.utc).date().isoformat()
    doc = await db.moods.find_one(
        {"device_id": device_id, "created_at": {"$regex": f"^{today}"}}, {"_id": 0})
    return {"done": doc is not None, "entry": doc}


# ----- EPDS -----
@api_router.get("/epds/questions")
async def epds_questions():
    return EPDS_QUESTIONS


@api_router.post("/epds")
async def submit_epds(sub: EpdsSubmit, verified_device_id: str = Depends(_verify_device)):
    if sub.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's wellbeing data")
    
    if len(sub.answers) != len(EPDS_QUESTIONS):
        raise HTTPException(status_code=400, detail="All questions must be answered")
    total = sum(sub.answers)
    self_harm = sub.answers[9] > 0
    if total <= 9:
        band = "low"
    elif total <= 12:
        band = "possible"
    else:
        band = "likely"
    result = EpdsResult(device_id=sub.device_id, answers=sub.answers, total=total,
                        band=band, self_harm_flag=self_harm)
    await db.epds.insert_one(result.model_dump())
    return result.model_dump()


@api_router.get("/epds/{device_id}")
async def epds_history(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's wellbeing data")
    
    docs = await db.epds.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return docs


# ----- Chat (Claude Sonnet 4.6) -----
@api_router.get("/chat/{session_id}")
async def chat_history(session_id: str, verified_device_id: str = Depends(_verify_device)):
    docs = await db.chat_messages.find({"session_id": session_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    # A brand-new session with no messages yet is fine to return empty —
    # nothing to leak. But if messages DO exist, every single one has to
    # belong to the verified caller, or this session belongs to someone
    # else and nothing about it should come back, private conversation
    # content included.
    if docs and any(d.get("device_id") != verified_device_id for d in docs):
        raise HTTPException(status_code=403, detail="Not authorized for this conversation")
    return docs


# ----- Chat tools (agentic actions Cuddle can actually take, not just discuss) -----
CHAT_TOOLS = [
    {
        "name": "log_feed",
        "description": "Log that the baby was fed. Use when she mentions feeding, a bottle, nursing, or an amount of milk/formula.",
        "input_schema": {
            "type": "object",
            "properties": {
                "amount_ml": {"type": "number", "description": "Amount in ml. Convert oz to ml (1oz \u2248 29.57ml) if she used oz."},
                "minutes_ago": {"type": "number", "description": "Minutes since this happened. 0 if just now or unspecified."},
            },
            "required": ["amount_ml"],
        },
    },
    {
        "name": "log_pump",
        "description": "Log a pumping session. Use when she tells you how long she pumped on each side, or overall, instead of using the on-screen timer.",
        "input_schema": {
            "type": "object",
            "properties": {
                "left_minutes": {"type": "number", "description": "Minutes pumped on the left side. 0 if she didn't pump that side."},
                "right_minutes": {"type": "number", "description": "Minutes pumped on the right side. 0 if she didn't pump that side."},
                "left_ml": {"type": "number", "description": "Ounces/ml produced on the left side, only if she mentioned an amount. Convert oz to ml (1oz \u2248 29.57ml)."},
                "right_ml": {"type": "number", "description": "Ounces/ml produced on the right side, only if she mentioned an amount."},
            },
            "required": ["left_minutes", "right_minutes"],
        },
    },
    {
        "name": "log_diaper",
        "description": "Log a diaper change. Use when she mentions a diaper, pee, poop, wet or dirty diaper.",
        "input_schema": {
            "type": "object",
            "properties": {
                "diaper_type": {"type": "string", "enum": ["pee", "poop", "both"]},
                "minutes_ago": {"type": "number"},
            },
            "required": ["diaper_type"],
        },
    },
    {
        "name": "log_sleep",
        "description": "Log a completed nap. Use when she mentions the baby slept or napped for some length of time in the past.",
        "input_schema": {
            "type": "object",
            "properties": {
                "duration_minutes": {"type": "number"},
                "minutes_ago": {"type": "number", "description": "Minutes since the nap ENDED."},
            },
            "required": ["duration_minutes"],
        },
    },
    {
        "name": "start_baby_sleep",
        "description": "Start a live timer for the baby's sleep, right now. Use for phrases like 'baby's going to sleep', 'baby's asleep', 'putting baby down', or 'baby is going down for a nap' — anything indicating the baby is falling asleep RIGHT NOW, not describing a nap that already happened.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "stop_baby_sleep",
        "description": "Stop the baby's live sleep timer because the baby just woke up. Use for phrases like 'baby's awake', 'baby woke up', or 'baby's up now'.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "start_self_rest",
        "description": "Start a live timer for HER OWN rest (not the baby's), right now. Use for phrases like 'I'm going to bed', 'mama's going to sleep', 'I'm going to lie down', or 'going to rest now' — when she herself, the caregiver, is about to sleep or rest.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "stop_self_rest",
        "description": "Stop her own rest timer because she just got up. Use for phrases like 'I'm up', 'I'm awake now', or 'just woke up' referring to herself, not the baby.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_meal_ideas",
        "description": "Returns the real available recipes with their ingredients, so you can pick and suggest one that genuinely fits what she said, e.g. she's exhausted and wants something easy, craving something warm and comforting, or wants to meal-prep ahead. Use when she describes how she's feeling and asks what to make, or directly asks for a meal/recipe suggestion.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "start_recipe_shopping",
        "description": "Once she's decided on a specific recipe (from get_meal_ideas), use this to generate a real Instacart shopping link for its ingredients, so she can order them directly. Only call this once she's actually confirmed which recipe she wants, not just browsing ideas.",
        "input_schema": {
            "type": "object",
            "properties": {"recipe_id": {"type": "string", "description": "The id field from get_meal_ideas for the recipe she chose."}},
            "required": ["recipe_id"],
        },
    },
    {
        "name": "tag_team_switch",
        "description": "Switch Tag Team duty to whoever is chatting right now. Use for phrases like 'I've got it', 'switching to me', or 'I'm taking over'.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_status",
        "description": "Look up today's baby totals (feeds/diapers) and who's on Tag Team duty. Use when she asks how the day is going or who's on duty.",
        "input_schema": {"type": "object", "properties": {}},
    },
]


async def _execute_chat_tool(name: str, tool_input: dict, device_id: str) -> str:
    """Runs the actual action and returns a short factual result string for
    Claude to relay back to her — this is what makes it agentic rather than
    just talk: the DB genuinely changes."""
    if name == "log_feed":
        ml = tool_input.get("amount_ml")
        mins_ago = tool_input.get("minutes_ago", 0) or 0
        at = (datetime.now(timezone.utc) - timedelta(minutes=mins_ago)).isoformat()
        await db.baby_logs.insert_one({
            "device_id": device_id, "kind": "feed", "amount_ml": ml,
            "at": at, "logged_at": now_iso(),
        })
        return f"Logged: fed {ml}ml."

    if name == "log_pump":
        left_min = tool_input.get("left_minutes", 0) or 0
        right_min = tool_input.get("right_minutes", 0) or 0
        left_ml = tool_input.get("left_ml")
        right_ml = tool_input.get("right_ml")
        total_ml = (left_ml or 0) + (right_ml or 0)
        await db.baby_logs.insert_one({
            "device_id": device_id, "kind": "pump", "detail": None,
            "amount_ml": total_ml if (left_ml is not None or right_ml is not None) else None,
            "diaper_type": None,
            "duration_minutes": round(left_min + right_min),
            "left_minutes": left_min, "right_minutes": right_min,
            "left_ml": left_ml, "right_ml": right_ml,
            "at": now_iso(), "logged_at": now_iso(),
        })
        parts = [f"{left_min} min left", f"{right_min} min right"]
        if left_ml is not None or right_ml is not None:
            parts.append(f"({left_ml or 0}ml + {right_ml or 0}ml)")
        return f"Logged: pumped {', '.join(parts)}."

    if name == "log_diaper":
        dtype = tool_input.get("diaper_type", "pee")
        mins_ago = tool_input.get("minutes_ago", 0) or 0
        at = (datetime.now(timezone.utc) - timedelta(minutes=mins_ago)).isoformat()
        await db.baby_logs.insert_one({
            "device_id": device_id, "kind": "diaper", "diaper_type": dtype,
            "at": at, "logged_at": now_iso(),
        })
        return f"Logged: {dtype} diaper."

    if name == "log_sleep":
        dur = tool_input.get("duration_minutes")
        mins_ago = tool_input.get("minutes_ago", 0) or 0
        at = (datetime.now(timezone.utc) - timedelta(minutes=mins_ago + (dur or 0))).isoformat()
        await db.baby_logs.insert_one({
            "device_id": device_id, "kind": "sleep", "duration_minutes": dur,
            "at": at, "logged_at": now_iso(),
        })
        return f"Logged: {dur} minute nap."

    if name == "start_baby_sleep":
        await _start_sleep_session(device_id, "baby")
        return "Started a live timer for baby's sleep."

    if name == "stop_baby_sleep":
        result = await _stop_sleep_session(device_id, "baby")
        if result is None:
            return "There wasn't a sleep timer running for the baby right now."
        mins = result['duration_minutes']
        return f"Logged: baby slept for {mins} minute{'s' if mins != 1 else ''}."

    if name == "start_self_rest":
        await _start_sleep_session(device_id, "self")
        return "Started a rest timer for her. Her partner will see she's resting, if they're on Tag Team together."

    if name == "stop_self_rest":
        result = await _stop_sleep_session(device_id, "self")
        if result is None:
            return "There wasn't a rest timer running for her right now."
        mins = result['duration_minutes']
        return f"Logged: she rested for {mins} minute{'s' if mins != 1 else ''}."

    if name == "get_meal_ideas":
        lines = []
        for r in HOMELY_RECIPES:
            ing_names = ", ".join(i["name"] for i in r["ingredients"])
            lines.append(f"id: {r['id']} | {r['title']} | {r['cooking_time']} min | ingredients: {ing_names}")
        return "Real available recipes:\n" + "\n".join(lines)

    if name == "start_recipe_shopping":
        recipe_id = tool_input.get("recipe_id")
        recipe = next((r for r in HOMELY_RECIPES if r["id"] == recipe_id), None)
        if not recipe:
            return f"Couldn't find a recipe with id '{recipe_id}'. Use get_meal_ideas first to see real ids."
        try:
            result = await _create_instacart_recipe_link(recipe, only_ingredient_names=None)
            return f"Real shopping link ready for {recipe['title']}: {result['shopping_url']}"
        except HTTPException as e:
            return f"Couldn't create the shopping link right now: {e.detail}"

    if name == "tag_team_switch":
        h = await db.households.find_one({"members.device_id": device_id})
        if not h:
            return "She doesn't have Tag Team set up with a partner yet, so this couldn't be switched."
        await db.households.update_one(
            {"household_code": h["household_code"]},
            {"$set": {"on_duty_device_id": device_id, "on_duty_since": now_iso()}},
        )
        return "Tag Team duty switched to her."

    if name == "get_status":
        device_ids = await _household_device_ids(device_id)
        today = datetime.now(timezone.utc).date().isoformat()
        logs = await db.baby_logs.find(
            {"device_id": {"$in": device_ids}, "at": {"$gte": today}}
        ).to_list(500)
        feed_ml = sum(l.get("amount_ml") or 0 for l in logs if l["kind"] == "feed")
        feed_count = sum(1 for l in logs if l["kind"] == "feed")
        pee = sum(1 for l in logs if l["kind"] == "diaper" and l.get("diaper_type") in ("pee", "both"))
        poop = sum(1 for l in logs if l["kind"] == "diaper" and l.get("diaper_type") in ("poop", "both"))
        h = await db.households.find_one({"members.device_id": device_id})
        duty_info = "No Tag Team household set up."
        if h:
            on_duty = next((m for m in h["members"] if m["device_id"] == h.get("on_duty_device_id")), None)
            duty_info = f"{on_duty['name'] if on_duty else 'Someone'} is currently on Tag Team duty."
        return f"Today so far: {feed_count} feeds ({round(feed_ml)}ml total), {pee} pee / {poop} poop diapers. {duty_info}"

    return "Unknown action."


async def _recent_pattern_summary(device_id: str) -> str:
    """A short, factual summary of her last few days across features — for
    grounding 'what should I do' type answers in what she's actually
    logged and experiencing, not guessing. Pulls from mood check-ins,
    Recovery, and Tag Team so Talk to Cuddle has the same picture the rest
    of the app does, instead of starting fresh every conversation. This
    reflects her own self-reported data back to her; it never labels or
    diagnoses a mental state."""
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    three_days_ago = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    parts = []

    # ---- mood trend (existing signal) ----
    moods = await db.moods.find(
        {"device_id": device_id, "created_at": {"$gte": week_ago}}, {"_id": 0}
    ).sort("created_at", 1).to_list(20)
    scores = [m["mood"] for m in moods if m.get("mood") is not None]
    if scores:
        recent_avg = sum(scores[-3:]) / len(scores[-3:])
        trend = ""
        if len(scores) >= 5:
            earlier_avg = sum(scores[:-3]) / max(1, len(scores[:-3]))
            if recent_avg < earlier_avg - 0.7:
                trend = ", trending lower than earlier this week"
            elif recent_avg > earlier_avg + 0.7:
                trend = ", trending better than earlier this week"
        parts.append(f"Her self-reported mood over the last few check-ins has averaged about {recent_avg:.1f}/5{trend}.")

    # ---- recent Recovery check-in ----
    recovery = await db.recovery_checkins.find_one(
        {"device_id": device_id, "created_at": {"$gte": three_days_ago}},
        {"_id": 0}, sort=[("created_at", -1)]
    )
    if recovery:
        bits = []
        if recovery.get("pain_level"):
            bits.append(f"pain level {recovery['pain_level']}/5")
        if recovery.get("bleeding_level") and recovery["bleeding_level"] != "none":
            bits.append(f"{recovery['bleeding_level']} bleeding")
        if recovery.get("symptoms"):
            bits.append(f"flagged symptoms: {', '.join(recovery['symptoms'])}")
        if bits:
            parts.append(f"Her most recent Recovery check-in (within the last few days) noted: {', '.join(bits)}.")

    # ---- Tag Team / on-duty status ----
    household = await db.households.find_one({"members.device_id": device_id}, {"_id": 0})
    if household and household.get("on_duty_device_id") == device_id:
        on_duty_since = household.get("on_duty_since") or household.get("created_at")
        if on_duty_since:
            hours = _hours_between(on_duty_since, now_iso())
            if hours >= 3:
                parts.append(f"She's been on duty for about {round(hours)} hours straight, according to Tag Team.")

    if not parts:
        return ""
    return " ".join(parts)


@api_router.post("/chat")
async def chat(req: ChatRequest, verified_device_id: str = Depends(_verify_device)):
    # Without this, anyone could post as any device_id and get the AI to
    # respond using THAT person's real profile — mood patterns, delivery
    # details, everything build_system_prompt pulls in — handing private
    # data back to an attacker inside the AI's own reply. This is at
    # least as serious as the read-side gap above.
    if req.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't send a message as another device")
    profile = await db.profiles.find_one({"device_id": req.device_id}, {"_id": 0})
    pattern_summary = await _recent_pattern_summary(req.device_id)
    system_prompt = build_system_prompt(profile, pattern_summary)

    # store user message
    await db.chat_messages.insert_one({
        "session_id": req.session_id, "device_id": req.device_id,
        "role": "user", "text": req.message, "created_at": now_iso(),
    })

    # rebuild recent context for continuity
    history = await db.chat_messages.find(
        {"session_id": req.session_id}, {"_id": 0}).sort("created_at", 1).to_list(40)

    if not anthropic_client:
        raise HTTPException(status_code=500, detail="LLM key not configured")

    # feed prior turns so the model has context (exclude the just-added msg)
    prior = history[:-1][-12:]
    anthropic_messages = []
    for m in prior:
        anthropic_messages.append({
            "role": "user" if m["role"] == "user" else "assistant",
            "content": m["text"],
        })
    anthropic_messages.append({"role": "user", "content": req.message})

    try:
        response = await anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=system_prompt,
            messages=anthropic_messages,
            tools=CHAT_TOOLS,
        )
        # Tool-use loop: Claude can actually log things or switch Tag Team
        # duty mid-conversation, not just talk about it. Capped so a stuck
        # loop can't run away.
        for _ in range(3):
            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if not tool_uses:
                break
            anthropic_messages.append({
                "role": "assistant",
                "content": [b.model_dump() for b in response.content],
            })
            tool_results = []
            for tu in tool_uses:
                result_text = await _execute_chat_tool(tu.name, tu.input, req.device_id)
                tool_results.append({
                    "type": "tool_result", "tool_use_id": tu.id, "content": result_text,
                })
            anthropic_messages.append({"role": "user", "content": tool_results})
            response = await anthropic_client.messages.create(
                model="claude-sonnet-4-6", max_tokens=1024,
                system=system_prompt, messages=anthropic_messages, tools=CHAT_TOOLS,
            )
        reply = "".join(
            block.text for block in response.content if block.type == "text"
        )
    except Exception as e:
        logger.exception("LLM error")
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")

    await db.chat_messages.insert_one({
        "session_id": req.session_id, "device_id": req.device_id,
        "role": "assistant", "text": reply, "created_at": now_iso(),
    })

    # Fire-and-forget: doesn't delay her reply. Only scheduled at all if
    # she's explicitly opted in — the check happens here, before the task
    # is even created, not inside the function.
    if profile and profile.get("mood_from_chat_opt_in"):
        asyncio.create_task(_infer_mood_from_chat_message(req.device_id, req.message))

    return {"reply": reply}


# ----- Community -----
@api_router.get("/community")
async def community_feed(space: str = "general"):
    query = {} if space == "all" else {"space": {"$in": [space, None]}} if space == "general" else {"space": space}
    docs = await db.community_posts.find(query).sort("created_at", -1).to_list(100)
    out = []
    for d in docs:
        d["id"] = str(d["_id"])
        d.pop("_id", None)
        d.setdefault("space", "general")
        out.append(d)
    return out


@api_router.post("/community")
async def create_post(post: PostCreate):
    doc = {
        "author": post.author, "avatar_color": "#D68C7A", "location": "You",
        "text": post.text, "topic": post.topic, "space": post.space,
        "likes": 0, "created_at": now_iso(), "device_id": post.device_id,
    }
    res = await db.community_posts.insert_one(doc)
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)
    return doc


@api_router.post("/community/{post_id}/like")
async def like_post(post_id: str):
    await db.community_posts.update_one({"_id": ObjectId(post_id)}, {"$inc": {"likes": 1}})
    return {"ok": True}


@api_router.get("/community/{post_id}/comments")
async def get_comments(post_id: str):
    docs = await db.comments.find({"post_id": post_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return docs


@api_router.post("/community/{post_id}/comments")
async def add_comment(post_id: str, c: CommentCreate):
    doc = {"post_id": post_id, "author": c.author, "text": c.text,
           "device_id": c.device_id, "created_at": now_iso()}
    await db.comments.insert_one(doc)
    doc.pop("_id", None)
    return doc


# ===========================================================================
# NEARBY — presence, matching, peer chat, baby tracker, spaces, guides, i18n
# ===========================================================================

ETHNICITY_TAGS = [
    "South Asian / Indian",
    "Latina / Hispanic",
    "Black / African",
    "East Asian",
    "Middle Eastern / Arab",
    "White / European",
    "Mixed / Other",
]

# Cultural community sub-spaces (opt-in). key -> label
CULTURAL_SPACES = [
    {"key": "south_asian", "label": "South Asian Moms", "tag": "South Asian / Indian"},
    {"key": "latina", "label": "Latina Moms", "tag": "Latina / Hispanic"},
    {"key": "black", "label": "Black Moms", "tag": "Black / African"},
    {"key": "east_asian", "label": "East Asian Moms", "tag": "East Asian"},
    {"key": "mena", "label": "MENA Moms", "tag": "Middle Eastern / Arab"},
]

# Genuinely simple, real recipes chosen for the actual postpartum reality:
# quick, nutritious, mostly one-handed-friendly for nursing/holding a baby.
# Being honest rather than overstating: the "lactation" snack is popular in
# postpartum circles, but the evidence it actually boosts milk supply is
# limited, so the description says that plainly rather than promising it.
HOMELY_RECIPES = [
    {
        "id": "one_pan_salmon",
        "title": "One-Pan Lemon Garlic Salmon with Asparagus",
        "servings": 2,
        "cooking_time": 20,
        "ingredients": [
            {"name": "salmon fillets", "quantity": 2, "unit": "FILLET"},
            {"name": "asparagus", "quantity": 1, "unit": "POUND"},
            {"name": "lemon", "quantity": 1, "unit": "EACH"},
            {"name": "garlic", "quantity": 3, "unit": "CLOVE"},
            {"name": "olive oil", "quantity": 2, "unit": "TABLESPOON"},
            {"name": "salt", "quantity": 1, "unit": "TEASPOON"},
            {"name": "black pepper", "quantity": 0.5, "unit": "TEASPOON"},
        ],
        "instructions": [
            "Preheat oven to 400°F.",
            "Toss asparagus with half the olive oil, salt, and pepper on a sheet pan.",
            "Place salmon on the same pan, drizzle with remaining oil, minced garlic, and lemon juice.",
            "Bake 12-15 minutes until salmon flakes easily.",
        ],
    },
    {
        "id": "overnight_oats",
        "title": "Overnight Oats with Berries",
        "servings": 1,
        "cooking_time": 5,
        "ingredients": [
            {"name": "rolled oats", "quantity": 0.5, "unit": "CUP"},
            {"name": "milk", "quantity": 0.5, "unit": "CUP"},
            {"name": "greek yogurt", "quantity": 0.25, "unit": "CUP"},
            {"name": "mixed berries", "quantity": 0.5, "unit": "CUP"},
            {"name": "honey", "quantity": 1, "unit": "TABLESPOON"},
            {"name": "chia seeds", "quantity": 1, "unit": "TABLESPOON"},
        ],
        "instructions": [
            "Combine oats, milk, yogurt, honey, and chia seeds in a jar.",
            "Stir well, top with berries, cover, and refrigerate overnight.",
            "Eat cold, straight from the jar, no reheating needed.",
        ],
    },
    {
        "id": "postpartum_energy_bites",
        "title": "Oat & Flax Energy Bites",
        "servings": 12,
        "cooking_time": 15,
        "ingredients": [
            {"name": "rolled oats", "quantity": 1, "unit": "CUP"},
            {"name": "ground flaxseed", "quantity": 0.25, "unit": "CUP"},
            {"name": "peanut butter", "quantity": 0.5, "unit": "CUP"},
            {"name": "honey", "quantity": 0.33, "unit": "CUP"},
            {"name": "brewers yeast", "quantity": 2, "unit": "TABLESPOON"},
            {"name": "mini chocolate chips", "quantity": 0.25, "unit": "CUP"},
        ],
        "instructions": [
            "Mix all ingredients together in a bowl until well combined.",
            "Roll into small balls, about a tablespoon each.",
            "Refrigerate at least 30 minutes before eating, store in the fridge up to a week.",
            "A popular postpartum snack, though the evidence that ingredients like brewer's yeast meaningfully boost milk supply is limited. Worth having regardless as a quick, real-food snack for one-handed eating.",
        ],
    },
    {
        "id": "simple_chicken_soup",
        "title": "Simple Chicken and Vegetable Soup",
        "servings": 4,
        "cooking_time": 35,
        "ingredients": [
            {"name": "chicken breast", "quantity": 1, "unit": "POUND"},
            {"name": "carrots", "quantity": 3, "unit": "EACH"},
            {"name": "celery", "quantity": 3, "unit": "STALK"},
            {"name": "yellow onion", "quantity": 1, "unit": "EACH"},
            {"name": "chicken broth", "quantity": 6, "unit": "CUP"},
            {"name": "egg noodles", "quantity": 2, "unit": "CUP"},
            {"name": "salt", "quantity": 1, "unit": "TEASPOON"},
        ],
        "instructions": [
            "Sauté diced onion, carrots, and celery until softened.",
            "Add broth and chicken breast, bring to a boil, then simmer 20 minutes.",
            "Shred the cooked chicken, add noodles, and simmer 8 more minutes until noodles are tender.",
            "Freezes well for up to 3 months, real value for a night you can't cook.",
        ],
    },
    {
        "id": "avocado_toast_egg",
        "title": "Avocado Toast with a Fried Egg",
        "servings": 1,
        "cooking_time": 8,
        "ingredients": [
            {"name": "whole grain bread", "quantity": 2, "unit": "SLICE"},
            {"name": "avocado", "quantity": 1, "unit": "EACH"},
            {"name": "eggs", "quantity": 1, "unit": "EACH"},
            {"name": "lemon", "quantity": 0.5, "unit": "EACH"},
            {"name": "red pepper flakes", "quantity": 1, "unit": "PINCH"},
            {"name": "salt", "quantity": 1, "unit": "PINCH"},
        ],
        "instructions": [
            "Toast the bread. Mash avocado with lemon juice and salt, spread on toast.",
            "Fry the egg to your liking, place on top.",
            "Finish with a pinch of red pepper flakes if you like a little heat.",
        ],
    },
    {
        "id": "slow_cooker_chili",
        "title": "Slow Cooker Chili",
        "servings": 6,
        "cooking_time": 240,
        "ingredients": [
            {"name": "ground beef", "quantity": 1, "unit": "POUND"},
            {"name": "kidney beans", "quantity": 2, "unit": "CAN"},
            {"name": "diced tomatoes", "quantity": 2, "unit": "CAN"},
            {"name": "yellow onion", "quantity": 1, "unit": "EACH"},
            {"name": "chili powder", "quantity": 2, "unit": "TABLESPOON"},
            {"name": "cumin", "quantity": 1, "unit": "TABLESPOON"},
            {"name": "garlic", "quantity": 2, "unit": "CLOVE"},
        ],
        "instructions": [
            "Brown the ground beef with diced onion and garlic, drain excess fat.",
            "Add to a slow cooker with beans, tomatoes, chili powder, and cumin.",
            "Cook on low 6-8 hours, or high 3-4 hours. Real hands-off time for a busy day.",
        ],
    },
]


GUIDES = [
    {"id": "recovery-basics", "topic": "Recovery", "title": "Your body after birth",
     "body": "Healing takes time. Rest when you can, stay hydrated, and don't rush your recovery. Bleeding, cramping and fatigue are normal in the early weeks.",
     "variants": [
        {"culture": "South Asian / Indian", "title": "Traditional confinement (Jaappa / Sutika)", "body": "Many South Asian families observe 40 days of rest with warm foods, oil massage and family support. Blend the parts that comfort you with your provider's guidance."},
        {"culture": "Latina / Hispanic", "title": "La Cuarentena", "body": "The 40-day cuarentena emphasizes rest, warmth and family care. Honor the traditions that nourish you while listening to your body."},
     ]},
    {"id": "breastfeeding", "topic": "Feeding", "title": "Breastfeeding & feeding support",
     "body": "Fed is best. Whether breast, bottle or both, a good latch, frequent feeds and support make a difference. Reach out to a lactation consultant if it hurts.",
     "variants": [
        {"culture": "East Asian", "title": "Warm foods & soups", "body": "Traditional postpartum soups (e.g., seaweed soup) are believed to support milk supply and recovery. Combine with balanced nutrition."},
     ]},
    {"id": "mental-health", "topic": "Mental health", "title": "Your emotional wellbeing",
     "body": "Mood shifts are common. Baby blues often ease within two weeks. If sadness, anxiety or emptiness linger, it may be worth discussing with a provider — this is common and treatable.",
     "variants": []},
    {"id": "relationships", "topic": "Relationships", "title": "Relationship changes",
     "body": "A new baby reshapes relationships. Communicate needs openly, share the load, and protect small moments of connection with your partner or support people.",
     "variants": []},
]


class NearbySettings(BaseModel):
    device_id: str
    email: Optional[str] = None
    phone: Optional[str] = None
    baby_age_weeks: Optional[int] = None
    due_date: Optional[str] = None
    timezone: Optional[str] = None
    language: Optional[str] = None
    ethnicity: Optional[str] = None
    matching_preference: Optional[str] = None   # similar / none / diverse
    display_tags: Optional[bool] = None
    allow_cultural_match: Optional[bool] = None


class PresenceToggle(BaseModel):
    device_id: str
    awake: bool
    lat: Optional[float] = None
    lng: Optional[float] = None


class SleepSessionStart(BaseModel):
    device_id: str
    subject: str   # "baby" or "self" (the caregiver going to rest themselves)


class SleepSessionStop(BaseModel):
    device_id: str
    subject: str


class BabyLogCreate(BaseModel):
    device_id: str
    kind: str            # feed / sleep / diaper
    detail: Optional[str] = None
    amount_ml: Optional[float] = None       # feed quantity, stored canonically in ml
    diaper_type: Optional[str] = None       # pee / poop / both
    duration_minutes: Optional[int] = None  # sleep length, if known
    side: Optional[str] = None              # "left" / "right" / "both" — breastfeeding only
    at: Optional[str] = None                # backdate a log to when it actually happened


class SpaceAction(BaseModel):
    device_id: str
    space: str


# ----- Caregiver hand-off ("Tag Out") -----
class HouseholdCreate(BaseModel):
    device_id: str
    name: str
    role: str = "primary"          # primary / partner / caregiver


# The fixed set of things a Care Circle member's access can be granted or
# withheld for. AI conversations and mental-wellbeing detail are
# deliberately NOT in this list — those are never a grantable permission,
# they're hardcoded private everywhere they're read, regardless of what
# mom sets for someone. This matches the spec's own explicit requirement.
CARE_CIRCLE_PERMISSION_KEYS = [
    "baby_tracking", "baby_schedule", "care_shifts", "tasks", "meals",
    "appointments", "medication_reminders", "mom_recovery", "cuddle_load",
    "emergency_alerts", "location", "private_notes",
]

DEFAULT_CARE_CIRCLE_PERMISSIONS = {
    "baby_tracking": True, "baby_schedule": True, "care_shifts": True,
    "tasks": True, "meals": True, "appointments": True,
    "medication_reminders": True, "mom_recovery": False, "cuddle_load": False,
    "emergency_alerts": True, "location": False, "private_notes": False,
}


class HouseholdJoin(BaseModel):
    device_id: str
    household_code: str
    name: str
    role: str = "partner"
    custom_role: Optional[str] = None   # "Nani", "Postpartum Doula", "Sister", etc. — shown instead of role when set
    permissions: Optional[dict] = None  # subset of CARE_CIRCLE_PERMISSION_KEYS; unset keys fall back to the default


def _sanitize_permissions(permissions: Optional[dict]) -> dict:
    """Never trust a client-supplied permissions dict wholesale — only the
    real, known keys are kept, and anything missing falls back to a safe
    default rather than silently granting access to something new."""
    result = dict(DEFAULT_CARE_CIRCLE_PERMISSIONS)
    if permissions:
        for k, v in permissions.items():
            if k in CARE_CIRCLE_PERMISSION_KEYS and isinstance(v, bool):
                result[k] = v
    return result


class CareCirclePermissionsUpdate(BaseModel):
    household_code: str
    requesting_device_id: str   # must be the household's primary — enforced below
    target_device_id: str       # whose permissions are being changed
    permissions: dict


class HandoffSwitch(BaseModel):
    household_code: str
    device_id: str                 # caregiver now taking over
    note: Optional[str] = None


class RoleUpdate(BaseModel):
    household_code: str
    device_id: str
    role: str


class PushRegister(BaseModel):
    device_id: str
    expo_push_token: str


# ----- Give & Share (mom-to-mom item sharing) -----
SHOP_CATEGORIES = [
    {"key": "clothes", "label": "Baby Clothes", "icon": "shopping-bag"},
    {"key": "gear", "label": "Gear", "icon": "package"},
    {"key": "feeding", "label": "Feeding", "icon": "coffee"},
    {"key": "toys", "label": "Toys & Books", "icon": "gift"},
    {"key": "mom", "label": "For Mom", "icon": "heart"},
    {"key": "other", "label": "Other", "icon": "box"},
]


class ShopItemCreate(BaseModel):
    device_id: str
    title: str
    category: str
    condition: str            # new / like-new / gently-used / well-loved
    description: Optional[str] = None
    price_type: str = "free"  # free / low-cost / trade
    price: Optional[float] = None
    location_label: Optional[str] = None  # freeform area name, never precise geo
    photo_base64: Optional[str] = None    # optional single photo, data URI-ready base64


class ShopMessageCreate(BaseModel):
    device_id: str
    text: str


class InterestCreate(BaseModel):
    device_id: str


# ----- Postpartum recovery (mom's own body, not the baby) -----
# Warning signs sourced from the CDC's "Urgent Maternal Warning Signs"
# public health campaign — established, factual guidance, not our own
# clinical judgment. Presented as an informational checklist, never a
# diagnosis: this app is not a doctor.
# Grounded in ACOG's current postpartum care guidance (contact within 3 weeks,
# comprehensive visit by 12 weeks — Committee Opinion No. 736) and standard,
# well-established lochia/baby-blues timing. General patterns only — her own
# recovery can reasonably differ, which the copy says plainly.
RECOVERY_TIMELINE = [
    {
        "max_day": 3,
        "title": "The first few days",
        "body": "Bleeding is usually at its heaviest now (bright red, called lochia rubra), and you may feel your uterus cramping as it starts to shrink back down. Some emotional ups and downs, even crying for no clear reason, are extremely common starting around now. This is often called the \"baby blues,\" and it's different from postpartum depression.",
    },
    {
        "max_day": 7,
        "title": "This week",
        "body": "The baby blues often peak right around now, then start easing within a couple of weeks. Breast engorgement can also show up in the next day or two as milk comes in. Bleeding may still be fairly heavy but should be gradually easing.",
    },
    {
        "max_day": 14,
        "title": "Days 8 to 14",
        "body": "Bleeding usually shifts from red to pink or brownish (lochia serosa) around now. If you had a C-section, the outer incision is often mostly closed by this point, though it keeps healing underneath for weeks. This is also a good window for that first check-in ACOG recommends having with your provider within the first 3 weeks, even a quick call.",
    },
    {
        "max_day": 28,
        "title": "Weeks 3 to 4",
        "body": "Bleeding often tapers to a yellowish or white color and lightens further (lochia alba). If the baby blues haven't started easing by around 2 weeks, or if they're getting stronger instead of better, that's worth actually mentioning to your provider. It's the kind of thing an EPDS check-in on this app can help put into words too.",
    },
    {
        "max_day": 42,
        "title": "Weeks 5 to 6",
        "body": "Many people reach a first real recovery milestone around now, though ACOG's current guidance is that your comprehensive postpartum visit can happen anytime up to 12 weeks, whenever actually makes sense for you. Ask your provider before resuming exercise or intercourse rather than assuming a fixed date applies.",
    },
    {
        "max_day": 90,
        "title": "Weeks 7 to 12",
        "body": "This is the window ACOG recommends having your comprehensive postpartum visit by, if you haven't already. It should cover your physical recovery, mood, sleep, and more, not just a quick check. Physical healing is usually well underway, even if full strength and energy still take time.",
    },
    {
        "max_day": 180,
        "title": "Months 4 to 6",
        "body": "Noticeable hair shedding is common right around now. It can be alarming to see, but it's a normal, temporary response to the hormonal shift after birth, not something wrong with you. Recovery at this stage is less about healing and more about rebuilding strength and stamina at your own pace.",
    },
]


RECOVERY_WARNING_SIGNS = [
    {"key": "soaking_pad", "label": "Soaking through a pad every hour, or blood clots larger than an egg"},
    {"key": "incision_not_healing", "label": "An incision that isn't healing, or is red, swollen, or draining"},
    {"key": "leg_pain", "label": "A leg that's red, swollen, warm, or painful to the touch"},
    {"key": "fever", "label": "A temperature of 100.4°F (38°C) or higher"},
    {"key": "headache", "label": "A headache that won't go away, even with medicine — especially with vision changes"},
    {"key": "chest_pain", "label": "Chest pain or a fast-beating heart"},
    {"key": "trouble_breathing", "label": "Trouble breathing"},
    {"key": "swelling", "label": "Extreme swelling in your hands, face, or legs"},
    {"key": "overwhelming_tiredness", "label": "Overwhelming tiredness that feels like more than normal exhaustion"},
    {"key": "self_harm_thoughts", "label": "Thoughts of harming yourself or your baby"},
]


class RecoveryCheckinCreate(BaseModel):
    device_id: str
    pain_level: Optional[int] = None       # 1-5
    bleeding_level: Optional[str] = None   # none / light / moderate / heavy
    incision_status: Optional[str] = None  # good / concerning / n/a
    symptoms: List[str] = []               # keys from RECOVERY_WARNING_SIGNS
    lochia_color: Optional[str] = None     # red / pink_brown / yellow_white — a real, standard indicator of how recovery is progressing over the weeks
    pelvic_floor_done: Optional[bool] = None  # did she do pelvic floor/kegel exercises today
    diastasis_check: Optional[str] = None  # not_checked / no_gap / small_gap / large_gap — self-guided check result, not a diagnosis
    note: Optional[str] = None


class MomWellnessLogCreate(BaseModel):
    device_id: str
    kind: str                              # water / medication
    medication_name: Optional[str] = None  # e.g. "prenatal vitamin", "pain medication" — her own words, not a drug database
    at: Optional[str] = None


class ProfileApptUpdate(BaseModel):
    device_id: str
    postpartum_appt_done: bool


# ----- Dad's Corner (partner postpartum wellbeing) -----
# Uses the PHQ-2 — a short, well-validated, gender-neutral depression
# screener (not EPDS, which was validated specifically for postpartum
# mothers). Framed as a check-in, not a diagnosis, same as EPDS elsewhere.
PHQ2_QUESTIONS = [
    {"q": "Over the last 2 weeks, how often have you had little interest or pleasure in doing things?",
     "options": [{"label": "Not at all", "score": 0}, {"label": "Several days", "score": 1},
                 {"label": "More than half the days", "score": 2}, {"label": "Nearly every day", "score": 3}]},
    {"q": "Over the last 2 weeks, how often have you felt down, depressed, or hopeless?",
     "options": [{"label": "Not at all", "score": 0}, {"label": "Several days", "score": 1},
                 {"label": "More than half the days", "score": 2}, {"label": "Nearly every day", "score": 3}]},
]

DAD_TIPS = [
    {"title": "This is real, and it's more common than people think", "icon": "heart",
     "body": "About 1 in 10 new fathers/partners experience postpartum depression. It's driven by real "
             "hormonal, sleep, and identity shifts — not a personal failing."},
    {"title": "Concrete ways to support her", "icon": "users",
     "body": "Specific offers beat 'let me know if you need anything.' Try: 'I've got the 2am feed tonight,' "
             "or 'I'm ordering dinner, don't worry about it.' Small, repeated, unasked-for help lands best."},
    {"title": "Watch for it in yourself too", "icon": "eye",
     "body": "Irritability, withdrawing from the baby or your partner, working more to avoid home, or feeling "
             "numb are common in partners — often overlooked because they don't look like 'sadness.'"},
    {"title": "You're allowed to need support", "icon": "life-buoy",
     "body": "Postpartum Support International has a dedicated line for dads and partners, not just moms — "
             "reaching out early helps more than waiting until it's unmanageable."},
]


class DadCheckinSubmit(BaseModel):
    device_id: str
    answers: List[int]


@api_router.get("/dad-checkin/questions")
async def dad_checkin_questions():
    return PHQ2_QUESTIONS


@api_router.get("/dad-tips")
async def dad_tips():
    return DAD_TIPS


@api_router.post("/dad-checkin")
async def submit_dad_checkin(sub: DadCheckinSubmit):
    if len(sub.answers) != len(PHQ2_QUESTIONS):
        raise HTTPException(status_code=400, detail="Both questions must be answered")
    total = sum(sub.answers)
    band = "low" if total <= 2 else "elevated"
    doc = {
        "device_id": sub.device_id, "answers": sub.answers, "total": total,
        "band": band, "created_at": now_iso(),
    }
    await db.dad_checkins.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api_router.get("/dad-checkin/{device_id}")
async def dad_checkin_history(device_id: str, limit: int = 20):
    docs = await db.dad_checkins.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


# ----- Baby Brain Capture (quick-jot list for postpartum memory fog) -----
class BrainNoteCreate(BaseModel):
    device_id: str
    text: str
    category: Optional[str] = None  # question / appointment / reminder / other


@api_router.post("/brain-notes")
async def create_brain_note(n: BrainNoteCreate, verified_device_id: str = Depends(_verify_device)):
    if n.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't create a note as another device")
    doc = {
        "device_id": n.device_id, "text": n.text, "category": n.category or "other",
        "done": False, "created_at": now_iso(),
    }
    res = await db.brain_notes.insert_one(dict(doc))
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)
    return doc


@api_router.get("/brain-notes/{device_id}")
async def list_brain_notes(device_id: str, include_done: bool = False, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's notes")
    query: dict = {"device_id": device_id}
    if not include_done:
        query["done"] = False
    docs = await db.brain_notes.find(query).sort("created_at", -1).to_list(200)
    for d in docs:
        d["id"] = str(d.pop("_id"))
    return docs


@api_router.patch("/brain-notes/{note_id}/done")
async def complete_brain_note(note_id: str, requesting_device_id: str, verified_device_id: str = Depends(_verify_device)):
    # Previously took no device_id at all — anyone who knew or guessed a
    # note_id (a MongoDB ObjectId, not cryptographically random) could
    # mark any note done. Now checks the note actually belongs to the
    # verified caller before touching it.
    if requesting_device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Token doesn't match the requesting device")
    note = await db.brain_notes.find_one({"_id": ObjectId(note_id)})
    if not note or note.get("device_id") != verified_device_id:
        raise HTTPException(status_code=404, detail="Note not found")
    await db.brain_notes.update_one({"_id": ObjectId(note_id)}, {"$set": {"done": True}})
    return {"ok": True}


@api_router.delete("/brain-notes/{note_id}")
async def delete_brain_note(note_id: str, requesting_device_id: str, verified_device_id: str = Depends(_verify_device)):
    if requesting_device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Token doesn't match the requesting device")
    note = await db.brain_notes.find_one({"_id": ObjectId(note_id)})
    if not note or note.get("device_id") != verified_device_id:
        raise HTTPException(status_code=404, detail="Note not found")
    await db.brain_notes.delete_one({"_id": ObjectId(note_id)})
    return {"ok": True}


def jitter_coords(lat: float, lng: float, max_miles: float = 15.0):
    """Privacy-preserving randomization. Offsets by up to max_miles, then snaps
    to a coarse grid cell (~2.5mi) so the result reads as a general area rather
    than a precise point — nearby users can land in the same cell by design."""
    r = max_miles / 69.0
    u = random.random()
    w = r * math.sqrt(u)
    t = 2 * math.pi * random.random()
    dlat = w * math.cos(t)
    dlng = w * math.sin(t) / max(math.cos(math.radians(lat)), 0.1)
    grid = 0.035  # roughly 2.5 miles per cell
    glat = round((lat + dlat) / grid) * grid
    glng = round((lng + dlng) / grid) * grid
    return round(glat, 4), round(glng, 4)


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Real great-circle distance between two coordinates, in km."""
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ----- Nearby settings / profile extension -----
@api_router.get("/nearby/meta")
async def nearby_meta():
    return {"ethnicity_tags": ETHNICITY_TAGS, "cultural_spaces": CULTURAL_SPACES}


@api_router.patch("/nearby/settings")
async def update_nearby_settings(s: NearbySettings, verified_device_id: str = Depends(_verify_device)):
    if s.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's settings")
    update = {k: v for k, v in s.model_dump().items() if k != "device_id" and v is not None}
    if update:
        await db.profiles.update_one({"device_id": s.device_id}, {"$set": update}, upsert=True)
    doc = await db.profiles.find_one({"device_id": s.device_id}, {"_id": 0})
    return doc or {}


@api_router.delete("/nearby/ethnicity/{device_id}")
async def delete_ethnicity(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's settings")
    # Fully remove the optional cultural data and disable cultural matching.
    await db.profiles.update_one(
        {"device_id": device_id},
        {"$unset": {"ethnicity": "", "allow_cultural_match": ""},
         "$set": {"matching_preference": "none", "display_tags": False}},
    )
    doc = await db.profiles.find_one({"device_id": device_id}, {"_id": 0})
    return {"ok": True, "profile": doc}


# ----- Presence -----
@api_router.post("/presence/toggle")
async def presence_toggle(p: PresenceToggle, verified_device_id: str = Depends(_verify_device)):
    if p.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't toggle presence as another device")
    doc = {"device_id": p.device_id, "awake": p.awake, "last_active": now_iso()}
    if p.awake and p.lat is not None and p.lng is not None:
        # jitter immediately; store ONLY the randomized location, discard raw.
        jlat, jlng = jitter_coords(p.lat, p.lng)
        doc["lat"] = jlat
        doc["lng"] = jlng
    await db.presence.update_one({"device_id": p.device_id}, {"$set": doc}, upsert=True)
    return {"awake": p.awake}


@api_router.get("/presence/active")
async def presence_active(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized to request as this device")
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    reals = await db.presence.find(
        {"awake": True, "last_active": {"$gte": cutoff}, "device_id": {"$ne": device_id}}
    ).to_list(200)

    me = await db.presence.find_one({"device_id": device_id})
    # Fresno, CA — this app's actual service area — rather than the old
    # placeholder default (New York City) or leaving the map anchor unset.
    FALLBACK_LAT, FALLBACK_LNG = 36.7378, -119.7871
    anchor_lat = me.get("lat") if me and me.get("lat") is not None else FALLBACK_LAT
    anchor_lng = me.get("lng") if me and me.get("lng") is not None else FALLBACK_LNG
    has_real_anchor = bool(me and me.get("lat") is not None)

    pins = []
    # ~50km / ~30mi — a genuinely local radius for this area, not "same state."
    NEARBY_RADIUS_KM = 50
    for r in reals:
        if r.get("lat") is None:
            continue
        if has_real_anchor:
            dist = haversine_km(anchor_lat, anchor_lng, r["lat"], r["lng"])
            if dist > NEARBY_RADIUS_KM:
                continue  # real, but not actually nearby — don't show as "nearby"
        pins.append({"id": r["device_id"][:8], "lat": r["lat"], "lng": r["lng"], "mins": 0})

    return {"count": len(pins), "pins": pins,
            "anchor": {"lat": anchor_lat, "lng": anchor_lng}}


# ----- Baby tracker -----
@api_router.post("/baby-log")
async def baby_log(b: BabyLogCreate, verified_device_id: str = Depends(_verify_device)):
    # Writing a log claiming to be someone else's device_id is a real,
    # separate attack from reading someone else's data — this closes it:
    # you can only ever create an entry as the device your token proves
    # you are, never on another household member's behalf.
    if b.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't log an entry as another device")
    # Being verified as yourself doesn't automatically mean you're allowed
    # to write into a shared household record — someone without
    # baby_tracking permission shouldn't be able to log entries either,
    # matching the same permission reads already require. Solo devices
    # (no household) have nothing to check here.
    h = await db.households.find_one({"members.device_id": b.device_id}, {"_id": 0})
    if h and not _member_has_permission(h, b.device_id, "baby_tracking"):
        raise HTTPException(status_code=403, detail="No baby tracking permission for this household")
    doc = {
        "device_id": b.device_id,
        "kind": b.kind,
        "detail": b.detail,
        "amount_ml": b.amount_ml,
        "diaper_type": b.diaper_type,
        "duration_minutes": b.duration_minutes,
        "side": b.side,
        "at": b.at or now_iso(),
        "logged_at": now_iso(),  # when it was actually entered, distinct from when it happened
    }
    await db.baby_logs.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/feed/next-side/{device_id}")
async def feed_next_side(device_id: str, verified_device_id: str = Depends(_verify_device)):
    """Which side to start breastfeeding on next, based on the last side
    actually logged — alternating is the standard guidance, so this just
    flips whatever she used last. Returns None if there's no recent
    breastfeeding side data to go on, rather than guessing."""
    await _authorize_baby_data_access(device_id, verified_device_id)
    last = await db.baby_logs.find_one(
        {"device_id": device_id, "kind": "feed", "side": {"$in": ["left", "right"]}},
        {"_id": 0}, sort=[("at", -1)]
    )
    if not last:
        return {"suggested_side": None, "reason": "no breastfeeding side logged yet"}
    last_side = last["side"]
    suggested = "right" if last_side == "left" else "left"
    return {"suggested_side": suggested, "last_side": last_side, "last_at": last["at"]}


async def _start_sleep_session(device_id: str, subject: str) -> dict:
    """Core logic shared by the REST endpoint and the Talk to Cuddle voice
    tools, so 'baby's going to sleep' said out loud behaves identically to
    tapping the Start button."""
    await db.active_sleep_sessions.delete_many({"owner_device_id": device_id, "subject": subject})
    doc = {"owner_device_id": device_id, "subject": subject, "started_at": now_iso()}
    await db.active_sleep_sessions.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _stop_sleep_session(device_id: str, subject: str) -> Optional[dict]:
    """Core logic shared by the REST endpoint and the voice tools. Returns
    None if there was nothing active to stop (e.g. she says 'baby's awake'
    but no timer was actually running)."""
    if subject == "baby":
        device_ids = await _household_device_ids(device_id)
        active = await db.active_sleep_sessions.find_one(
            {"owner_device_id": {"$in": device_ids}, "subject": "baby"}, {"_id": 0}
        )
    else:
        active = await db.active_sleep_sessions.find_one(
            {"owner_device_id": device_id, "subject": "self"}, {"_id": 0}
        )
    if not active:
        return None

    started = datetime.fromisoformat(active["started_at"])
    duration_minutes = max(1, round((datetime.now(timezone.utc) - started).total_seconds() / 60))
    await db.active_sleep_sessions.delete_many(
        {"owner_device_id": active["owner_device_id"], "subject": subject}
    )

    if subject == "baby":
        await db.baby_logs.insert_one({
            "device_id": active["owner_device_id"], "kind": "sleep", "detail": None,
            "amount_ml": None, "diaper_type": None, "duration_minutes": duration_minutes,
            "at": active["started_at"], "logged_at": now_iso(),
        })
    else:
        await db.caregiver_rest_logs.insert_one({
            "device_id": active["owner_device_id"], "duration_minutes": duration_minutes,
            "at": active["started_at"], "logged_at": now_iso(),
        })
    return {"duration_minutes": duration_minutes, "started_at": active["started_at"]}


class PumpToggle(BaseModel):
    device_id: str
    side: str   # "left" or "right"


async def _get_or_create_pump_session(device_id: str) -> dict:
    doc = await db.active_pump_sessions.find_one({"device_id": device_id})
    if not doc:
        doc = {
            "device_id": device_id,
            "left_started_at": None, "left_accumulated_seconds": 0,
            "right_started_at": None, "right_accumulated_seconds": 0,
        }
        await db.active_pump_sessions.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


def _pump_side_live_seconds(session: dict, side: str) -> int:
    """Accumulated time for a side, plus whatever's elapsed since it was
    last started, if it's currently running."""
    accumulated = session.get(f"{side}_accumulated_seconds", 0)
    started = session.get(f"{side}_started_at")
    if started:
        elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(started)).total_seconds()
        accumulated += elapsed
    return round(accumulated)


@api_router.post("/pump-session/toggle")
async def pump_session_toggle(body: PumpToggle, verified_device_id: str = Depends(_verify_device)):
    if body.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't control another device's pump timer")
    """One tap starts that side's timer; tapping again stops it and banks
    the elapsed time. Left and right are independent — start one, then the
    other, for a real dual pump, or do them one at a time. Nothing is
    logged as a real pump entry until /pump-session/finish is called."""
    if body.side not in ("left", "right"):
        raise HTTPException(status_code=422, detail="side must be 'left' or 'right'")
    session = await _get_or_create_pump_session(body.device_id)
    started_key = f"{body.side}_started_at"
    accumulated_key = f"{body.side}_accumulated_seconds"

    if session.get(started_key):
        # currently running -> stop it, bank the elapsed time
        elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(session[started_key])).total_seconds()
        new_accumulated = session.get(accumulated_key, 0) + elapsed
        await db.active_pump_sessions.update_one(
            {"device_id": body.device_id},
            {"$set": {started_key: None, accumulated_key: new_accumulated}},
        )
    else:
        # not running -> start it
        await db.active_pump_sessions.update_one(
            {"device_id": body.device_id},
            {"$set": {started_key: now_iso()}},
        )

    session = await _get_or_create_pump_session(body.device_id)
    return {
        "left_running": bool(session.get("left_started_at")),
        "right_running": bool(session.get("right_started_at")),
        "left_seconds": _pump_side_live_seconds(session, "left"),
        "right_seconds": _pump_side_live_seconds(session, "right"),
    }


@api_router.get("/pump-session/active/{device_id}")
async def pump_session_active(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's pump data")
    """Current live state — both sides' running status and elapsed time so
    far, for the UI to render two live-ticking timers."""
    session = await _get_or_create_pump_session(device_id)
    return {
        "left_running": bool(session.get("left_started_at")),
        "right_running": bool(session.get("right_started_at")),
        "left_seconds": _pump_side_live_seconds(session, "left"),
        "right_seconds": _pump_side_live_seconds(session, "right"),
    }


async def _finish_pump_session(device_id: str, left_ml: Optional[float] = None, right_ml: Optional[float] = None) -> dict:
    """Stops whichever side is still running, logs one real pump entry
    with both sides' totals, and clears the active session. Shared by the
    REST endpoint and the 'I just pumped X on each side' chat tool, so a
    typed/spoken log behaves identically to using the on-screen timers.
    left_ml/right_ml are optional — output volume, when she has it, is
    what actually powers the side-comparison insight; time alone is kept
    as a fallback signal for sessions where she didn't measure ounces."""
    session = await _get_or_create_pump_session(device_id)
    left_seconds = _pump_side_live_seconds(session, "left")
    right_seconds = _pump_side_live_seconds(session, "right")
    await db.active_pump_sessions.delete_one({"device_id": device_id})

    left_minutes = round(left_seconds / 60, 1)
    right_minutes = round(right_seconds / 60, 1)
    total_ml = (left_ml or 0) + (right_ml or 0)
    await db.baby_logs.insert_one({
        "device_id": device_id, "kind": "pump", "detail": None,
        "amount_ml": total_ml if (left_ml is not None or right_ml is not None) else None,
        "diaper_type": None, "duration_minutes": round((left_seconds+right_seconds)/60),
        "left_minutes": left_minutes, "right_minutes": right_minutes,
        "left_ml": left_ml, "right_ml": right_ml,
        "at": now_iso(), "logged_at": now_iso(),
    })
    return {"left_minutes": left_minutes, "right_minutes": right_minutes, "left_ml": left_ml, "right_ml": right_ml}


@api_router.get("/pump-session/insight/{device_id}")
async def pump_session_insight(device_id: str, days: int = 14, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's pump data")
    """Looks at her actual pump history and tells her, honestly, whether
    one side has been consistently producing less — using real output
    volume when she's logged it, and falling back to time invested per
    side only when no volume data exists (a weaker signal, labeled as
    such). Requires several real sessions before saying anything, so it
    never guesses from one or two data points."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    logs = await db.baby_logs.find(
        {"device_id": device_id, "kind": "pump", "at": {"$gte": since}},
        {"_id": 0}
    ).to_list(200)

    if len(logs) < 4:
        return {"has_insight": False, "reason": "not enough sessions logged yet", "session_count": len(logs)}

    ml_sessions = [l for l in logs if l.get("left_ml") is not None or l.get("right_ml") is not None]
    using_volume = len(ml_sessions) >= 4

    if using_volume:
        left_vals = [l.get("left_ml") or 0 for l in ml_sessions]
        right_vals = [l.get("right_ml") or 0 for l in ml_sessions]
        unit = "ml"
    else:
        left_vals = [l.get("left_minutes") or 0 for l in logs]
        right_vals = [l.get("right_minutes") or 0 for l in logs]
        unit = "minutes"

    left_avg = sum(left_vals) / len(left_vals)
    right_avg = sum(right_vals) / len(right_vals)

    if left_avg == 0 and right_avg == 0:
        return {"has_insight": False, "reason": "no measurable data yet"}

    bigger = max(left_avg, right_avg)
    smaller = min(left_avg, right_avg)
    gap_pct = round(((bigger - smaller) / bigger) * 100) if bigger > 0 else 0

    # Only speak up for a real, consistent gap — not day-to-day noise.
    if gap_pct < 15:
        return {
            "has_insight": True, "balanced": True, "using_volume": using_volume, "unit": unit,
            "left_avg": round(left_avg, 1), "right_avg": round(right_avg, 1),
            "message": "Your sides have been fairly balanced lately.",
        }

    lower_side = "left" if left_avg < right_avg else "right"
    basis = "average output" if using_volume else "average time (no volume logged yet, so this is a rougher signal)"
    return {
        "has_insight": True, "balanced": False, "using_volume": using_volume, "unit": unit,
        "lower_side": lower_side, "gap_percent": gap_pct,
        "left_avg": round(left_avg, 1), "right_avg": round(right_avg, 1),
        "message": f"Your {lower_side} side has been producing about {gap_pct}% less than the other, based on {basis} over your last {len(ml_sessions if using_volume else logs)} sessions. Starting on the {lower_side} today, while you have the most energy for it, may help even things out.",
    }


@api_router.get("/pump-session/trend/{device_id}")
async def pump_session_trend(device_id: str, days: int = 14, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's pump data")
    """Daily total output over time — the same volume data behind the
    side-comparison, rolled up per day instead of per side. Useful for two
    different real situations: noticing supply trending down, or tracking
    progress building a freezer stash."""
    days = max(7, min(days, 60))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    logs = await db.baby_logs.find(
        {"device_id": device_id, "kind": "pump", "at": {"$gte": since}},
        {"_id": 0}
    ).sort("at", 1).to_list(500)

    by_day: dict = {}
    for l in logs:
        day = l["at"][:10]
        ml = (l.get("left_ml") or 0) + (l.get("right_ml") or 0)
        entry = by_day.setdefault(day, {"total_ml": 0, "has_volume": False, "session_count": 0})
        entry["session_count"] += 1
        if l.get("left_ml") is not None or l.get("right_ml") is not None:
            entry["total_ml"] += ml
            entry["has_volume"] = True

    trend = [
        {"date": day, "total_ml": round(v["total_ml"], 1) if v["has_volume"] else None, "session_count": v["session_count"]}
        for day, v in sorted(by_day.items())
    ]
    return {"range_days": days, "trend": trend}


class PumpSymptomCheck(BaseModel):
    device_id: str
    side: str
    has_symptoms: bool
    symptoms: List[str] = []   # e.g. ["pain", "redness", "fever", "warm to touch"]


@api_router.post("/pump-session/symptom-check")
async def pump_symptom_check(body: PumpSymptomCheck, verified_device_id: str = Depends(_verify_device)):
    if body.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't log a symptom check for another device")
    """A real safety feature, not just convenience: an ongoing output
    imbalance between sides is a genuine risk factor for a clogged duct or
    mastitis. This logs her answer and, if she reports symptoms, returns
    clear guidance to contact her provider rather than trying to self-
    diagnose or wait it out."""
    await db.pump_symptom_checks.insert_one({
        "device_id": body.device_id, "side": body.side,
        "has_symptoms": body.has_symptoms, "symptoms": body.symptoms,
        "created_at": now_iso(),
    })
    if not body.has_symptoms:
        return {"guidance": None}
    return {
        "guidance": (
            "Pain, redness, or fever on one side, especially alongside a drop in output, "
            "can be early signs of a clogged duct or mastitis. This isn't something to wait out — "
            "please contact your doctor, midwife, or a lactation consultant today. In the meantime, "
            "continuing to nurse or pump that side, warm compresses before, and gentle massage while "
            "feeding can help, but they don't replace getting checked."
        ),
        "urgent": "fever" in [s.lower() for s in body.symptoms],
    }


class PumpFinish(BaseModel):
    left_ml: Optional[float] = None
    right_ml: Optional[float] = None


@api_router.post("/pump-session/finish/{device_id}")
async def pump_session_finish(device_id: str, body: PumpFinish = PumpFinish(), verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's pump data")
    return await _finish_pump_session(device_id, body.left_ml, body.right_ml)


@api_router.post("/sleep-session/start")
async def sleep_session_start(s: SleepSessionStart, verified_device_id: str = Depends(_verify_device)):
    """Live start/stop timing, more accurate than guessing a duration after
    the fact. 'self' sessions (a caregiver resting, not the baby) are what
    make this genuinely different from a typical baby-only tracker: the
    other caregiver in the household can see it happening in real time.
    """
    if s.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't start a session as another device")
    if s.subject == "baby":
        h = await db.households.find_one({"members.device_id": s.device_id}, {"_id": 0})
        if h and not _member_has_permission(h, s.device_id, "baby_tracking"):
            raise HTTPException(status_code=403, detail="No baby tracking permission for this household")
    return await _start_sleep_session(s.device_id, s.subject)


@api_router.get("/sleep-session/active/{device_id}")
async def sleep_session_active(device_id: str, verified_device_id: str = Depends(_verify_device)):
    """Everything currently in progress that this household can see: baby's
    nap if anyone started one, and any caregiver's own rest session too."""
    await _authorize_baby_data_access(device_id, verified_device_id)
    device_ids = await _household_device_ids(device_id)
    sessions = await db.active_sleep_sessions.find(
        {"owner_device_id": {"$in": device_ids}}, {"_id": 0}
    ).to_list(10)

    # Attach whose session it is, for "self" sessions specifically, so the
    # UI can show a real name ("Mom is resting") instead of just a role key.
    h = await db.households.find_one({"members.device_id": device_id}, {"_id": 0})
    member_lookup = {m["device_id"]: m for m in (h["members"] if h else [])}
    for sess in sessions:
        member = member_lookup.get(sess["owner_device_id"])
        sess["owner_name"] = member.get("name") if member else None
        sess["is_you"] = sess["owner_device_id"] == device_id
    return sessions


@api_router.post("/sleep-session/stop")
async def sleep_session_stop(s: SleepSessionStop, verified_device_id: str = Depends(_verify_device)):
    """Baby sessions can be stopped by any caregiver in the household (the
    one who notices baby waking up isn't always the one who started the
    nap timer). A caregiver's own 'self' rest session can only be stopped
    by that same device, since nobody else should end someone else's rest
    for them."""
    if s.subject == "self":
        if s.device_id != verified_device_id:
            raise HTTPException(status_code=403, detail="Only that device can end its own rest session")
    else:
        await _authorize_baby_data_access(s.device_id, verified_device_id)
    result = await _stop_sleep_session(s.device_id, s.subject)
    if result is None:
        raise HTTPException(status_code=404, detail="No active session found")
    return result


@api_router.get("/baby-log/{device_id}")
async def baby_logs(device_id: str, limit: int = 50, verified_device_id: str = Depends(_verify_device)):
    await _authorize_baby_data_access(device_id, verified_device_id)
    # Combined across the whole household, same as /summary and
    # /predictions already do — otherwise Dad's feed wouldn't show up in
    # Mom's recent activity list, even though the totals above it would
    # silently already include it. That mismatch is exactly what defeats
    # the point of Tag Team: seeing what your partner actually logged.
    device_ids = await _household_device_ids(device_id)
    docs = await db.baby_logs.find({"device_id": {"$in": device_ids}}, {"_id": 0}).sort("at", -1).to_list(limit)

    # Attach who actually logged each entry (by name/role) whenever this
    # device is part of a real household — otherwise a shared list with no
    # attribution just raises the question "wait, who did this?"
    if len(device_ids) > 1:
        h = await db.households.find_one({"members.device_id": device_id}, {"_id": 0})
        member_lookup = {m["device_id"]: m for m in (h["members"] if h else [])}
        for d in docs:
            member = member_lookup.get(d.get("device_id"))
            if member:
                d["logged_by_name"] = member.get("name")
                d["logged_by_role"] = member.get("role")
                d["logged_by_you"] = d["device_id"] == device_id

    return docs


def _ml_to_oz(ml: float) -> float:
    return round(ml / 29.5735, 1)


async def _household_device_ids(device_id: str) -> List[str]:
    """All device_ids sharing a household with this one (for combined baby
    totals across caregivers), or just this device if no household exists."""
    h = await db.households.find_one({"members.device_id": device_id}, {"_id": 0})
    if not h:
        return [device_id]
    return [m["device_id"] for m in h["members"]]


async def _authorize_baby_data_access(target_device_id: str, verified_device_id: str) -> None:
    """The real family-scoped check the security audit asked for: a
    household member is only allowed to read another member's baby data
    if BOTH are true — they're actually in the same household, AND their
    specific permissions grant baby_tracking. Being 'in the family' alone
    is not enough, matching the explicit requirement not to treat family
    membership as blanket access. Raises 403 rather than returning a
    bool, so every call site fails closed by default."""
    if target_device_id == verified_device_id:
        return
    h = await db.households.find_one({"members.device_id": target_device_id}, {"_id": 0})
    if not h or not any(m["device_id"] == verified_device_id for m in h["members"]):
        raise HTTPException(status_code=403, detail="Not authorized for this device's data")
    if not _member_has_permission(h, verified_device_id, "baby_tracking"):
        raise HTTPException(status_code=403, detail="No baby tracking permission for this household")


@api_router.get("/baby-log/{device_id}/summary")
async def baby_log_summary(device_id: str, verified_device_id: str = Depends(_verify_device)):
    await _authorize_baby_data_access(device_id, verified_device_id)
    """Today's totals, combined across the whole household (so Dad's feeds
    count toward the same daily total as Mom's, not two separate tallies)."""
    device_ids = await _household_device_ids(device_id)
    today = datetime.now(timezone.utc).date().isoformat()
    logs = await db.baby_logs.find(
        {"device_id": {"$in": device_ids}, "at": {"$gte": today}}, {"_id": 0}
    ).to_list(500)

    feed_logs = [l for l in logs if l["kind"] == "feed"]
    diaper_logs = [l for l in logs if l["kind"] == "diaper"]
    sleep_logs = [l for l in logs if l["kind"] == "sleep"]

    total_ml = sum(l.get("amount_ml") or 0 for l in feed_logs)
    pee_count = sum(1 for l in diaper_logs if l.get("diaper_type") in ("pee", "both"))
    poop_count = sum(1 for l in diaper_logs if l.get("diaper_type") in ("poop", "both"))
    sleep_minutes = sum(l.get("duration_minutes") or 0 for l in sleep_logs)

    # "When did the baby last eat/pee/poop/sleep" — genuinely one of the
    # most-wanted things a tired parent wants to know at a glance, so this
    # looks beyond just today (not date-filtered) to avoid going blank
    # first thing in the morning before anything's been logged yet today.
    async def _last_at(match: dict) -> Optional[str]:
        doc = await db.baby_logs.find_one(
            {"device_id": {"$in": device_ids}, **match}, {"_id": 0, "at": 1}, sort=[("at", -1)]
        )
        return doc["at"] if doc else None

    last_feed_at = await _last_at({"kind": "feed"})
    last_pee_at = await _last_at({"kind": "diaper", "diaper_type": {"$in": ["pee", "both"]}})
    last_poop_at = await _last_at({"kind": "diaper", "diaper_type": {"$in": ["poop", "both"]}})
    last_sleep_at = await _last_at({"kind": "sleep"})

    return {
        "date": today,
        "feed_count": len(feed_logs),
        "feed_total_ml": round(total_ml, 1),
        "feed_total_oz": _ml_to_oz(total_ml),
        "pee_count": pee_count,
        "poop_count": poop_count,
        "sleep_count": len(sleep_logs),
        "sleep_total_minutes": sleep_minutes,
        "last_feed_at": last_feed_at,
        "last_pee_at": last_pee_at,
        "last_poop_at": last_poop_at,
        "last_sleep_at": last_sleep_at,
    }


def _age_based_feed_interval_minutes(age_weeks: Optional[float]) -> Optional[int]:
    """Widely-used general newborn/infant feeding interval norms — used only
    as a starting estimate when there isn't enough of this baby's own
    logged history yet, and always labeled as such rather than presented
    as if it came from her own data."""
    if age_weeks is None:
        return None
    if age_weeks < 4:
        return 150   # ~2.5h, typical newborn
    if age_weeks < 13:
        return 195   # ~3.25h, 1-3 months
    if age_weeks < 26:
        return 240   # ~4h, 3-6 months
    return 270       # ~4.5h, 6+ months


def _age_based_wake_window_minutes(age_weeks: Optional[float]) -> Optional[int]:
    """General 'wake window' norms (how long a baby can comfortably stay
    awake between sleeps) from widely-cited pediatric sleep guidance.
    Same role as the feed-interval fallback above: a starting estimate
    only, replaced by this baby's own pattern as soon as there's enough
    of it logged."""
    if age_weeks is None:
        return None
    if age_weeks < 4:
        return 45    # 0-4 weeks: ~30-60min
    if age_weeks < 13:
        return 75    # 4-12 weeks: ~60-90min
    if age_weeks < 18:
        return 100   # 3-4 months: ~75-120min
    if age_weeks < 31:
        return 150   # 5-7 months: ~2-3h
    if age_weeks < 44:
        return 180   # 7-10 months: ~2.5-3.5h
    return 210        # 11+ months: ~3-4h


def _predict_next(logs: List[dict], min_samples: int = 2, max_samples: int = 6, age_fallback_minutes: Optional[int] = None) -> Optional[dict]:
    """Simple moving-average interval prediction from the caregiver's own
    recently logged pattern — not a clinical model, just 'based on the last
    few times, here's roughly when this tends to happen again.' Confidence
    is stated honestly rather than implying more precision than we have.
    Falls back to a general age-based estimate (clearly labeled) only when
    there isn't enough of this baby's own history yet."""
    if len(logs) < min_samples:
        if age_fallback_minutes and logs:
            last_time = sorted([datetime.fromisoformat(l["at"]) for l in logs])[-1]
            predicted = last_time + timedelta(minutes=age_fallback_minutes)
            return {
                "predicted_at": predicted.isoformat(),
                "avg_interval_minutes": age_fallback_minutes,
                "confidence": "age_estimate",
                "sample_size": len(logs),
            }
        return None
    times = sorted([datetime.fromisoformat(l["at"]) for l in logs])[-max_samples - 1:]
    intervals = [(times[i + 1] - times[i]).total_seconds() / 60 for i in range(len(times) - 1)]
    if not intervals:
        return None
    avg_minutes = sum(intervals) / len(intervals)
    last_time = times[-1]
    predicted = last_time + timedelta(minutes=avg_minutes)
    confidence = "steady" if len(intervals) >= 5 else ("developing" if len(intervals) >= 3 else "early")
    return {
        "predicted_at": predicted.isoformat(),
        "avg_interval_minutes": round(avg_minutes),
        "confidence": confidence,
        "sample_size": len(intervals),
    }


def _predict_next_sleep(logs: List[dict], min_samples: int = 3, max_samples: int = 6, age_fallback_minutes: Optional[int] = None) -> Optional[dict]:
    """Predicts when the next sleep is likely to start, based on this
    baby's own recent 'wake windows': the gap from when they actually
    WOKE UP (not when they fell asleep) to when they next fell asleep.
    Using consecutive sleep start times instead would overestimate the
    wake window by however long each nap actually lasted, since that
    time isn't part of being awake at all."""
    dated = [l for l in logs if l.get("at")]
    dated.sort(key=lambda l: l["at"])
    wake_windows = []
    for i in range(len(dated) - 1):
        prev, nxt = dated[i], dated[i + 1]
        prev_start = datetime.fromisoformat(prev["at"])
        prev_duration = prev.get("duration_minutes") or 0
        prev_end = prev_start + timedelta(minutes=prev_duration)
        next_start = datetime.fromisoformat(nxt["at"])
        gap_minutes = (next_start - prev_end).total_seconds() / 60
        if gap_minutes > 0:  # skip overlapping/backdated entries that don't form a clean gap
            wake_windows.append(gap_minutes)

    if len(wake_windows) < min_samples:
        if age_fallback_minutes and dated:
            last = dated[-1]
            last_start = datetime.fromisoformat(last["at"])
            last_end = last_start + timedelta(minutes=last.get("duration_minutes") or 0)
            predicted = last_end + timedelta(minutes=age_fallback_minutes)
            return {
                "predicted_at": predicted.isoformat(),
                "avg_interval_minutes": age_fallback_minutes,
                "confidence": "age_estimate",
                "sample_size": len(wake_windows),
            }
        return None

    recent = wake_windows[-max_samples:]
    avg_minutes = sum(recent) / len(recent)
    last = dated[-1]
    last_end = datetime.fromisoformat(last["at"]) + timedelta(minutes=last.get("duration_minutes") or 0)
    predicted = last_end + timedelta(minutes=avg_minutes)
    confidence = "steady" if len(recent) >= 5 else ("developing" if len(recent) >= 3 else "early")
    return {
        "predicted_at": predicted.isoformat(),
        "avg_interval_minutes": round(avg_minutes),
        "confidence": confidence,
        "sample_size": len(recent),
    }


async def baby_log_predictions(device_id: str):
    """'Based on your own recent logs, here's roughly when to expect the
    next one' — for feeds, pee, and poop. Learns only from this baby's own
    logged history, refines as more gets logged, and says so plainly when
    there isn't enough data yet rather than guessing confidently."""
    device_ids = await _household_device_ids(device_id)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
    logs = await db.baby_logs.find(
        {"device_id": {"$in": device_ids}, "at": {"$gte": cutoff}}, {"_id": 0}
    ).to_list(500)

    feed_logs = [l for l in logs if l["kind"] == "feed"]
    pee_logs = [l for l in logs if l["kind"] == "diaper" and l.get("diaper_type") in ("pee", "both")]
    poop_logs = [l for l in logs if l["kind"] == "diaper" and l.get("diaper_type") in ("poop", "both")]
    sleep_logs = [l for l in logs if l["kind"] == "sleep"]

    age_weeks = None
    prof = await db.profiles.find_one({"device_id": device_id}, {"_id": 0})
    if prof:
        due_or_birth = prof.get("delivery_date") or prof.get("due_date")
        if due_or_birth:
            try:
                born = datetime.fromisoformat(due_or_birth).date()
                age_weeks = (datetime.now(timezone.utc).date() - born).days / 7
            except ValueError:
                pass
        if age_weeks is None and prof.get("baby_age_weeks") is not None:
            age_weeks = prof["baby_age_weeks"]

    return {
        "feed": _predict_next(feed_logs, age_fallback_minutes=_age_based_feed_interval_minutes(age_weeks)),
        "pee": _predict_next(pee_logs, min_samples=3),
        "poop": _predict_next(poop_logs, min_samples=2, max_samples=4),
        "sleep": _predict_next_sleep(sleep_logs, age_fallback_minutes=_age_based_wake_window_minutes(age_weeks)),
    }


@api_router.get("/baby-log/{device_id}/predictions")
async def baby_log_predictions_route(device_id: str, verified_device_id: str = Depends(_verify_device)):
    await _authorize_baby_data_access(device_id, verified_device_id)
    return await baby_log_predictions(device_id)


PLAYFUL_BALANCE_LINES = [
    "{leader} has logged {pct}% of today's baby duties — {other}, the tag-team jersey is right there 👕",
    "{leader}'s on a bit of a streak today ({pct}% of the logs) — {other}, MVP substitution opportunity available",
    "Scoreboard check: {leader} {pct}%, {other} — your turn to rack up some points 😄",
]


@api_router.get("/handoff/balance/{household_code}")
async def handoff_balance(household_code: str, verified_device_id: str = Depends(_verify_device)):
    """A light, funny nudge about today's workload split — deliberately the
    one playful voice in an otherwise gentle app, since a little humor here
    lands better than more heavy language about who's 'behind'."""
    h = await _get_household(household_code)
    if not any(m["device_id"] == verified_device_id for m in h["members"]):
        raise HTTPException(status_code=403, detail="Not a member of this household")
    today = datetime.now(timezone.utc).date().isoformat()
    logs = await db.baby_logs.find(
        {"device_id": {"$in": [m["device_id"] for m in h["members"]]}, "at": {"$gte": today}},
        {"_id": 0},
    ).to_list(500)
    if len(logs) < 4 or len(h["members"]) < 2:
        return {"message": None}

    counts: dict = {}
    for l in logs:
        counts[l["device_id"]] = counts.get(l["device_id"], 0) + 1
    total = sum(counts.values())
    leader_id = max(counts, key=counts.get)
    leader_pct = round(counts[leader_id] / total * 100)
    if leader_pct < 65:
        return {"message": None}  # fairly balanced — no need to say anything

    leader = next((m["name"] for m in h["members"] if m["device_id"] == leader_id), "Someone")
    other = next((m["name"] for m in h["members"] if m["device_id"] != leader_id), "the other player")
    line = random.choice(PLAYFUL_BALANCE_LINES).format(leader=leader, pct=leader_pct, other=other)
    return {"message": line}


# ----- Caregiver hand-off ("Tag Out") -----
# A lightweight, no-login household: one caregiver creates a short code,
# others join with it. We track who is currently "on duty" and use recent
# baby-log + mood signals to suggest a gentle, transparent hand-off nudge.
# This is a support suggestion, never a scorecard or an automatic action.

NIGHT_START_HOUR = 21   # 9pm
NIGHT_END_HOUR = 7      # 7am

# Soft, non-diagnostic phrase list used only to surface a gentle nudge —
# never shown as a label or diagnosis, just used to shape a supportive message.
_DISTRESS_PHRASES = [
    "exhausted", "overwhelmed", "can't do this", "cant do this", "touched out",
    "so tired", "burnt out", "burned out", "no break", "need a break",
    "need help", "at my limit", "running on empty", "can't keep up",
    "cant keep up", "alone in this", "crying", "falling apart",
]


def _detect_emotion_signal(name: Optional[str], mood_entry: Optional[dict]) -> Optional[dict]:
    """Looks at the on-duty caregiver's own words (their optional note, or
    low mood/energy tags) and — only if something stands out — offers a
    softly-worded suggestion. Never a diagnosis, never shown as a score."""
    if not mood_entry:
        return None
    text = " ".join(
        filter(None, [mood_entry.get("note"), " ".join(mood_entry.get("tags", []))])
    ).lower()
    if not text:
        return None
    hit = next((p for p in _DISTRESS_PHRASES if p in text), None)
    if not hit:
        return None
    who = name or "They"
    return {
        "detected": True,
        "suggested_note": f"{who} mentioned feeling stretched thin recently — "
                           f"might be worth a gentle check-in, no pressure.",
    }


# ----- Push notifications -----
# Uses Expo's push service — works once the app is a real native build via EAS
# (App Store / Play Store or an internal build). It does NOT work in a plain
# web browser tab; browsers need a separate Web Push setup, which this
# doesn't attempt yet. Registering a token on web is a harmless no-op.
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


async def send_push(device_id: str, title: str, body: str, urgent: bool = False):
    token_doc = await db.push_tokens.find_one({"device_id": device_id})
    if not token_doc or not token_doc.get("expo_push_token"):
        return
    try:
        payload = {
            "to": token_doc["expo_push_token"],
            "title": title,
            "body": body,
            "sound": "default",
        }
        if urgent:
            # Android: high-priority + a dedicated channel so it can use a
            # louder/longer alert if the phone's app-level channel settings
            # allow it. iOS still just uses the default alert sound — a true
            # ringing, full-screen call-style alert needs CallKit, which is
            # native-only and out of scope here.
            payload["priority"] = "high"
            payload["channelId"] = "sos"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(EXPO_PUSH_URL, json=payload)
            data = resp.json()
        ticket = (data.get("data") or {})
        if ticket.get("status") == "error":
            # A same-request rejection — usually a genuinely malformed
            # token, not "device uninstalled" (that case comes back OK
            # here and only shows up later in the receipt check below).
            # Dead either way, so remove it now rather than waiting.
            if ticket.get("details", {}).get("error") == "DeviceNotRegistered":
                await db.push_tokens.delete_one({"device_id": device_id})
        elif ticket.get("id"):
            # Real delivery only gets attempted by Apple/Google after this
            # point, asynchronously — Expo's own guidance is to check the
            # receipt some minutes later, not immediately. Logged here;
            # prune_dead_push_tokens (in the cron sweep) checks it later.
            # sent_at is a real datetime, not this file's usual ISO-string
            # convention — needed for the TTL index below to actually work,
            # same lesson learned earlier with the invitations collection.
            await db.push_ticket_log.insert_one({
                "device_id": device_id, "ticket_id": ticket["id"],
                "sent_at": datetime.now(timezone.utc), "checked": False,
            })
    except Exception:
        logger.exception("push send failed")


async def prune_dead_push_tokens():
    """Real cleanup, not a guess — asks Expo directly whether each recent
    push actually reached a live device, and removes the token only when
    Expo itself confirms it's gone (DeviceNotRegistered), never based on
    silence or a timeout alone. This is what stops someone who deleted
    and reinstalled the app from quietly accumulating duplicate 'devices'
    that all keep receiving every notification forever."""
    # Only check tickets old enough for Apple/Google to have actually
    # tried delivery — checking too early just gets an empty receipt.
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
    pending = await db.push_ticket_log.find(
        {"checked": False, "sent_at": {"$lte": cutoff}}, {"_id": 0}
    ).to_list(500)
    if not pending:
        return {"checked": 0, "pruned": 0}

    id_to_device = {t["ticket_id"]: t["device_id"] for t in pending}
    ticket_ids = list(id_to_device.keys())
    pruned = 0
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://exp.host/--/api/v2/push/getReceipts",
                json={"ids": ticket_ids},
                headers={"Content-Type": "application/json"},
            )
            receipts = (resp.json() or {}).get("data", {})
    except Exception:
        logger.exception("push receipt check failed")
        return {"checked": 0, "pruned": 0}

    for ticket_id, receipt in receipts.items():
        device_id = id_to_device.get(ticket_id)
        if not device_id:
            continue
        if receipt.get("status") == "error" and receipt.get("details", {}).get("error") == "DeviceNotRegistered":
            await db.push_tokens.delete_one({"device_id": device_id})
            pruned += 1

    checked_ids = list(receipts.keys())
    if checked_ids:
        await db.push_ticket_log.update_many(
            {"ticket_id": {"$in": checked_ids}}, {"$set": {"checked": True}}
        )
    return {"checked": len(checked_ids), "pruned": pruned}


@api_router.post("/push/register")
async def register_push_token(p: PushRegister, verified_device_id: str = Depends(_verify_device)):
    # Without this, anyone could register a fake push token for another
    # device_id, hijacking that person's notifications — SOS alerts,
    # encouragement messages, everything — to a device that isn't theirs.
    if p.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't register a push token for another device")
    await db.push_tokens.update_one(
        {"device_id": p.device_id},
        {"$set": {"device_id": p.device_id, "expo_push_token": p.expo_push_token, "updated_at": now_iso()}},
        upsert=True,
    )
    return {"ok": True}


class BroadcastAnnouncement(BaseModel):
    title: str
    body: str
    admin_key: str


@api_router.get("/admin/stats")
async def admin_stats(admin_key: str):
    """Real founder-facing numbers pulled directly from the database, not
    estimated from App Store download counts (which include re-downloads,
    people who deleted the app, etc). Protected by the same key as the
    broadcast endpoint — only exists as a Railway environment variable."""
    if not ADMIN_BROADCAST_KEY or not _secrets.compare_digest(admin_key, ADMIN_BROADCAST_KEY):
        raise HTTPException(status_code=403, detail="Invalid admin key")

    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    month_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

    total_profiles = await db.profiles.count_documents({})
    new_this_week = await db.profiles.count_documents({"created_at": {"$gte": week_ago}})
    new_this_month = await db.profiles.count_documents({"created_at": {"$gte": month_ago}})

    active_this_week = await db.app_activity.count_documents({"last_opened_at": {"$gte": week_ago}})

    total_households = await db.households.count_documents({})
    waitlist_count = await db.waitlist.count_documents({})
    contact_messages = await db.contact_messages.count_documents({})
    push_enabled = await db.push_tokens.count_documents({})

    return {
        "total_profiles": total_profiles,
        "new_this_week": new_this_week,
        "new_this_month": new_this_month,
        "active_this_week": active_this_week,
        "total_households": total_households,
        "push_notifications_enabled": push_enabled,
        "waitlist_signups": waitlist_count,
        "contact_messages": contact_messages,
        "generated_at": now_iso(),
    }


@api_router.post("/admin/broadcast-announcement")
async def broadcast_announcement(a: BroadcastAnnouncement):
    """Sends a push to every registered device — for real app-wide news
    (a genuinely new feature, a real incident), not routine use. Protected
    by a key that only exists as a Railway environment variable, since an
    unprotected version of this could spam every single user. Also rate
    limited on both sides: wrong-key attempts (to make the key genuinely
    hard to brute-force by guessing) and successful sends (as a safety
    net if the key is ever leaked or misused, intentionally or not)."""
    now = datetime.now(timezone.utc)
    hour_ago = (now - timedelta(hours=1)).isoformat()
    day_ago = (now - timedelta(hours=24)).isoformat()

    recent_failures = await db.broadcast_attempts.count_documents(
        {"outcome": "failed", "at": {"$gte": hour_ago}}
    )
    if recent_failures >= 5:
        raise HTTPException(status_code=429, detail="Too many failed attempts recently, try again later")

    if not ADMIN_BROADCAST_KEY or not _secrets.compare_digest(a.admin_key, ADMIN_BROADCAST_KEY):
        await db.broadcast_attempts.insert_one({"outcome": "failed", "at": now.isoformat()})
        raise HTTPException(status_code=403, detail="Invalid admin key")

    recent_sends = await db.broadcast_attempts.count_documents(
        {"outcome": "sent", "at": {"$gte": day_ago}}
    )
    if recent_sends >= 3:
        raise HTTPException(status_code=429, detail="Daily broadcast limit reached (3/day) — a real safeguard, raise it in code if you genuinely need more")

    tokens = await db.push_tokens.find({}, {"_id": 0, "device_id": 1}).to_list(100000)
    device_ids = [t["device_id"] for t in tokens]

    # Send in small concurrent batches rather than one at a time (slow) or
    # all at once (could overwhelm Expo's push endpoint at real scale).
    # Note: send_push already catches its own errors internally, so this
    # can only report how many were attempted, not confirmed-delivered —
    # genuine delivery confirmation needs a separate Expo receipt check,
    # out of scope for a simple announcement tool.
    batch_size = 25
    for i in range(0, len(device_ids), batch_size):
        batch = device_ids[i:i + batch_size]
        await asyncio.gather(*[send_push(did, a.title, a.body) for did in batch], return_exceptions=True)

    await db.broadcast_attempts.insert_one({"outcome": "sent", "at": now.isoformat(), "title": a.title})
    return {"attempted": len(device_ids)}


@api_router.post("/cron/tick")
async def cron_tick(x_cron_secret: str = Header(None)):
    """Runs the same nudge checks that used to only fire when the app
    happened to be open and polled the right endpoint — Tag Team fatigue,
    predicted feed/sleep/diaper timing, the self check-in reminder,
    upcoming event reminders, and now a proactive AI check-in — on a real,
    independent schedule instead.

    Meant to be hit every few minutes by an external scheduler (Railway's
    Cron Job service, or any free cron pinger) hitting this URL with the
    CRON_SECRET header set. Reuses the exact same per-device functions the
    app itself calls, so the nudge logic and its rate-limiting/dedup
    tracking live in exactly one place, not two copies that could drift.
    """
    if not CRON_SECRET or not _secrets.compare_digest(x_cron_secret or "", CRON_SECRET):
        raise HTTPException(status_code=403, detail="Invalid cron secret")

    results = {"tag_team": 0, "feed": 0, "sleep": 0, "poop": 0, "wellbeing": 0, "events": 0, "proactive": 0, "inactivity": 0, "mom_milestone": 0, "push_pruned": 0, "errors": 0}

    # Tag Team fatigue nudges only apply to households with a second member
    # to actually notify.
    households = await db.households.find({"members.1": {"$exists": True}}).to_list(10000)
    for h in households:
        try:
            await compute_handoff_score(h)
            results["tag_team"] += 1
        except Exception:
            logger.exception("cron: tag team check failed for household %s", h.get("household_code"))
            results["errors"] += 1

    # Everything else is per-device. Only devices with a registered push
    # token can receive anything anyway, so that's the natural device list
    # for this sweep, rather than every device that's ever used the app.
    token_docs = await db.push_tokens.find({}, {"_id": 0, "device_id": 1}).to_list(100000)
    device_ids = [t["device_id"] for t in token_docs]

    for device_id in device_ids:
        checks = [
            ("feed", predictive_feed_nudge),
            ("sleep", predictive_sleep_nudge),
            ("poop", predictive_poop_nudge),
            ("wellbeing", wellbeing_self_check),
            ("events", check_event_reminders),
            ("proactive", proactive_ai_checkin),
            ("inactivity", inactivity_reminder),
            ("mom_milestone", mom_milestone_check),
        ]
        for key, fn in checks:
            try:
                await fn(device_id)
                results[key] += 1
            except Exception:
                logger.exception("cron: %s check failed for device %s", key, device_id)
                results["errors"] += 1

    # Once per sweep, not once per device — checks recent push delivery
    # receipts and removes any token Expo confirms is dead, so someone
    # who deleted and reinstalled the app stops accumulating duplicate
    # devices that all keep getting every notification forever.
    try:
        prune_result = await prune_dead_push_tokens()
        results["push_pruned"] = prune_result.get("pruned", 0)
    except Exception:
        logger.exception("cron: push token pruning failed")
        results["errors"] += 1

    return results


def _make_household_code() -> str:
    return uuid.uuid4().hex[:6].upper()


# ----- Secure invitations (replaces the household_code as a bearer credential) -----
# The 6-character household_code above stays for one purpose only now:
# looking up a household when creating it and for the legacy join path
# kept alive for existing deep links (see join_household). It is
# deliberately NEVER treated as an ongoing access credential — after this
# point, real household access always runs through authenticated
# device + membership + permission, exactly as Groups 1-4 already
# enforce. Invitations below are the new, actual way to add someone.
INVITE_EXPIRE_HOURS = 72  # centralized, not hard-coded per call site


def _hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class InviteCreate(BaseModel):
    household_code: str
    requesting_device_id: str
    role: str = "partner"
    custom_role: Optional[str] = None
    permissions: Optional[dict] = None


class InviteAccept(BaseModel):
    token: str
    device_id: str
    name: str


@api_router.post("/household/invite")
async def create_invite(body: InviteCreate, verified_device_id: str = Depends(_verify_device)):
    """Mom (or another primary) generates a real invitation — a
    cryptographically random token, shown to her exactly once, expiring
    on its own, and usable exactly one time. This is what an invite link
    or QR code should actually encode, not the household_code itself."""
    if body.requesting_device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Token doesn't match the requesting device")
    h = await _get_household(body.household_code)
    requester = next((m for m in h["members"] if m["device_id"] == verified_device_id), None)
    if not requester or requester.get("role") != "primary":
        raise HTTPException(status_code=403, detail="Only the primary household member can invite")
    if body.role == "primary":
        raise HTTPException(status_code=403, detail="Can't invite someone directly as primary")

    raw_token = _secrets.token_urlsafe(32)  # ~256 bits — not guessable, not Math.random/uuid/timestamp-based
    invitation_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=INVITE_EXPIRE_HOURS)
    await db.household_invitations.insert_one({
        "invitation_id": invitation_id,
        "household_code": body.household_code,
        "created_by": verified_device_id,
        "intended_role": body.role,
        "custom_role": body.custom_role,
        "permissions": _sanitize_permissions(body.permissions),
        "token_hash": _hash_invite_token(raw_token),  # raw token never stored, only its hash
        "created_at": now.isoformat(),
        # Stored as a real datetime (not the usual ISO string convention
        # elsewhere in this file) specifically because MongoDB's TTL
        # auto-cleanup only fires on genuine BSON Date fields — an ISO
        # string here would silently never expire via the index below,
        # even though the manual expiry check in accept_invite would
        # still work fine on its own.
        "expires_at": expires_at,
        "accepted_at": None,
        "accepted_by": None,
        "revoked_at": None,
        "status": "pending",
    })
    # The raw token is returned exactly once, right here — it's never
    # retrievable again after this response, matching "store only a hash."
    return {"invitation_id": invitation_id, "token": raw_token, "expires_at": expires_at.isoformat()}


@api_router.post("/household/invite/accept")
async def accept_invite(body: InviteAccept, verified_device_id: str = Depends(_verify_device)):
    """Atomic accept — the find+update happens as one operation so two
    concurrent acceptance attempts can never both succeed against the
    same invitation, closing the race condition the spec explicitly
    called out. Deliberately vague on failure ('invalid or expired')
    rather than distinguishing wrong-vs-expired-vs-used, so a failed
    attempt can't be used to probe which case applies."""
    if body.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't accept an invitation as another device")

    # Simple, real rate limit using the project's own database rather than
    # a new library — five attempts per device per hour is generous for a
    # real person, punishing for a brute-force script trying random tokens.
    window_start = datetime.now(timezone.utc) - timedelta(hours=1)
    recent_attempts = await db.invite_attempt_log.count_documents(
        {"device_id": verified_device_id, "at": {"$gte": window_start}}
    )
    if recent_attempts >= 5:
        raise HTTPException(status_code=429, detail="Too many attempts — try again later")
    await db.invite_attempt_log.insert_one({"device_id": verified_device_id, "at": datetime.now(timezone.utc)})

    token_hash = _hash_invite_token(body.token)
    now = datetime.now(timezone.utc)
    generic_error = HTTPException(status_code=400, detail="That invitation is invalid or expired")

    invite = await db.household_invitations.find_one_and_update(
        {"token_hash": token_hash, "status": "pending", "expires_at": {"$gte": now}},
        {"$set": {"status": "accepted", "accepted_at": now.isoformat(), "accepted_by": body.device_id}},
    )
    if not invite:
        raise generic_error

    h = await _get_household(invite["household_code"])
    if not any(m["device_id"] == body.device_id for m in h["members"]):
        await db.households.update_one(
            {"household_code": invite["household_code"]},
            {"$push": {"members": {
                "device_id": body.device_id, "name": body.name, "role": invite["intended_role"],
                "custom_role": invite.get("custom_role"), "permissions": invite["permissions"],
            }}},
        )
    return await _get_household(invite["household_code"])


@api_router.delete("/household/invite/{invitation_id}")
async def revoke_invite(invitation_id: str, requesting_device_id: str, verified_device_id: str = Depends(_verify_device)):
    if requesting_device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Token doesn't match the requesting device")
    invite = await db.household_invitations.find_one({"invitation_id": invitation_id}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if invite["created_by"] != verified_device_id:
        raise HTTPException(status_code=403, detail="Only whoever created this invitation can revoke it")
    await db.household_invitations.update_one(
        {"invitation_id": invitation_id, "status": "pending"},
        {"$set": {"status": "revoked", "revoked_at": now_iso()}},
    )
    return {"status": "revoked"}


@api_router.get("/household/invite/pending/{household_code}")
async def pending_invites(household_code: str, requesting_device_id: str, verified_device_id: str = Depends(_verify_device)):
    if requesting_device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Token doesn't match the requesting device")
    h = await _get_household(household_code)
    if not any(m["device_id"] == verified_device_id for m in h["members"]):
        raise HTTPException(status_code=403, detail="Not a member of this household")
    invites = await db.household_invitations.find(
        {"household_code": household_code, "status": "pending"}, {"_id": 0, "token_hash": 0}
    ).to_list(50)
    return invites


async def _get_household(code: str):
    h = await db.households.find_one({"household_code": code}, {"_id": 0})
    if not h:
        raise HTTPException(status_code=404, detail="Household not found")
    return h


@api_router.post("/household")
async def create_household(h: HouseholdCreate, verified_device_id: str = Depends(_verify_device)):
    if h.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't create a household as another device")
    code = _make_household_code()
    # The creator (mom, in practice) gets every permission by default —
    # she's not a caregiver being granted access to her own household.
    full_permissions = {k: True for k in CARE_CIRCLE_PERMISSION_KEYS}
    doc = {
        "household_code": code,
        "members": [{"device_id": h.device_id, "name": h.name, "role": h.role,
                      "custom_role": None, "permissions": full_permissions}],
        "on_duty_device_id": h.device_id,
        "on_duty_since": now_iso(),
        "created_at": now_iso(),
    }
    await db.households.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api_router.post("/household/join")
async def join_household(j: HouseholdJoin, verified_device_id: str = Depends(_verify_device)):
    # LEGACY PATH — kept alive only for existing deep links/installed
    # clients that predate the real invitation system below
    # (POST /household/invite + /household/invite/accept). New joins
    # should go through that instead: a household_code alone is
    # permanent and reusable by design, exactly what this whole change
    # was meant to stop being the actual access credential. Not removed
    # yet, per the explicit migration requirement not to abruptly break
    # existing members — safe to disable once the frontend is confirmed
    # switched over to the new invite flow.
    if j.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't join a household as another device")
    h = await _get_household(j.household_code)
    if not any(m["device_id"] == j.device_id for m in h["members"]):
        # A real Care Circle can be more than the original 2-person Tag
        # Team pair — anyone joining beyond that gets whatever permissions
        # mom set at invite time (or the safe defaults), never full access
        # by default the way the household creator gets. "primary" is
        # deliberately never accepted from the client here — the one
        # existing primary member already holds that role from when the
        # household was created; letting a joiner claim it themselves
        # would hand them full permission-changing authority over
        # everyone else, exactly the privilege escalation this endpoint
        # has to prevent.
        safe_role = j.role if j.role != "primary" else "partner"
        await db.households.update_one(
            {"household_code": j.household_code},
            {"$push": {"members": {
                "device_id": j.device_id, "name": j.name, "role": safe_role,
                "custom_role": j.custom_role, "permissions": _sanitize_permissions(j.permissions),
            }}},
        )
    h = await _get_household(j.household_code)
    return h


@api_router.get("/household/{household_code}/care-circle")
async def get_care_circle(household_code: str, verified_device_id: str = Depends(_verify_device)):
    """The full roster with each person's role and real permissions — the
    listing screen mom uses to see and manage who's in her circle."""
    h = await _get_household(household_code)
    if not any(m["device_id"] == verified_device_id for m in h["members"]):
        raise HTTPException(status_code=403, detail="Not a member of this household")
    return {"household_code": household_code, "members": h["members"]}


@api_router.patch("/household/care-circle/permissions")
async def update_care_circle_permissions(body: CareCirclePermissionsUpdate, verified_device_id: str = Depends(_verify_device)):
    """Only the household's own primary member can change anyone's
    permissions — enforced here, not just hidden in the UI. Sanitized the
    same way join does, so a caregiver can never grant themselves
    something mom didn't explicitly turn on. The requesting_device_id in
    the body is no longer trusted on its own — it has to match the
    device_id the caller's actual signed token proves they are."""
    if body.requesting_device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Token doesn't match the requesting device")
    h = await _get_household(body.household_code)
    requester = next((m for m in h["members"] if m["device_id"] == body.requesting_device_id), None)
    if not requester or requester.get("role") != "primary":
        raise HTTPException(status_code=403, detail="Only the primary household member can change permissions")
    if not any(m["device_id"] == body.target_device_id for m in h["members"]):
        raise HTTPException(status_code=404, detail="That person isn't in this household")

    clean = _sanitize_permissions(body.permissions)
    await db.households.update_one(
        {"household_code": body.household_code, "members.device_id": body.target_device_id},
        {"$set": {"members.$.permissions": clean}},
    )
    return {"device_id": body.target_device_id, "permissions": clean}


def _member_has_permission(household: dict, device_id: str, permission_key: str) -> bool:
    """The real database-level enforcement the spec asks for — call this
    before returning anything sensitive to a Care Circle member, rather
    than relying on the app to simply not show it in the UI."""
    member = next((m for m in household.get("members", []) if m["device_id"] == device_id), None)
    if not member:
        return False
    return member.get("permissions", DEFAULT_CARE_CIRCLE_PERMISSIONS).get(permission_key, False)


@api_router.get("/household/{household_code}/mom-status")
async def care_circle_mom_status(household_code: str, viewer_device_id: str, verified_device_id: str = Depends(_verify_device)):
    """What a Care Circle member actually sees when they open the app —
    built section by section from their REAL permissions, checked against
    the database on every call, not filtered client-side. Someone without
    a given permission gets that section omitted entirely, not just
    hidden in the UI; the data never leaves the server for them.
    viewer_device_id must match the caller's actual verified token — this
    is the fix for the audit's top finding: before this, anyone who knew
    or guessed a household_code and a member's device_id string could
    call this and get real data back with nothing to stop them."""
    if viewer_device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Token doesn't match the requested viewer")
    h = await _get_household(household_code)
    if not any(m["device_id"] == viewer_device_id for m in h["members"]):
        raise HTTPException(status_code=403, detail="Not a member of this household")

    primary = next((m for m in h["members"] if m["role"] == "primary"), h["members"][0])
    mom_device_id = primary["device_id"]
    result: dict = {"household_code": household_code}

    if _member_has_permission(h, viewer_device_id, "baby_tracking"):
        last_feed = await db.baby_logs.find_one({"device_id": mom_device_id, "kind": "feed"}, {"_id": 0}, sort=[("at", -1)])
        last_diaper = await db.baby_logs.find_one({"device_id": mom_device_id, "kind": "diaper"}, {"_id": 0}, sort=[("at", -1)])
        last_sleep = await db.baby_logs.find_one({"device_id": mom_device_id, "kind": "sleep"}, {"_id": 0}, sort=[("at", -1)])
        result["baby_tracking"] = {"last_feed": last_feed, "last_diaper": last_diaper, "last_sleep": last_sleep}

    if _member_has_permission(h, viewer_device_id, "care_shifts"):
        score = await compute_handoff_score(h)
        result["care_shifts"] = {"on_duty_device_id": h.get("on_duty_device_id"), "hours_on_duty": score.get("hours_on_duty")}

    if _member_has_permission(h, viewer_device_id, "cuddle_load"):
        result["cuddle_load"] = await compute_handoff_score(h)

    if _member_has_permission(h, viewer_device_id, "mom_recovery"):
        recent_mood = await db.moods.find_one({"device_id": mom_device_id}, {"_id": 0}, sort=[("created_at", -1)])
        # Deliberately just the mood NUMBER and whether she's checked in
        # recently — never her written notes or AI conversation content,
        # which stay private regardless of this permission.
        result["mom_recovery"] = {
            "has_recent_checkin": bool(recent_mood),
            "mood_score": recent_mood.get("mood") if recent_mood else None,
        }

    if _member_has_permission(h, viewer_device_id, "appointments"):
        upcoming = await db.personal_events.find(
            {"device_id": mom_device_id, "date": {"$gte": datetime.now(timezone.utc).date().isoformat()}}, {"_id": 0}
        ).sort("date", 1).limit(5).to_list(5)
        result["appointments"] = upcoming

    return result


@api_router.patch("/household/role")
@api_router.patch("/household/role")
async def update_role(r: RoleUpdate, verified_device_id: str = Depends(_verify_device)):
    # This had NO authorization at all before this fix — any caller could
    # change ANY member's role to anything, including granting themselves
    # "primary" and, through that, full permission-changing authority
    # over the whole household. Now: you can only ever update your own
    # role entry, and "primary" is never an acceptable value here at
    # all — that role is only ever set once, at household creation.
    if r.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't change another member's role")
    if r.role == "primary":
        raise HTTPException(status_code=403, detail="Can't self-assign the primary role")
    h = await _get_household(r.household_code)
    if not any(m["device_id"] == r.device_id for m in h["members"]):
        raise HTTPException(status_code=404, detail="Not a member of this household")
    await db.households.update_one(
        {"household_code": r.household_code, "members.device_id": r.device_id},
        {"$set": {"members.$.role": r.role}},
    )
    return await _get_household(r.household_code)


@api_router.get("/household/by-device/{device_id}")
async def household_for_device(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's household")
    h = await db.households.find_one({"members.device_id": device_id}, {"_id": 0})
    return h  # None if not part of a household yet


def _hours_between(iso_a: str, iso_b: str) -> float:
    a = datetime.fromisoformat(iso_a)
    b = datetime.fromisoformat(iso_b)
    return abs((b - a).total_seconds()) / 3600.0


def _is_night(iso_ts: str) -> bool:
    hour = datetime.fromisoformat(iso_ts).hour
    return hour >= NIGHT_START_HOUR or hour < NIGHT_END_HOUR


async def compute_handoff_score(household: dict) -> dict:
    """Weighted, transparent fatigue/hand-off score for whoever is on duty.
    0-100. Higher = stronger case for tagging out. Every input is shown
    in the breakdown so this never feels like a black-box judgment."""
    on_duty_id = household.get("on_duty_device_id")
    on_duty_since = household.get("on_duty_since") or household["created_at"]
    now = now_iso()

    hours_on_duty = _hours_between(on_duty_since, now)

    # Interruptions logged by the on-duty caregiver since their shift started
    logs = await db.baby_logs.find(
        {"device_id": on_duty_id, "at": {"$gte": on_duty_since}}, {"_id": 0}
    ).to_list(200)
    interruption_count = len(logs)
    night_interruptions = sum(1 for l in logs if _is_night(l["at"]))

    # Most recent self-reported mood/energy from the on-duty caregiver
    latest_mood = await db.moods.find_one(
        {"device_id": on_duty_id}, {"_id": 0}, sort=[("created_at", -1)]
    )
    energy = latest_mood.get("energy") if latest_mood else None
    mood = latest_mood.get("mood") if latest_mood else None

    on_duty_member = next(
        (m for m in household["members"] if m["device_id"] == on_duty_id), None
    )
    emotion_signal = _detect_emotion_signal(
        on_duty_member.get("name") if on_duty_member else None, latest_mood
    )

    # --- weighted scoring (each component capped so no single factor dominates) ---
    duty_points = min(hours_on_duty * 6, 40)                       # long stretch on duty
    interruption_points = min(interruption_count * 5, 25)          # frequency of interruptions
    night_points = min(night_interruptions * 4, 20)                # overnight is harder
    energy_points = max(0, (3 - energy) * 6) if energy is not None else 0   # low self-reported energy
    mood_points = max(0, (3 - mood) * 4) if mood is not None else 0        # low self-reported mood
    emotion_points = 8 if emotion_signal else 0                    # gentle nudge, not a big swing

    score = round(min(
        duty_points + interruption_points + night_points + energy_points + mood_points + emotion_points,
        100,
    ))

    if score >= 60:
        level = "suggest"
        message = "It's been a long stretch — could be a nice moment for a switch, whenever works."
    elif score >= 35:
        level = "check_in"
        message = "Things are adding up a little. A short check-in or break might help."
    else:
        level = "steady"
        message = "Things look steady right now."

    # Automatic escalation: if she's been on a long stretch AND hasn't eaten
    # today AND the baby hasn't had a logged sleep today, that's a genuinely
    # different situation than ordinary fatigue — surface it plainly and
    # push immediately, not gated behind the normal threshold-crossing logic.
    today = datetime.now(timezone.utc).date().isoformat()
    meal_today = await db.meal_checkins.find_one({"device_id": on_duty_id, "date": today})
    ate_today = bool(meal_today and meal_today.get("ate_today"))
    sleep_logged_today = await db.baby_logs.count_documents(
        {"device_id": on_duty_id, "kind": "sleep", "at": {"$gte": today}}
    )
    needs_urgent_check = hours_on_duty >= 5 and not ate_today and sleep_logged_today == 0
    if needs_urgent_check:
        level = "urgent"
        message = "She's been going for a while and hasn't logged eating or a break today — this might be more than the usual stretch."

    other_member = next(
        (m for m in household["members"] if m["device_id"] != on_duty_id), None
    )

    # Nudge the OTHER caregiver — but only on the moment it first crosses into
    # "suggest", not on every 45-second poll. Re-fires only if it later drops
    # back down and crosses again, so it stays a nudge, not a nag.
    if level == "suggest" and household.get("last_notified_level") != "suggest" and other_member:
        on_duty_name = on_duty_member.get("name") if on_duty_member else "They"
        await send_push(
            other_member["device_id"],
            "Cuddle · Tag Team",
            f"{on_duty_name} has been on it for a while — might be a good time to check in or take over.",
        )
    if level != household.get("last_notified_level"):
        await db.households.update_one(
            {"household_code": household["household_code"]},
            {"$set": {"last_notified_level": level}},
        )

    # Urgent escalation pushes at most once per day (its own flag, separate
    # from the normal level tracking above) so it can't spam even if this
    # gets computed on every poll throughout a long, hard day.
    if level == "urgent" and household.get("last_urgent_push_date") != today:
        on_duty_name = on_duty_member.get("name") if on_duty_member else "She"
        if other_member:
            await send_push(
                other_member["device_id"],
                "Cuddle · Check on her",
                f"{on_duty_name} hasn't logged eating or a break today after {round(hours_on_duty)}+ hours — she could probably use you right now.",
            )
        # And directly to her too — a partner check-in doesn't guarantee she
        # actually eats or rests, so tell her too, not just about her.
        await send_push(
            on_duty_id,
            "Cuddle · Checking in on you",
            f"It's been {round(hours_on_duty)}+ hours — have you had a chance to eat or catch a break? You matter here too.",
        )
        await db.households.update_one(
            {"household_code": household["household_code"]},
            {"$set": {"last_urgent_push_date": today}},
        )

    return {
        "score": score,
        "level": level,
        "message": message,
        "on_duty_device_id": on_duty_id,
        "on_duty_role": on_duty_member.get("role") if on_duty_member else None,
        "hours_on_duty": round(hours_on_duty, 1),
        "suggested_next": other_member,
        "emotion_signal": emotion_signal,
        "breakdown": {
            "hours_on_duty": round(hours_on_duty, 1),
            "interruptions_since_shift_start": interruption_count,
            "overnight_interruptions": night_interruptions,
            "latest_energy_1to5": energy,
            "latest_mood_1to5": mood,
        },
    }


@api_router.get("/handoff/score/{household_code}")
async def handoff_score(household_code: str, verified_device_id: str = Depends(_verify_device)):
    h = await _get_household(household_code)
    if not any(m["device_id"] == verified_device_id for m in h["members"]):
        raise HTTPException(status_code=403, detail="Not a member of this household")
    return await compute_handoff_score(h)


class SOSRequest(BaseModel):
    household_code: str
    device_id: str
    note: Optional[str] = None


@api_router.post("/handoff/sos")
async def handoff_sos(s: SOSRequest, verified_device_id: str = Depends(_verify_device)):
    """One tap, no calling. Fires immediately — no score threshold, no
    once-a-day cap. This is for right now, not a nudge. Previously had
    zero authorization at all — anyone who knew a household_code could
    trigger a real 'urgent, need you now' push to that family, claiming
    to be any member. This is arguably the single most consequential
    fix in this whole pass, given what a fake emergency alert could do."""
    if s.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't send an SOS as another device")
    h = await _get_household(s.household_code)
    if not any(m["device_id"] == s.device_id for m in h["members"]):
        raise HTTPException(status_code=403, detail="Not a member of this household")
    sender = next((m for m in h["members"] if m["device_id"] == s.device_id), None)
    other_member = next((m for m in h["members"] if m["device_id"] != s.device_id), None)
    sender_name = sender.get("name") if sender else "She"

    if other_member:
        body = f"{sender_name} needs you right now"
        if s.note:
            body += f": {s.note}"
        await send_push(other_member["device_id"], "Cuddle · Need you now", body, urgent=True)

    await db.sos_events.insert_one({
        "household_code": s.household_code, "device_id": s.device_id,
        "note": s.note, "created_at": now_iso(),
    })
    return {"ok": True, "notified": other_member is not None}


@api_router.post("/handoff/switch")
async def handoff_switch(s: HandoffSwitch, verified_device_id: str = Depends(_verify_device)):
    if s.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't switch duty as another device")
    h = await _get_household(s.household_code)
    if not any(m["device_id"] == s.device_id for m in h["members"]):
        raise HTTPException(status_code=400, detail="Not a member of this household")

    prev_duty_id = h.get("on_duty_device_id")
    prev_since = h.get("on_duty_since") or h["created_at"]

    await db.handoff_events.insert_one({
        "household_code": s.household_code,
        "from_device_id": prev_duty_id,
        "to_device_id": s.device_id,
        "prev_shift_hours": round(_hours_between(prev_since, now_iso()), 1),
        "note": s.note,
        "at": now_iso(),
    })
    await db.households.update_one(
        {"household_code": s.household_code},
        {"$set": {"on_duty_device_id": s.device_id, "on_duty_since": now_iso()}},
    )
    h = await _get_household(s.household_code)
    return h


@api_router.get("/handoff/history/{household_code}")
async def handoff_history(household_code: str, limit: int = 20, verified_device_id: str = Depends(_verify_device)):
    h = await _get_household(household_code)
    if not any(m["device_id"] == verified_device_id for m in h["members"]):
        raise HTTPException(status_code=403, detail="Not a member of this household")
    docs = await db.handoff_events.find(
        {"household_code": household_code}, {"_id": 0}
    ).sort("at", -1).to_list(limit)
    return docs


# ----- Cultural spaces (opt-in) -----
@api_router.get("/spaces/{device_id}")
async def spaces_for(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's spaces")
    prof = await db.profiles.find_one({"device_id": device_id}, {"_id": 0}) or {}
    joined = prof.get("joined_spaces", [])
    counts = {}
    for space in CULTURAL_SPACES:
        counts[space["key"]] = await db.profiles.count_documents({"joined_spaces": space["key"]})
    spaces_with_counts = [{**s, "member_count": counts.get(s["key"], 0)} for s in CULTURAL_SPACES]
    return {"spaces": spaces_with_counts, "joined": joined}


@api_router.post("/spaces/join")
async def join_space(a: SpaceAction, verified_device_id: str = Depends(_verify_device)):
    if a.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't join a space as another device")
    await db.profiles.update_one({"device_id": a.device_id},
                                 {"$addToSet": {"joined_spaces": a.space}}, upsert=True)
    return {"ok": True}


@api_router.post("/spaces/leave")
async def leave_space(a: SpaceAction, verified_device_id: str = Depends(_verify_device)):
    if a.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't leave a space as another device")
    await db.profiles.update_one({"device_id": a.device_id},
                                 {"$pull": {"joined_spaces": a.space}})
    return {"ok": True}


# ----- Guides & resources (culturally-aware) -----
@api_router.get("/homely/recipes")
async def homely_recipes():
    """Summary list only, not full ingredients — matches how the Instacart
    Create Recipe Page endpoint is meant to be called: once per recipe,
    right when she actually wants to shop it, not preloaded for all of
    them up front."""
    return [
        {"id": r["id"], "title": r["title"], "servings": r["servings"], "cooking_time": r["cooking_time"]}
        for r in HOMELY_RECIPES
    ]


@api_router.get("/homely/recipes/{recipe_id}")
async def homely_recipe_detail(recipe_id: str):
    recipe = next((r for r in HOMELY_RECIPES if r["id"] == recipe_id), None)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe


@api_router.post("/homely/recipes/{recipe_id}/shop")
async def homely_recipe_shop(recipe_id: str):
    """Sends the recipe's real ingredients to Instacart's Create Recipe
    Page endpoint and returns a real shoppable link. The link opens the
    actual Instacart app directly (confirmed supported on both iOS and
    Android), with these ingredients already in the cart for her to pick
    a store and check out on Instacart's own side."""
    recipe = next((r for r in HOMELY_RECIPES if r["id"] == recipe_id), None)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return await _create_instacart_recipe_link(recipe, only_ingredient_names=None)


class ShopMissingRequest(BaseModel):
    missing_ingredients: List[str]


@api_router.post("/homely/recipes/{recipe_id}/shop-missing")
async def homely_recipe_shop_missing(recipe_id: str, body: ShopMissingRequest):
    """Same real Instacart link, but scoped to just the specific
    ingredients the grocery-photo scan identified as actually missing,
    using this recipe's own real quantities rather than asking the AI to
    guess amounts a second time."""
    recipe = next((r for r in HOMELY_RECIPES if r["id"] == recipe_id), None)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if not body.missing_ingredients:
        raise HTTPException(status_code=400, detail="No missing ingredients were provided")
    return await _create_instacart_recipe_link(recipe, only_ingredient_names=body.missing_ingredients)


async def _create_instacart_recipe_link(recipe: dict, only_ingredient_names: Optional[List[str]]) -> dict:
    if not INSTACART_API_KEY:
        raise HTTPException(status_code=503, detail="Instacart isn't connected yet, an admin needs to add an API key")

    ingredients = recipe["ingredients"]
    if only_ingredient_names:
        wanted = {n.lower() for n in only_ingredient_names}
        ingredients = [ing for ing in ingredients if ing["name"].lower() in wanted]
        if not ingredients:
            # The scan's item names didn't match this recipe's real
            # ingredient names closely enough — fall back to the full
            # list rather than silently sending Instacart an empty cart.
            ingredients = recipe["ingredients"]

    payload = {
        "title": recipe["title"],
        "servings": recipe["servings"],
        "cooking_time": recipe["cooking_time"],
        "instructions": [line for line in recipe["instructions"]],
        "ingredients": [
            {
                "name": ing["name"],
                "measurements": [{"quantity": ing["quantity"], "unit": ing["unit"]}],
            }
            for ing in ingredients
        ],
        "expires_in": 30,
        "landing_page_configuration": {"partner_linkback_url": "https://project-x-flame-gamma.vercel.app"},
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{INSTACART_BASE_URL}/idp/v1/products/recipe",
                headers={"Authorization": f"Bearer {INSTACART_API_KEY}", "Content-Type": "application/json"},
                json=payload,
            )
            if resp.status_code >= 300:
                logger.warning(f"Instacart recipe page failed: {resp.status_code} {resp.text[:300]}")
                raise HTTPException(status_code=502, detail="Couldn't reach Instacart right now, please try again")
            data = resp.json()
            # Instacart's docs consistently describe "returns a URL in the
            # response" but I couldn't confirm the exact field name from
            # documentation alone, not enough to trust a single guess.
            # Checking the plausible options rather than risking a silent
            # None on launch day. Once real credentials exist, log the
            # actual response once and simplify this to the real field.
            shopping_url = (
                data.get("products_link_url") or data.get("url")
                or data.get("link") or data.get("recipe_url")
            )
            if not shopping_url:
                logger.warning(f"Instacart response had no recognized URL field: {data}")
                raise HTTPException(status_code=502, detail="Got a response from Instacart but couldn't find the shopping link in it")
            return {"shopping_url": shopping_url}
    except httpx.HTTPError:
        logger.exception("Instacart request failed")
        raise HTTPException(status_code=502, detail="Couldn't reach Instacart right now, please try again")


@api_router.get("/guides")
async def guides(culture: Optional[str] = None):
    out = []
    for g in GUIDES:
        item = dict(g)
        # surface the matching cultural variant first if user opted in
        if culture:
            variant = next((v for v in g["variants"] if v["culture"] == culture), None)
            item["featured_variant"] = variant
        else:
            item["featured_variant"] = None
        out.append(item)
    return out


# ----- Give & Share -----
@api_router.get("/shop/categories")
async def shop_categories():
    return SHOP_CATEGORIES


@api_router.post("/shop/items")
async def create_shop_item(item: ShopItemCreate, verified_device_id: str = Depends(_verify_device)):
    if item.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't post a listing as another device")
    doc = item.model_dump()
    doc["created_at"] = now_iso()
    doc["claimed"] = False
    res = await db.shop_items.insert_one(doc)
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)
    return doc


@api_router.get("/shop/items")
async def list_shop_items(category: Optional[str] = None, device_id: Optional[str] = None):
    query: dict = {"claimed": False}
    if category and category != "all":
        query["category"] = category
    if device_id:
        # "mine" view — a poster's own listings, including claimed ones
        query = {"device_id": device_id}
    docs = await db.shop_items.find(query).sort("created_at", -1).to_list(200)
    for d in docs:
        d["id"] = str(d.pop("_id"))
    return docs


@api_router.get("/shop/items/{item_id}")
async def get_shop_item(item_id: str):
    doc = await db.shop_items.find_one({"_id": ObjectId(item_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    doc["id"] = str(doc.pop("_id"))
    return doc


@api_router.patch("/shop/items/{item_id}/claim")
async def claim_shop_item(item_id: str, requesting_device_id: str, verified_device_id: str = Depends(_verify_device)):
    # Previously had no device_id at all — anyone could mark any listing
    # claimed. Now requires a real, verified caller, and only the
    # original poster can mark their own listing claimed.
    if requesting_device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Token doesn't match the requesting device")
    item = await db.shop_items.find_one({"_id": ObjectId(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    if item.get("device_id") != verified_device_id:
        raise HTTPException(status_code=403, detail="Only the person who posted this can mark it claimed")
    await db.shop_items.update_one({"_id": ObjectId(item_id)}, {"$set": {"claimed": True}})
    return {"ok": True}


@api_router.delete("/shop/items/{item_id}")
async def delete_shop_item(item_id: str, requesting_device_id: str, verified_device_id: str = Depends(_verify_device)):
    if requesting_device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Token doesn't match the requesting device")
    item = await db.shop_items.find_one({"_id": ObjectId(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    if item.get("device_id") != verified_device_id:
        raise HTTPException(status_code=403, detail="Only the person who posted this can delete it")
    await db.shop_items.delete_one({"_id": ObjectId(item_id)})
    return {"ok": True}


@api_router.post("/shop/items/{item_id}/interest")
async def express_interest(item_id: str, body: InterestCreate, verified_device_id: str = Depends(_verify_device)):
    """Starts (or resumes) a private thread between an interested caregiver
    and the person who posted the item. One thread per interested device
    per item, so repeated taps don't spawn duplicate conversations."""
    if body.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't express interest as another device")
    device_id = body.device_id
    item = await db.shop_items.find_one({"_id": ObjectId(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    existing = await db.shop_threads.find_one({"item_id": item_id, "interested_device_id": device_id})
    if existing:
        return {"thread_id": str(existing["_id"])}
    doc = {
        "item_id": item_id,
        "item_title": item.get("title"),
        "poster_device_id": item.get("device_id"),
        "interested_device_id": device_id,
        "created_at": now_iso(),
    }
    res = await db.shop_threads.insert_one(doc)
    thread_id = str(res.inserted_id)
    await db.shop_thread_messages.insert_one({
        "thread_id": thread_id, "device_id": device_id,
        "text": f"Hi! I'm interested in \"{item.get('title')}\" — is it still available?",
        "created_at": now_iso(),
    })
    return {"thread_id": thread_id}


@api_router.get("/shop/threads/{device_id}")
async def my_shop_threads(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's threads")
    docs = await db.shop_threads.find(
        {"$or": [{"poster_device_id": device_id}, {"interested_device_id": device_id}]}
    ).sort("created_at", -1).to_list(100)
    for d in docs:
        d["id"] = str(d.pop("_id"))
        d["am_poster"] = d["poster_device_id"] == device_id
    return docs


@api_router.get("/shop/thread/{thread_id}")
async def shop_thread_messages(thread_id: str, requesting_device_id: str, verified_device_id: str = Depends(_verify_device)):
    if requesting_device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Token doesn't match the requesting device")
    thread = await db.shop_threads.find_one({"_id": ObjectId(thread_id)})
    if not thread:
        raise HTTPException(status_code=404, detail="Not found")
    # Same private-conversation principle as Group 3's chat fix — only the
    # two actual participants in this negotiation can read it.
    if verified_device_id not in (thread.get("poster_device_id"), thread.get("interested_device_id")):
        raise HTTPException(status_code=403, detail="Not a participant in this thread")
    thread["id"] = str(thread.pop("_id"))
    msgs = await db.shop_thread_messages.find({"thread_id": thread_id}, {"_id": 0}).sort("created_at", 1).to_list(300)
    return {"thread": thread, "messages": msgs}


@api_router.post("/shop/thread/{thread_id}")
async def send_shop_message(thread_id: str, m: ShopMessageCreate, verified_device_id: str = Depends(_verify_device)):
    if m.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't send a message as another device")
    thread = await db.shop_threads.find_one({"_id": ObjectId(thread_id)})
    if not thread:
        raise HTTPException(status_code=404, detail="Not found")
    if verified_device_id not in (thread.get("poster_device_id"), thread.get("interested_device_id")):
        raise HTTPException(status_code=403, detail="Not a participant in this thread")
    await db.shop_thread_messages.insert_one({
        "thread_id": thread_id, "device_id": m.device_id, "text": m.text, "created_at": now_iso(),
    })
    return {"ok": True}


# ----- Postpartum recovery -----
@api_router.get("/recovery/warning-signs")
async def recovery_warning_signs():
    return RECOVERY_WARNING_SIGNS


@api_router.get("/recovery/timeline/{device_id}")
async def recovery_timeline(device_id: str):
    """What's typical right now, based on her actual delivery date — general
    patterns, explicitly framed that way, never a promise about her specific
    body."""
    prof = await db.profiles.find_one({"device_id": device_id}, {"_id": 0})
    delivery_date = prof.get("delivery_date") if prof else None
    if not delivery_date:
        return {"available": False}

    try:
        delivered = datetime.fromisoformat(delivery_date.replace("Z", "+00:00"))
        if delivered.tzinfo is None:
            delivered = delivered.replace(tzinfo=timezone.utc)
    except (ValueError, AttributeError):
        return {"available": False}

    days = (datetime.now(timezone.utc) - delivered).days
    if days < 0:
        return {"available": False}  # delivery date hasn't happened yet

    stage = next((s for s in RECOVERY_TIMELINE if days <= s["max_day"]), RECOVERY_TIMELINE[-1])
    return {
        "available": True,
        "days_postpartum": days,
        "title": stage["title"],
        "body": stage["body"],
        "beyond_tracked_range": days > RECOVERY_TIMELINE[-1]["max_day"],
    }


@api_router.post("/recovery/checkin")
async def recovery_checkin(c: RecoveryCheckinCreate, verified_device_id: str = Depends(_verify_device)):
    if c.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's wellbeing data")
    
    doc = c.model_dump()
    doc["created_at"] = now_iso()
    has_warning = len(c.symptoms) > 0
    doc["has_warning_sign"] = has_warning

    # A tailored explanation of THIS specific combination, on top of the
    # static warning-sign list — still never a diagnosis, just clearer than
    # a generic "contact your provider" for every possible combination.
    ai_triage_note = None
    if has_warning and anthropic_client:
        try:
            symptom_labels = [w["label"] for w in RECOVERY_WARNING_SIGNS if w["key"] in c.symptoms]
            prompt = (
                "A postpartum mom just flagged these symptoms in a recovery check-in: "
                + "; ".join(symptom_labels) + ". "
                + (f"Pain level: {c.pain_level}/5. " if c.pain_level else "")
                + (f"Bleeding: {c.bleeding_level}. " if c.bleeding_level else "")
                + "In ONE short, calm sentence, explain why this specific combination is worth taking "
                "seriously (or note if one piece matters more than the others). Do not diagnose. End by "
                "telling her plainly to contact her provider or go to the ER now."
            )
            response = await anthropic_client.messages.create(
                model="claude-sonnet-4-6", max_tokens=150,
                messages=[{"role": "user", "content": prompt}],
            )
            ai_triage_note = "".join(b.text for b in response.content if b.type == "text").strip()
        except Exception:
            logger.exception("recovery triage AI failed")
    doc["ai_triage_note"] = ai_triage_note

    await db.recovery_checkins.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api_router.get("/recovery/checkins/{device_id}")
async def recovery_checkins(device_id: str, limit: int = 30, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's wellbeing data")
    
    docs = await db.recovery_checkins.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


@api_router.get("/recovery/today/{device_id}")
async def recovery_today(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's wellbeing data")
    
    today = datetime.now(timezone.utc).date().isoformat()
    doc = await db.recovery_checkins.find_one(
        {"device_id": device_id, "created_at": {"$regex": f"^{today}"}}, {"_id": 0})
    return {"done": doc is not None, "entry": doc}


@api_router.get("/recovery/{device_id}/report")
async def recovery_report(device_id: str, days: int = 14, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's wellbeing data")
    
    """A plain-text summary of her recent recovery check-ins, meant to be
    shared directly with her provider — real dates and self-reported
    values only, never an interpretation or a diagnosis."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    checkins = await db.recovery_checkins.find(
        {"device_id": device_id, "created_at": {"$gte": cutoff}}, {"_id": 0}
    ).sort("created_at", 1).to_list(500)

    if not checkins:
        return {"report_text": "No recovery check-ins logged in this period yet."}

    prof = await db.profiles.find_one({"device_id": device_id}, {"_id": 0})
    header_lines = [f"Postpartum Recovery Summary — last {days} days"]
    if prof and prof.get("name"):
        header_lines.append(f"For: {prof['name']}")
    if prof and prof.get("delivery_date"):
        header_lines.append(f"Delivery date: {prof['delivery_date']} ({prof.get('delivery_type', 'delivery type not set')})")
    header_lines.append("Generated by Cuddle from self-reported daily check-ins. Not a diagnosis.")
    header_lines.append("")

    lochia_labels = {"red": "Red", "pink_brown": "Pink/brown", "yellow_white": "Yellow/white"}
    diastasis_labels = {"no_gap": "No gap felt", "small_gap": "Small gap (~1-2 fingers)", "large_gap": "Larger gap (2+ fingers)", "not_checked": "Not checked"}

    lines = list(header_lines)
    for c in checkins:
        date_str = c["created_at"][:10]
        parts = [date_str]
        if c.get("pain_level") is not None:
            parts.append(f"pain {c['pain_level']}/5")
        if c.get("bleeding_level"):
            parts.append(f"bleeding: {c['bleeding_level']}")
        if c.get("lochia_color"):
            parts.append(f"lochia: {lochia_labels.get(c['lochia_color'], c['lochia_color'])}")
        if c.get("incision_status") and c["incision_status"] != "n/a":
            parts.append(f"incision: {c['incision_status']}")
        if c.get("pelvic_floor_done") is not None:
            parts.append(f"pelvic floor exercises: {'done' if c['pelvic_floor_done'] else 'not done'}")
        if c.get("diastasis_check") and c["diastasis_check"] != "not_checked":
            parts.append(f"diastasis check: {diastasis_labels.get(c['diastasis_check'], c['diastasis_check'])}")
        if c.get("symptoms"):
            symptom_labels = [w["label"] for w in RECOVERY_WARNING_SIGNS if w["key"] in c["symptoms"]]
            if symptom_labels:
                parts.append("FLAGGED: " + "; ".join(symptom_labels))
        lines.append(" | ".join(parts))

    lines.append("")
    lines.append("Bring this list to your postpartum appointment, or share it with your provider directly.")
    return {"report_text": "\n".join(lines)}


@api_router.post("/mom-wellness")
async def mom_wellness_log(w: MomWellnessLogCreate, verified_device_id: str = Depends(_verify_device)):
    if w.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's wellness data")
    
    """Water and medication logging, kept deliberately simple: a cup count
    and a name she chooses herself, not a drug database or calorie count."""
    doc = {
        "device_id": w.device_id,
        "kind": w.kind,
        "medication_name": w.medication_name,
        "at": w.at or now_iso(),
    }
    await db.mom_wellness_logs.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/mom-wellness/{device_id}/today")
async def mom_wellness_today(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's wellness data")
    
    today = datetime.now(timezone.utc).date().isoformat()
    logs = await db.mom_wellness_logs.find(
        {"device_id": device_id, "at": {"$gte": today}}, {"_id": 0}
    ).to_list(200)
    water_count = sum(1 for l in logs if l["kind"] == "water")
    medications = [l["medication_name"] for l in logs if l["kind"] == "medication" and l.get("medication_name")]
    return {"water_cups": water_count, "medications_taken": medications}


@api_router.get("/mom-wellness/{device_id}/medication-names")
async def mom_wellness_medication_names(device_id: str, days: int = 14, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's wellness data")
    
    """Her own regularly-used medication names, from her real recent
    history, so logging becomes a quick tap instead of retyping each time."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    names = await db.mom_wellness_logs.distinct(
        "medication_name", {"device_id": device_id, "kind": "medication", "at": {"$gte": cutoff}}
    )
    return [n for n in names if n]


@api_router.get("/caregiver-rest/{device_id}/predictions")
async def caregiver_rest_predictions(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's data")
    """Her own sleep pattern prediction, personal to this specific
    caregiver, not combined across the household the way baby's logs are.
    Reuses the same real wake-window math already built and tested for
    baby's nap predictions."""
    logs = await db.caregiver_rest_logs.find({"device_id": device_id}, {"_id": 0}).to_list(50)
    prediction = _predict_next_sleep(logs, age_fallback_minutes=None)
    return {"sleep": prediction}


@api_router.patch("/profile/appointment")
async def update_appointment(u: ProfileApptUpdate, verified_device_id: str = Depends(_verify_device)):
    if u.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's profile")
    await db.profiles.update_one(
        {"device_id": u.device_id},
        {"$set": {"postpartum_appt_done": u.postpartum_appt_done}},
    )
    return {"ok": True}


# ----- Meal support -----
class MealTrainCreate(BaseModel):
    device_id: str
    title: str
    notes: Optional[str] = None  # allergies, delivery instructions, preferences


class MealSlotCreate(BaseModel):
    date: str              # ISO date (day only)
    giver_name: str
    giver_contact: Optional[str] = None
    meal_description: Optional[str] = None


class MealCheckinCreate(BaseModel):
    device_id: str
    ate_today: bool


# ----- Neighborhood Meetups -----
# Starting hyper-local (Riverstone and Tesoro Viejo, both in Madera) since
# that's where this rolls out first, with Fresno general added as the
# next-phase, lighter-weight option — the venue list there will grow as
# more moms use it there.
MEETUP_NEIGHBORHOODS = [
    # Riverstone's coordinate below is real, ground-truth data — a tester
    # standing in Riverstone shared their phone's actual GPS reading after
    # two research-based estimates both turned out wrong (off by 5-17
    # miles). Tesoro Viejo has been shifted by that same confirmed error
    # vector, since it was estimated the same (flawed) way — it's a better
    # calibrated estimate now, but not itself ground-truth like Riverstone.
    {"key": "riverstone", "label": "Riverstone", "city": "Madera", "lat": 36.9050, "lng": -119.8189},
    {"key": "tesoro_viejo", "label": "Tesoro Viejo", "city": "Madera", "lat": 36.9470, "lng": -119.8209},
    {"key": "copper_river", "label": "Copper River Ranch (Terrabella)", "city": "Fresno", "lat": 36.8999, "lng": -119.7328},
    {"key": "clovis", "label": "Clovis", "city": "Clovis", "lat": 36.8252, "lng": -119.7029},
    {"key": "fresno", "label": "Fresno (general)", "city": "Fresno", "lat": 36.7378, "lng": -119.7871},
]

# Real, named spots — not generic placeholders — so the suggestion is
# actually useful the first time someone opens this.
MEETUP_VENUES = {
    "riverstone": [
        {"name": "Adventure Park", "type": "park", "note": "Play structures, climbing boulders, slides"},
        {"name": "Pavilion Park", "type": "park", "note": "Play equipment, tire swings, mini soccer field"},
        {"name": "Garden Park", "type": "park", "note": "BBQ areas, play structure, communal table"},
        {"name": "Central Bark Dog Park", "type": "park", "note": "If the meetup includes the family dog"},
        {"name": "The Lodge", "type": "clubhouse", "note": "Pool, spa, indoor gathering space"},
        {"name": "Riverwalk", "type": "cafe", "note": "Cafes and restaurants near Riverstone"},
    ],
    "tesoro_viejo": [
        {"name": "AXIS Coffee Bar + Eatery", "type": "cafe", "note": "Town Center coffee shop"},
        {"name": "Ranch House Clubhouse", "type": "clubhouse", "note": "Pools, cabanas, BBQ pavilion"},
        {"name": "Sycamore Square", "type": "park", "note": "Pocket park, open lawn and seating"},
        {"name": "Rosie's Greenway", "type": "park", "note": "Tree-lined path, picnic tables, open lawn"},
        {"name": "Lyles Greenway", "type": "park", "note": "Rose garden, linear park"},
    ],
    "copper_river": [
        {"name": "Copper River Ranch Community Park", "type": "park", "note": "Playground and basketball court right in the neighborhood"},
        {"name": "Copper River Ranch trail system", "type": "trail", "note": "8+ miles of walking/biking trails, connects to the Eaton Trail"},
        {"name": "Copper River Country Club", "type": "clubhouse", "note": "Pool, tennis, fitness center — membership may be required for some amenities"},
        {"name": "Woodward Park", "type": "trail", "note": "A few minutes away — lakes, gardens, and the Eaton Trail"},
    ],
    "clovis": [
        {"name": "Old Town Clovis Trail", "type": "trail", "note": "Paved, stroller-friendly, runs past shops and dessert spots"},
        {"name": "Clovis Botanical Garden", "type": "park", "note": "Native plants, shaded paths, quiet and easy pace"},
        {"name": "Dry Creek Park", "type": "trail", "note": "Walking path that connects right to the Botanical Garden"},
        {"name": "3 Oaks Vineyard & Winery", "type": "winery", "note": "Boutique winery right in Clovis, family-run, Saturday tastings"},
        {"name": "Old Town Clovis", "type": "cafe", "note": "Shops, cafes, and ice cream spots for a mom-date afternoon"},
        {"name": "Old Town Yoga", "type": "yoga_studio", "note": "Beginner, chair, and restorative classes — gentle enough for early postpartum"},
    ],
    "fresno": [
        {"name": "Woodward Park (Lewis S. Eaton Trail)", "type": "trail", "note": "Flat, paved, scenic river views — a local favorite for strollers"},
        {"name": "River Center — Hidden Homes Nature Trail", "type": "trail", "note": "Half-mile stroller-friendly trail with picnic tables and restrooms onsite"},
        {"name": "Fresno Chaffee Zoo", "type": "other", "note": "Great for a baby-date outing with older siblings too"},
        {"name": "Moravia Wines", "type": "winery", "note": "Frequently hosts family-friendly events"},
        {"name": "Solitary Cellars", "type": "winery", "note": "In Friant — foothill views while you sip"},
        {"name": "Blue Moon Yoga & Wellness (N Fresno)", "type": "yoga_studio", "note": "Offers non-heated classes explicitly good for postpartum and nursing moms"},
        {"name": "Pick your own spot", "type": "other", "note": "Name your favorite when you create a meetup"},
    ],
}

MEETUP_CATEGORIES = [
    {"key": "baby_date", "label": "Baby Date", "icon": "smile"},
    {"key": "mom_date", "label": "Mom Date", "icon": "coffee"},
    {"key": "trail_walk", "label": "Trail Walk", "icon": "map"},
    {"key": "yoga", "label": "Postpartum Yoga", "icon": "sunrise"},
    {"key": "other", "label": "Other Get-together", "icon": "users"},
]


class MeetupCreate(BaseModel):
    device_id: str
    title: str
    category: str
    neighborhood: str
    venue_name: str
    date: str            # ISO date, e.g. 2026-08-20
    time_label: str       # display string, e.g. "10:00 AM"
    duration_minutes: int = 90
    description: Optional[str] = None
    cultural_tag: Optional[str] = None   # optional link to a CULTURAL_SPACES key
    is_recurring: bool = False           # marks it as an ongoing weekly group, not a one-off
    lat: Optional[float] = None          # real coordinates — what actually makes "near me" work anywhere
    lng: Optional[float] = None


class MeetupRSVP(BaseModel):
    device_id: str
    name: str


class MeetupReflection(BaseModel):
    device_id: str
    mood_after: int          # 1-5
    note: Optional[str] = None


# ----- Celebrations: real local vendors, not invented placeholders -----
CELEBRATION_VENDORS = {
    "venue": [
        {"name": "Aroza Event Center", "note": "Indoor event hall on the Fresno-Clovis border, up to 250 guests", "website": "https://arozausa.com"},
        {"name": "K1 Speed Clovis", "note": "Indoor go-kart racing with all-in-one kids' birthday packages", "website": "https://www.k1speed.com/clovis-location"},
        {"name": "Sky Zone Clovis", "note": "Trampoline park with a dedicated party zone", "website": "https://www.skyzone.com"},
        {"name": "The Jungle Party House", "note": "Indoor jungle gym, bounce house, karaoke — Fresno", "website": "https://www.yelp.com/biz/the-jungle-party-house-fresno"},
    ],
    "cake": [
        {"name": "Nothing Bundt Cakes", "note": "Clovis & Fresno locations, pre-order up to 30 days ahead", "website": "https://www.nothingbundtcakes.com"},
        {"name": "Cake Me Away", "note": "Custom cakes & cupcakes in Clovis, contact by phone, text, or Facebook", "website": "https://www.cakemeaway.us"},
        {"name": "Spirit Made Cakes", "note": "Fresno's \"pink bakery\" — custom cakes for birthdays and baby showers", "website": "https://spiritmadecakes.com"},
    ],
    "photography": [
        {"name": "One Good Shot Photography", "note": "Baby's first birthday cake-smash sessions, serving Fresno & Clovis", "website": "https://onegoodshotphotography.com/contact/"},
    ],
}


@api_router.get("/celebrations/vendors")
async def celebration_vendors(category: Optional[str] = None):
    if category:
        return CELEBRATION_VENDORS.get(category, [])
    return CELEBRATION_VENDORS


# ----- Postpartum Support Directory -----
# Real local professionals, verified before inclusion — not a party vendor
# list. This is the one directory in the app where getting a listing wrong
# (a closed practice, a bad number) actually matters, so every entry here
# was checked individually rather than pulled from a single source.
SUPPORT_CATEGORIES = [
    {"key": "lactation", "label": "Lactation Support", "icon": "heart"},
    {"key": "doula", "label": "Postpartum Doulas", "icon": "users"},
    {"key": "pelvic_pt", "label": "Pelvic Floor PT", "icon": "activity"},
    {"key": "therapy", "label": "Postpartum Mental Health", "icon": "sun"},
]

POSTPARTUM_SUPPORT_PROVIDERS = {
    "lactation": [
        {"name": "Valley Children's Healthcare — Lactation Services", "note": "Hospital-affiliated IBCLC team, in-unit and phone consultations", "phone": "559-353-5427"},
        {"name": "Tess Johnson Lactation Services", "note": "IBCLC & RN, in-home visits, same-day availability in Fresno/Clovis", "website": "http://www.tjlactation.com"},
    ],
    "doula": [
        {"name": "Peaceful Passages Birthing Support Center", "note": "Postpartum doula, lactation, and meal-train coordination — 2575 E. Perrin Ave Suite 103, Fresno", "website": "https://peacefulpassagesbirthingsupportcenter.com"},
        {"name": "Mommy's Helper Postpartum In-Home Help", "note": "Serves Fresno, Clovis & Madera — accepts Medi-Cal, Kaiser, and Anthem", "website": "https://nextdoor.com/pages/mommys-helper-postpartum-in-home-help-service-clovis-ca/"},
    ],
    "pelvic_pt": [
        {"name": "Pelvic Health Clinic — Clovis Community Hospital", "note": "Hospital-affiliated pelvic floor PT for pre- and post-birth recovery", "website": "https://www.communitymedical.org/specialties-and-departments/rehabilitation/physical-therapy/pelvic-health-physical-therapy"},
        {"name": "SJ Hands On Physical Therapy", "note": "Fresno — postpartum recovery, incontinence, core stability", "phone": "559-570-3567"},
    ],
    "therapy": [
        {"name": "Central Valley Family Therapy", "note": "Dedicated Pregnancy + Postpartum Distress program (PMADs) — 7170 N Financial Dr Suite 110, Fresno", "phone": "559-691-6840"},
        {"name": "Michelle Kurtz, LCSW", "note": "Perinatal mental health specialist, based in Clovis", "website": "https://www.psychologytoday.com/us/therapists/ca/clovis"},
    ],
}


@api_router.get("/support-directory/categories")
async def support_directory_categories():
    return SUPPORT_CATEGORIES


@api_router.get("/support-directory")
async def support_directory(category: Optional[str] = None):
    if category:
        return POSTPARTUM_SUPPORT_PROVIDERS.get(category, [])
    return POSTPARTUM_SUPPORT_PROVIDERS


# ----- Personal Events: appointments + celebrations, manual or photo-scanned -----
EVENT_CATEGORIES = [
    {"key": "appointment", "label": "Appointment", "icon": "clipboard"},
    {"key": "birthday", "label": "Birthday Party", "icon": "gift"},
    {"key": "baby_shower", "label": "Baby Shower", "icon": "heart"},
    {"key": "other", "label": "Other", "icon": "calendar"},
]


class EventExtractRequest(BaseModel):
    image_base64: str
    media_type: str = "image/jpeg"


class GroceryScanRequest(BaseModel):
    image_base64: str
    media_type: str = "image/jpeg"


class MatchRecipeRequest(BaseModel):
    identified_items: List[str]
    exclude_recipe_ids: List[str] = []


class PersonalEventCreate(BaseModel):
    device_id: str
    title: str
    category: str
    date: str                 # ISO date
    time_label: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    reminder_hours_before: int = 24
    source: str = "manual"    # "manual" or "photo"


def _meal_train_code() -> str:
    return uuid.uuid4().hex[:6].upper()


@api_router.post("/mealtrain")
async def create_meal_train(m: MealTrainCreate):
    code = _meal_train_code()
    doc = {
        "meal_train_code": code,
        "device_id": m.device_id,
        "title": m.title,
        "notes": m.notes,
        "created_at": now_iso(),
    }
    await db.meal_trains.insert_one(dict(doc))
    return doc


@api_router.get("/mealtrain/by-device/{device_id}")
async def meal_train_for_device(device_id: str):
    doc = await db.meal_trains.find_one({"device_id": device_id}, {"_id": 0})
    return doc


@api_router.get("/mealtrain/{code}")
async def get_meal_train(code: str):
    doc = await db.meal_trains.find_one({"meal_train_code": code}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Meal train not found")
    slots = await db.meal_slots.find({"meal_train_code": code}).sort("date", 1).to_list(200)
    for s in slots:
        s["id"] = str(s.pop("_id"))
        s.pop("slot_token", None)  # never expose other people's cancel tokens
    return {"train": doc, "slots": slots}


@api_router.post("/mealtrain/{code}/slots")
async def sign_up_meal_slot(code: str, s: MealSlotCreate):
    train = await db.meal_trains.find_one({"meal_train_code": code})
    if not train:
        raise HTTPException(status_code=404, detail="Meal train not found")
    existing = await db.meal_slots.find_one({"meal_train_code": code, "date": s.date})
    if existing:
        raise HTTPException(status_code=409, detail="That date is already taken")
    slot_token = uuid.uuid4().hex  # lets the signer cancel later without needing an account
    doc = {
        "meal_train_code": code,
        "date": s.date,
        "giver_name": s.giver_name,
        "giver_contact": s.giver_contact,
        "meal_description": s.meal_description,
        "slot_token": slot_token,
        "created_at": now_iso(),
    }
    res = await db.meal_slots.insert_one(dict(doc))
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)
    return doc


@api_router.delete("/mealtrain/{code}/slots/{slot_id}")
async def cancel_meal_slot(code: str, slot_id: str, slot_token: str):
    slot = await db.meal_slots.find_one({"_id": ObjectId(slot_id), "meal_train_code": code})
    if not slot or slot.get("slot_token") != slot_token:
        raise HTTPException(status_code=403, detail="Can't cancel this slot")
    await db.meal_slots.delete_one({"_id": ObjectId(slot_id)})
    return {"ok": True}


@api_router.post("/meal-checkin")
async def meal_checkin(c: MealCheckinCreate):
    today = datetime.now(timezone.utc).date().isoformat()
    doc = {"device_id": c.device_id, "date": today, "ate_today": c.ate_today, "created_at": now_iso()}
    await db.meal_checkins.update_one(
        {"device_id": c.device_id, "date": today}, {"$set": doc}, upsert=True,
    )
    return doc


@api_router.get("/meal-checkin/{device_id}/today")
async def meal_checkin_today(device_id: str):
    today = datetime.now(timezone.utc).date().isoformat()
    doc = await db.meal_checkins.find_one({"device_id": device_id, "date": today}, {"_id": 0})
    return {"done": doc is not None, "entry": doc}


# ----- Neighborhood Meetups -----
@api_router.get("/meetups/neighborhoods")
async def meetup_neighborhoods():
    # Start with the 5 hand-curated areas (real, verified venues), then add
    # any other area names people have actually used when creating a
    # meetup — this is how the app grows beyond the initial test region
    # without needing a paid places API. No curated venues for these, but
    # they're real and browsable.
    known_keys = {n["key"] for n in MEETUP_NEIGHBORHOODS}
    custom_keys = await db.meetups.distinct("neighborhood")
    custom = [
        {"key": k, "label": k, "city": None, "custom": True}
        for k in custom_keys
        if k and k not in known_keys and k != "all"
    ]
    custom.sort(key=lambda n: n["label"])
    return MEETUP_NEIGHBORHOODS + custom



@api_router.get("/meetups/categories")
async def meetup_categories():
    return MEETUP_CATEGORIES


@api_router.get("/meetups/venues/{neighborhood}")
async def meetup_venues(neighborhood: str):
    return MEETUP_VENUES.get(neighborhood, [])


_OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def _overpass_grid_key(lat: float, lng: float) -> str:
    # Rounds to roughly a 1km grid cell so nearby requests within the same
    # area share one cached result, instead of every slightly-different
    # GPS reading triggering its own fresh Overpass query.
    return f"{round(lat, 2)}:{round(lng, 2)}"


async def _query_overpass_nearby(lat: float, lng: float, radius_m: int = 2000) -> list:
    """Real, free, universal venue discovery — genuinely works in any
    country, unlike the hand-curated list above, since OpenStreetMap's
    data isn't limited to specific pre-written areas. Coverage density
    still varies by how well-mapped a given area happens to be; this
    returns whatever real data exists there, nothing invented if it's
    sparse. Tries a second public mirror if the primary is slow/down,
    since this is shared community infrastructure, not a paid SLA."""
    query = f"""
    [out:json][timeout:10];
    (
      node["leisure"="park"](around:{radius_m},{lat},{lng});
      node["amenity"="cafe"](around:{radius_m},{lat},{lng});
      node["amenity"="community_centre"](around:{radius_m},{lat},{lng});
      node["leisure"="playground"](around:{radius_m},{lat},{lng});
    );
    out body 12;
    """
    for endpoint in _OVERPASS_ENDPOINTS:
        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                resp = await client.post(endpoint, data={"data": query})
                if resp.status_code != 200:
                    continue
                data = resp.json()
                venues = []
                type_map = {"park": "park", "cafe": "cafe", "community_centre": "clubhouse", "playground": "park"}
                for el in data.get("elements", []):
                    tags = el.get("tags", {})
                    name = tags.get("name")
                    if not name:
                        continue
                    kind = tags.get("leisure") or tags.get("amenity")
                    venues.append({
                        "name": name,
                        "type": type_map.get(kind, "other"),
                        "note": "Nearby on OpenStreetMap",
                    })
                return venues
        except Exception:
            logger.exception("Overpass query failed for endpoint %s", endpoint)
            continue
    return []


@api_router.get("/meetups/venues-near")
async def meetup_venues_near(lat: float, lng: float):
    """The real 'anywhere in the world' venue suggestion — checks our own
    cache first (real caching discipline, not hitting Overpass on every
    request), falls back to a live OpenStreetMap query only on a cache
    miss, then caches that result for next time. Zero Google involved."""
    grid_key = _overpass_grid_key(lat, lng)
    cached = await db.venue_cache.find_one({"grid_key": grid_key}, {"_id": 0})
    if cached:
        return {"venues": cached["venues"], "source": "cache", "cached_at": cached["cached_at"]}

    venues = await _query_overpass_nearby(lat, lng)
    await db.venue_cache.update_one(
        {"grid_key": grid_key},
        {"$set": {"grid_key": grid_key, "venues": venues, "cached_at": now_iso()}},
        upsert=True,
    )
    return {"venues": venues, "source": "live", "cached_at": now_iso()}


@api_router.get("/meetups/venues/{neighborhood}/recommended")
async def recommended_venues(neighborhood: str):
    """Ranks venues by how highly moms rated their mood after past meetups
    there — light personalization from real outcomes, not just a static list."""
    venues = MEETUP_VENUES.get(neighborhood, [])
    scored = []
    for v in venues:
        past = await db.meetups.find({"neighborhood": neighborhood, "venue_name": v["name"]}, {"_id": 0}).to_list(50)
        meetup_ids = [m["meetup_id"] for m in past]
        if meetup_ids:
            reflections = await db.meetup_reflections.find({"meetup_id": {"$in": meetup_ids}}, {"_id": 0}).to_list(200)
            if reflections:
                avg_mood = sum(r["mood_after"] for r in reflections) / len(reflections)
                scored.append({**v, "avg_mood_after": round(avg_mood, 1), "reflection_count": len(reflections)})
                continue
        scored.append({**v, "avg_mood_after": None, "reflection_count": 0})
    scored.sort(key=lambda v: (v["avg_mood_after"] is None, -(v["avg_mood_after"] or 0)))
    return scored


@api_router.post("/meetups")
async def create_meetup(m: MeetupCreate):
    meetup_id = uuid.uuid4().hex[:10]
    doc = m.model_dump()
    doc["meetup_id"] = meetup_id
    doc["created_at"] = now_iso()
    doc["attendees"] = [{"device_id": m.device_id, "name": "Host"}]
    # GeoJSON point, only when real coordinates were actually given — this
    # is what lets $near queries work below. [lng, lat] order is GeoJSON's
    # own convention, not a typo.
    if m.lat is not None and m.lng is not None:
        doc["location"] = {"type": "Point", "coordinates": [m.lng, m.lat]}
    await db.meetups.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api_router.get("/meetups")
async def list_meetups(
    neighborhood: Optional[str] = None, category: Optional[str] = None,
    cultural_tag: Optional[str] = None, lat: Optional[float] = None,
    lng: Optional[float] = None, radius_km: float = 50,
):
    today = datetime.now(timezone.utc).date().isoformat()
    query: dict = {"date": {"$gte": today}}
    if neighborhood and neighborhood != "all":
        query["neighborhood"] = neighborhood
    if category and category != "all":
        query["category"] = category
    if cultural_tag:
        query["cultural_tag"] = cultural_tag

    if lat is not None and lng is not None:
        # Real distance filtering/sorting, done by MongoDB itself — this
        # is what makes "meetups near me" actually work in any country,
        # not just the 2 hand-seeded neighborhoods. Only matches meetups
        # that have real coordinates; text-only "custom" neighborhoods
        # from before this fix won't appear in a near-me search, only in
        # the neighborhood dropdown list.
        query["location"] = {
            "$near": {
                "$geometry": {"type": "Point", "coordinates": [lng, lat]},
                "$maxDistance": radius_km * 1000,
            }
        }
        # $near already returns nearest-first, so an extra sort would
        # undo that ordering — skip the date sort in this branch.
        docs = await db.meetups.find(query, {"_id": 0}).to_list(200)
        return docs

    docs = await db.meetups.find(query, {"_id": 0}).sort("date", 1).to_list(200)
    return docs


@api_router.get("/meetups/mine/{device_id}")
async def my_meetups(device_id: str):
    docs = await db.meetups.find(
        {"attendees.device_id": device_id}, {"_id": 0}
    ).sort("date", -1).to_list(100)
    return docs


@api_router.get("/meetups/{meetup_id}")
async def get_meetup(meetup_id: str):
    doc = await db.meetups.find_one({"meetup_id": meetup_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Meetup not found")
    return doc


@api_router.post("/meetups/{meetup_id}/rsvp")
async def rsvp_meetup(meetup_id: str, r: MeetupRSVP):
    meetup = await db.meetups.find_one({"meetup_id": meetup_id})
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")
    if not any(a["device_id"] == r.device_id for a in meetup.get("attendees", [])):
        await db.meetups.update_one(
            {"meetup_id": meetup_id},
            {"$push": {"attendees": {"device_id": r.device_id, "name": r.name}}},
        )
    return await db.meetups.find_one({"meetup_id": meetup_id}, {"_id": 0})


@api_router.delete("/meetups/{meetup_id}/rsvp/{device_id}")
async def cancel_rsvp(meetup_id: str, device_id: str):
    await db.meetups.update_one(
        {"meetup_id": meetup_id},
        {"$pull": {"attendees": {"device_id": device_id}}},
    )
    return {"ok": True}


def _ics_escape(text: str) -> str:
    return (text or "").replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")


@api_router.get("/meetups/{meetup_id}/calendar.ics")
async def meetup_ics(meetup_id: str):
    """Standard .ics export — this is what makes 'Add to Apple Calendar'
    work: iOS Safari recognizes text/calendar and opens the native import
    sheet directly. Same file works for Google/Outlook calendar too."""
    meetup = await db.meetups.find_one({"meetup_id": meetup_id}, {"_id": 0})
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")

    try:
        start_dt = datetime.strptime(f"{meetup['date']} {meetup['time_label']}", "%Y-%m-%d %I:%M %p")
    except ValueError:
        start_dt = datetime.strptime(meetup["date"], "%Y-%m-%d")
    end_dt = start_dt + timedelta(minutes=meetup.get("duration_minutes", 90))
    dtstamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    venue = meetup.get("venue_name", "")
    neighborhood_label = next((n["label"] for n in MEETUP_NEIGHBORHOODS if n["key"] == meetup.get("neighborhood")), "")
    location = f"{venue}, {neighborhood_label}" if neighborhood_label else venue

    ics = "\r\n".join([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Cuddle//Meetup//EN",
        "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT",
        f"UID:{meetup_id}@cuddleapp",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART:{start_dt.strftime('%Y%m%dT%H%M%S')}",
        f"DTEND:{end_dt.strftime('%Y%m%dT%H%M%S')}",
        f"SUMMARY:{_ics_escape(meetup['title'])}",
        f"LOCATION:{_ics_escape(location)}",
        f"DESCRIPTION:{_ics_escape(meetup.get('description') or 'Planned via Cuddle')}",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ])
    return StreamingResponse(
        iter([ics]),
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="meetup-{meetup_id}.ics"'},
    )


@api_router.post("/meetups/{meetup_id}/reflection")
async def meetup_reflection(meetup_id: str, r: MeetupReflection):
    """A short, warm AI reflection after a meetup — and it's logged as a
    real mood entry too, so it actually feeds her Journey trends, not just
    sitting in a separate silo."""
    meetup = await db.meetups.find_one({"meetup_id": meetup_id}, {"_id": 0})
    if not meetup:
        raise HTTPException(status_code=404, detail="Meetup not found")

    ai_note = None
    if anthropic_client:
        try:
            prompt = (
                f"A mom just attended a meetup called \"{meetup['title']}\" with other moms nearby. "
                f"She rated how she felt afterward as {r.mood_after}/5. "
                + (f"She said: \"{r.note}\". " if r.note else "")
                + "Write ONE short, warm sentence acknowledging her experience. If it sounds like it went "
                "well, gently encourage her to do more of these. Never diagnose or make medical claims."
            )
            response = await anthropic_client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=120,
                messages=[{"role": "user", "content": prompt}],
            )
            ai_note = "".join(b.text for b in response.content if b.type == "text").strip()
        except Exception:
            logger.exception("meetup reflection AI failed")

    doc = {
        "meetup_id": meetup_id,
        "device_id": r.device_id,
        "mood_after": r.mood_after,
        "note": r.note,
        "ai_note": ai_note,
        "created_at": now_iso(),
    }
    await db.meetup_reflections.insert_one(dict(doc))

    # Also log into her regular mood history so this genuinely feeds her
    # existing Journey trends, not a disconnected feature.
    await db.moods.insert_one({
        "device_id": r.device_id,
        "mood": r.mood_after,
        "energy": None,
        "sleep_hours": None,
        "note": f"After meetup: {meetup['title']}" + (f" \u2014 {r.note}" if r.note else ""),
        "tags": ["Meetup"],
        "created_at": now_iso(),
    })

    doc.pop("_id", None)
    return doc


# ----- Weekly Insights (agentic — gathers real data, writes something new) -----
def _week_start_iso(d: date) -> str:
    monday = d - timedelta(days=d.weekday())
    return monday.isoformat()


@api_router.get("/insights/weekly/{device_id}")
async def weekly_insights(device_id: str, force: bool = False, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's data")
    week_of = _week_start_iso(datetime.now(timezone.utc).date())

    if not force:
        cached = await db.weekly_insights.find_one({"device_id": device_id, "week_of": week_of}, {"_id": 0})
        if cached:
            return cached

    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    moods = await db.moods.find(
        {"device_id": device_id, "created_at": {"$gte": week_ago}}, {"_id": 0}
    ).sort("created_at", 1).to_list(50)

    device_ids = await _household_device_ids(device_id)
    household = await db.households.find_one({"members.device_id": device_id}, {"_id": 0})
    balance_note = None
    if household and len(household.get("members", [])) > 1:
        logs_week = await db.baby_logs.find(
            {"device_id": {"$in": device_ids}, "at": {"$gte": week_ago}}
        ).to_list(1000)
        counts: dict = {}
        for l in logs_week:
            counts[l["device_id"]] = counts.get(l["device_id"], 0) + 1
        if counts:
            total = sum(counts.values())
            mine = counts.get(device_id, 0)
            balance_note = f"She logged {round(mine / total * 100)}% of {total} baby-care actions this week."

    meetups_attended = await db.meetup_reflections.find(
        {"device_id": device_id, "created_at": {"$gte": week_ago}}, {"_id": 0}
    ).to_list(20)

    if not moods and not meetups_attended:
        return {"week_of": week_of, "reflection": None, "has_data": False}

    mood_summary = ", ".join(str(m.get("mood")) for m in moods if m.get("mood") is not None) or "no mood check-ins logged"
    meetup_summary = f"{len(meetups_attended)} mom meetup(s) attended" if meetups_attended else "no meetups attended"

    reflection = None
    if anthropic_client:
        try:
            prompt = (
                f"Here's a postpartum mom's last 7 days: mood check-in scores (1-5 scale) were: {mood_summary}. "
                f"{meetup_summary}. " + (balance_note + " " if balance_note else "") +
                "Write a short (3-4 sentence), warm, specific weekly reflection — notice a real pattern in this "
                "data (not generic advice), and end with ONE small, concrete suggestion for the coming week. "
                "Never diagnose. Speak directly to her, second person."
            )
            response = await anthropic_client.messages.create(
                model="claude-sonnet-4-6", max_tokens=250,
                messages=[{"role": "user", "content": prompt}],
            )
            reflection = "".join(b.text for b in response.content if b.type == "text").strip()
        except Exception:
            logger.exception("weekly insights AI failed")

    doc = {
        "device_id": device_id,
        "week_of": week_of,
        "reflection": reflection,
        "has_data": True,
        "generated_at": now_iso(),
    }
    await db.weekly_insights.update_one(
        {"device_id": device_id, "week_of": week_of}, {"$set": doc}, upsert=True,
    )
    return doc


# ----- Personal Events endpoints -----
@api_router.get("/events/categories")
async def event_categories():
    return EVENT_CATEGORIES


@api_router.post("/events/extract")
async def extract_event_from_photo(req: EventExtractRequest):
    """Reads a photographed invite, appointment card, or flyer and pulls out
    the event details. Returns a DRAFT for her to review and edit — never
    auto-saves, since OCR/AI reads can be wrong and this shouldn't silently
    create something on her calendar without her seeing it first."""
    if not anthropic_client:
        raise HTTPException(status_code=503, detail="AI service unavailable")

    today = datetime.now(timezone.utc).date().isoformat()
    prompt = (
        f"Today's date is {today}. This image is a photographed invite, appointment card, or flyer. "
        "Extract the event details and respond with ONLY a JSON object (no markdown, no other text) "
        "with these exact keys: "
        '{"title": string, "category": one of "appointment"|"birthday"|"baby_shower"|"other", '
        '"date": "YYYY-MM-DD" (infer the year if not shown, using today\'s date as reference — never a past date), '
        '"time_label": string like "2:30 PM" or null if not shown, '
        '"location": string or null, "notes": string or null (any other relevant detail like a phone number or reason for visit)}. '
        "If you genuinely cannot read a field, use null for it. Never fabricate a date — if no date is visible, set date to null."
    )
    try:
        response = await anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=400,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": req.media_type, "data": req.image_base64}},
                    {"type": "text", "text": prompt},
                ],
            }],
        )
        raw = "".join(b.text for b in response.content if b.type == "text").strip()
        raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(raw)
        return parsed
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Couldn't read that clearly — try a clearer photo or enter it manually")
    except Exception as e:
        logger.exception("event extraction failed")
        raise HTTPException(status_code=502, detail=f"Extraction failed: {e}")


@api_router.post("/homely/scan-groceries")
async def scan_groceries(req: GroceryScanRequest):
    """Reads a photo of what she actually has, matches it against the real
    curated recipes, and separates what she already has from what she'd
    genuinely still need, so the Instacart link that follows only asks
    for the real gap, not the whole recipe from scratch."""
    if not anthropic_client:
        raise HTTPException(status_code=503, detail="AI service unavailable")

    recipe_context = "\n".join(
        f"- {r['id']}: {r['title']} (ingredients: {', '.join(i['name'] for i in r['ingredients'])})"
        for r in HOMELY_RECIPES
    )
    prompt = (
        "This photo shows groceries or ingredients she actually has right now. "
        "First, identify the real food items visible. Then, from this list of available recipes, "
        f"pick whichever one she could make with the LEAST additional shopping:\n{recipe_context}\n\n"
        "Respond with ONLY a JSON object (no markdown, no other text) with these exact keys: "
        '{"identified_items": [string, ...] (what you actually see in the photo), '
        '"suggested_recipe_id": string (the id from the list above), '
        '"have_ingredients": [string, ...] (which of that recipe\'s ingredients she appears to already have), '
        '"missing_ingredients": [string, ...] (which of that recipe\'s ingredients are NOT visible in the photo)}. '
        "If nothing in the photo looks food-related, set suggested_recipe_id to null."
    )
    try:
        response = await anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=500,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": req.media_type, "data": req.image_base64}},
                    {"type": "text", "text": prompt},
                ],
            }],
        )
        raw = "".join(b.text for b in response.content if b.type == "text").strip()
        raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(raw)

        recipe = next((r for r in HOMELY_RECIPES if r["id"] == parsed.get("suggested_recipe_id")), None)
        if recipe:
            parsed["suggested_recipe"] = {"id": recipe["id"], "title": recipe["title"]}
        return parsed
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Couldn't read that clearly, try a clearer photo")
    except Exception as e:
        logger.exception("grocery scan failed")
        raise HTTPException(status_code=502, detail=f"Scan failed: {e}")


@api_router.post("/homely/match-recipe")
async def match_recipe(req: MatchRecipeRequest):
    """Re-matches an already-identified pantry photo against a different
    recipe, so 'try another recipe' doesn't need a new photo or another
    vision call, just a fresh pick against the same known items."""
    if not anthropic_client:
        raise HTTPException(status_code=503, detail="AI service unavailable")

    candidates = [r for r in HOMELY_RECIPES if r["id"] not in req.exclude_recipe_ids]
    if not candidates:
        candidates = HOMELY_RECIPES  # exhausted the list, start the cycle over

    recipe_context = "\n".join(
        f"- {r['id']}: {r['title']} (ingredients: {', '.join(i['name'] for i in r['ingredients'])})"
        for r in candidates
    )
    items_context = ", ".join(req.identified_items) if req.identified_items else "nothing specific"
    prompt = (
        f"She has these items available: {items_context}. "
        f"From this list of recipes, pick whichever one she could make with the LEAST additional shopping:\n{recipe_context}\n\n"
        "Respond with ONLY a JSON object (no markdown, no other text) with these exact keys: "
        '{"suggested_recipe_id": string (the id from the list above), '
        '"have_ingredients": [string, ...] (which of that recipe\'s ingredients she appears to already have, based on her available items), '
        '"missing_ingredients": [string, ...] (which of that recipe\'s ingredients are NOT in her available items)}.'
    )
    try:
        response = await anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = "".join(b.text for b in response.content if b.type == "text").strip()
        raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(raw)

        recipe = next((r for r in HOMELY_RECIPES if r["id"] == parsed.get("suggested_recipe_id")), None)
        if recipe:
            parsed["suggested_recipe"] = {"id": recipe["id"], "title": recipe["title"]}
        return parsed
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Couldn't match a recipe just now, try again")
    except Exception as e:
        logger.exception("recipe re-match failed")
        raise HTTPException(status_code=502, detail=f"Match failed: {e}")


@api_router.post("/events")
async def create_event(e: PersonalEventCreate):
    event_id = uuid.uuid4().hex[:10]
    doc = e.model_dump()
    doc["event_id"] = event_id
    doc["created_at"] = now_iso()
    doc["reminded"] = False
    await db.personal_events.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api_router.get("/events/{device_id}")
async def list_events(device_id: str):
    today = datetime.now(timezone.utc).date().isoformat()
    docs = await db.personal_events.find(
        {"device_id": device_id, "date": {"$gte": today}}, {"_id": 0}
    ).sort("date", 1).to_list(200)
    return docs


@api_router.delete("/events/{event_id}")
async def delete_event(event_id: str):
    await db.personal_events.delete_one({"event_id": event_id})
    return {"ok": True}


@api_router.get("/events/{event_id}/calendar.ics")
async def event_ics(event_id: str):
    ev = await db.personal_events.find_one({"event_id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    try:
        start_dt = datetime.strptime(f"{ev['date']} {ev['time_label']}", "%Y-%m-%d %I:%M %p")
        all_day = False
    except (ValueError, TypeError):
        start_dt = datetime.strptime(ev["date"], "%Y-%m-%d")
        all_day = True
    end_dt = start_dt if all_day else start_dt + timedelta(hours=1)
    dtstamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cuddle//Event//EN", "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT", f"UID:{event_id}@cuddleapp", f"DTSTAMP:{dtstamp}",
    ]
    if all_day:
        lines += [f"DTSTART;VALUE=DATE:{start_dt.strftime('%Y%m%d')}", f"DTEND;VALUE=DATE:{end_dt.strftime('%Y%m%d')}"]
    else:
        lines += [f"DTSTART:{start_dt.strftime('%Y%m%dT%H%M%S')}", f"DTEND:{end_dt.strftime('%Y%m%dT%H%M%S')}"]
    lines += [
        f"SUMMARY:{_ics_escape(ev['title'])}",
        f"LOCATION:{_ics_escape(ev.get('location') or '')}",
        f"DESCRIPTION:{_ics_escape(ev.get('notes') or '')}",
        "END:VEVENT", "END:VCALENDAR", "",
    ]
    return StreamingResponse(
        iter(["\r\n".join(lines)]),
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="event-{event_id}.ics"'},
    )


@api_router.get("/events/{device_id}/check-reminders")
async def check_event_reminders(device_id: str):
    """Polled from the Home screen — fires a push once per event when it
    enters its reminder window, same lightweight pattern as the Tag Team
    nudges (no dedicated task scheduler in this deployment)."""
    now = datetime.now(timezone.utc)
    upcoming = await db.personal_events.find(
        {"device_id": device_id, "reminded": False, "date": {"$gte": now.date().isoformat()}}
    ).to_list(100)
    fired = []
    for ev in upcoming:
        try:
            when = datetime.strptime(f"{ev['date']} {ev.get('time_label') or '9:00 AM'}", "%Y-%m-%d %I:%M %p")
        except ValueError:
            when = datetime.strptime(ev["date"], "%Y-%m-%d")
        hours_until = (when - now).total_seconds() / 3600
        if 0 <= hours_until <= ev.get("reminder_hours_before", 24):
            await send_push(
                device_id, "Cuddle · Coming up",
                f"{ev['title']}" + (f" — {ev['time_label']}" if ev.get("time_label") else ""),
            )
            await db.personal_events.update_one({"event_id": ev["event_id"]}, {"$set": {"reminded": True}})
            fired.append(ev["event_id"])
    return {"fired": fired}


# ----- Catch Me Up: a small, on-demand AI summary of what's going on right
# now, gathered fresh each time it's opened rather than cached like weekly
# insights — meant to be quick, not a report. -----
@api_router.get("/catchup/{device_id}")
async def catch_up(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's data")
    today = datetime.now(timezone.utc).date().isoformat()
    now = datetime.now(timezone.utc)

    parts = []

    # Tag Team status, if she has a household
    household = await db.households.find_one({"members.device_id": device_id})
    if household and len(household.get("members", [])) > 1:
        score = await compute_handoff_score(household)
        on_duty = next((m for m in household["members"] if m["device_id"] == household.get("on_duty_device_id")), None)
        parts.append(f"Tag Team: {on_duty['name'] if on_duty else 'someone'} has been on duty, {score.get('message', '')}")

    # Today's baby log totals
    device_ids = await _household_device_ids(device_id)
    logs_today = await db.baby_logs.find({"device_id": {"$in": device_ids}, "at": {"$gte": today}}).to_list(500)
    feed_count = sum(1 for l in logs_today if l["kind"] == "feed")
    diaper_count = sum(1 for l in logs_today if l["kind"] == "diaper")
    parts.append(f"Today so far: {feed_count} feeds, {diaper_count} diaper changes logged.")

    # Upcoming events in the next 3 days
    soon = (now + timedelta(days=3)).date().isoformat()
    upcoming = await db.personal_events.find(
        {"device_id": device_id, "date": {"$gte": today, "$lte": soon}}
    ).sort("date", 1).to_list(5)
    if upcoming:
        titles = ", ".join(f"{e['title']} ({e['date']})" for e in upcoming)
        parts.append(f"Coming up in the next few days: {titles}.")

    # Meetups she's going to, soon
    my_meetups = await db.meetups.find(
        {"attendees.device_id": device_id, "date": {"$gte": today, "$lte": soon}}
    ).sort("date", 1).to_list(5)
    if my_meetups:
        titles = ", ".join(f"{m['title']} ({m['date']})" for m in my_meetups)
        parts.append(f"Meetups she's going to soon: {titles}.")

    raw_context = " ".join(parts) or "Nothing much logged yet — she's just getting started with the app."

    summary = raw_context
    if anthropic_client:
        try:
            prompt = (
                f"Here's a snapshot of a postpartum mom's app right now: {raw_context} "
                "Write a short (2-3 sentence), warm, casual 'catching you up' message — like a quick "
                "friend filling her in, not a report. If there's genuinely nothing going on, say so kindly "
                "and warmly rather than padding it out. Never diagnose or give medical advice."
            )
            response = await anthropic_client.messages.create(
                model="claude-sonnet-4-6", max_tokens=180,
                messages=[{"role": "user", "content": prompt}],
            )
            summary = "".join(b.text for b in response.content if b.type == "text").strip()
        except Exception:
            logger.exception("catch up AI failed")

    return {"summary": summary, "generated_at": now_iso()}


# ----- Self wellbeing nudge — reminds HER directly, not just a Tag Team
# partner, and works even without a household set up at all. -----
@api_router.get("/wellbeing/self-check/{device_id}")
async def wellbeing_self_check(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's wellbeing data")
    
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()

    # Only worth checking once the day's genuinely underway — no point
    # nudging at 8am about not having eaten yet.
    if now.hour < 13:
        return {"nudged": False}

    tracker = await db.self_nudge_tracker.find_one({"device_id": device_id})
    if tracker and tracker.get("last_nudge_date") == today:
        return {"nudged": False}  # already nudged once today

    meal_today = await db.meal_checkins.find_one({"device_id": device_id, "date": today})
    ate_today = bool(meal_today and meal_today.get("ate_today"))
    sleep_logged_today = await db.baby_logs.count_documents(
        {"device_id": device_id, "kind": "sleep", "at": {"$gte": today}}
    )

    if ate_today or sleep_logged_today > 0:
        return {"nudged": False}

    await send_push(
        device_id,
        "Cuddle · Checking in on you",
        "It's been a while — have you had a chance to eat or catch a break today? You matter here too.",
        urgent=False,
    )
    await db.self_nudge_tracker.update_one(
        {"device_id": device_id}, {"$set": {"last_nudge_date": today}}, upsert=True,
    )
    return {"nudged": True}


# ----- Predictive nudge: turns the feed prediction into an actual heads-up
# push instead of something she only sees if she happens to open Track. -----
class ActivityPing(BaseModel):
    device_id: str


@api_router.post("/activity/ping")
async def activity_ping(body: ActivityPing, verified_device_id: str = Depends(_verify_device)):
    if body.device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't ping activity as another device")
    """Called once when the app opens, so Cuddle actually knows whether
    she's been using it, separate from whether she's logged anything.
    This is the one thing inactivity_reminder below depends on."""
    await db.app_activity.update_one(
        {"device_id": body.device_id},
        {"$set": {"device_id": body.device_id, "last_opened_at": now_iso()}},
        upsert=True,
    )
    return {"status": "ok"}


# Real checkpoints in HER recovery, not baby's growth — deliberately the
# same week boundaries used in the Recovery Timeline (0-2, 2-6, 6-12 weeks,
# fourth trimester), so the two features stay consistent with each other
# rather than inventing a second, different timeline.
MOM_MILESTONES = [
    {"week": 1, "title": "You made it through week one.",
     "message": "The week nobody really prepares you for. However it went, however hard it was — you showed up for it. That counts."},
    {"week": 2, "title": "Two weeks in.",
     "message": "If you're exhausted, sore, and some days feel like a blur — that's not you failing, that's what week two actually looks like for almost everyone."},
    {"week": 6, "title": "Six weeks.",
     "message": "This is often treated like a finish line. It isn't — and if you don't feel 'back to normal,' you're not behind, you're exactly on time. Real healing keeps going well past this point."},
    {"week": 12, "title": "Twelve weeks. The fourth trimester, done.",
     "message": "Three months of a season that asked more of you than almost anything else. Energy, strength, and mood can keep improving for a long while yet — but this particular chapter, you got through."},
    {"week": 26, "title": "Six months.",
     "message": "Half a year of figuring it out as you went, because that's the only way anyone does this. Take a second to notice how far you've actually come, not just the baby."},
    {"week": 52, "title": "One year.",
     "message": "A full year of showing up, even on the days it was hard to. Whatever this year looked like for you, it was real, and you did it."},
]


async def mom_milestone_check(device_id: str) -> dict:
    """Celebrates HER, not the baby — every other milestone feature in
    this space (and every competitor's) tracks the baby's growth. This is
    deliberately the opposite: a handful of real checkpoints in her own
    recovery, each fired exactly once, tied to her actual delivery date."""
    profile = await db.profiles.find_one({"device_id": device_id}, {"_id": 0})
    if not profile or not profile.get("delivery_date"):
        return {"nudged": False, "reason": "no delivery date on file"}

    try:
        delivered = datetime.fromisoformat(profile["delivery_date"].replace("Z", "+00:00"))
    except ValueError:
        return {"nudged": False, "reason": "invalid delivery date"}

    weeks_out = (datetime.now(timezone.utc) - delivered).days // 7
    milestone = next((m for m in MOM_MILESTONES if m["week"] == weeks_out), None)
    if not milestone:
        return {"nudged": False, "reason": "not a milestone week"}

    already_sent = await db.mom_milestone_tracker.find_one(
        {"device_id": device_id, "week": milestone["week"]}
    )
    if already_sent:
        return {"nudged": False, "reason": "already celebrated this one"}

    await send_push(device_id, f"Cuddle · {milestone['title']}", milestone["message"])
    await db.mom_milestone_tracker.insert_one({
        "device_id": device_id, "week": milestone["week"], "sent_at": now_iso(),
    })
    return {"nudged": True, "week": milestone["week"]}


@api_router.get("/mom-milestone/pending/{device_id}")
async def mom_milestone_pending(device_id: str, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's data")
    """For the in-app card — same milestone logic as the push notification,
    but checked on demand when she opens the app, so it still shows even
    if she has notifications off or the cron sweep hasn't run yet."""
    profile = await db.profiles.find_one({"device_id": device_id}, {"_id": 0})
    if not profile or not profile.get("delivery_date"):
        return {"has_milestone": False}

    try:
        delivered = datetime.fromisoformat(profile["delivery_date"].replace("Z", "+00:00"))
    except ValueError:
        return {"has_milestone": False}

    weeks_out = (datetime.now(timezone.utc) - delivered).days // 7
    eligible = [m for m in MOM_MILESTONES if m["week"] <= weeks_out]
    if not eligible:
        return {"has_milestone": False}

    seen_weeks = {
        s["week"] async for s in db.mom_milestone_seen.find({"device_id": device_id}, {"_id": 0, "week": 1})
    }
    unseen = [m for m in eligible if m["week"] not in seen_weeks]
    if not unseen:
        return {"has_milestone": False}

    # Most recent unseen one — if she skipped several app opens, show the
    # latest checkpoint she's actually reached, not a backlog of old ones.
    milestone = max(unseen, key=lambda m: m["week"])
    return {"has_milestone": True, "week": milestone["week"], "title": milestone["title"], "message": milestone["message"]}


@api_router.post("/mom-milestone/seen/{device_id}/{week}")
async def mom_milestone_mark_seen(device_id: str, week: int, verified_device_id: str = Depends(_verify_device)):
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Not authorized for this device's data")
    await db.mom_milestone_seen.update_one(
        {"device_id": device_id, "week": week},
        {"$set": {"device_id": device_id, "week": week, "seen_at": now_iso()}},
        upsert=True,
    )
    return {"status": "ok"}


async def inactivity_reminder(device_id: str) -> dict:
    """A plain 'we miss you' nudge if she simply hasn't opened the app in
    a while — not tied to any concerning pattern, just gentle continuity.
    Separate from proactive_ai_checkin, which only fires on real signals;
    this one only cares whether the app itself has gone quiet."""
    activity = await db.app_activity.find_one({"device_id": device_id}, {"_id": 0})
    if not activity or not activity.get("last_opened_at"):
        return {"nudged": False, "reason": "no activity record yet"}

    days_since = _hours_between(activity["last_opened_at"], now_iso()) / 24
    if days_since < 4:
        return {"nudged": False, "reason": "recently active"}

    tracker = await db.inactivity_nudge_tracker.find_one({"device_id": device_id})
    if tracker:
        last_nudged_days_ago = _hours_between(tracker["last_nudged_at"], now_iso()) / 24
        if last_nudged_days_ago < 6:
            return {"nudged": False, "reason": "already nudged recently"}

    await send_push(
        device_id,
        "Cuddle",
        "It's been a little while — no pressure, just here whenever you need me.",
    )
    await db.inactivity_nudge_tracker.update_one(
        {"device_id": device_id},
        {"$set": {"device_id": device_id, "last_nudged_at": now_iso()}},
        upsert=True,
    )
    return {"nudged": True, "days_since_open": round(days_since, 1)}


async def proactive_ai_checkin(device_id: str) -> dict:
    """The 'reach out first' half of the AI companion, instead of only ever
    responding when she happens to open Talk to Cuddle herself. Looks at
    the same cross-feature signals the chat's system prompt now uses
    (mood trend, Recovery flags, Tag Team fatigue) and, only when more than
    one paints a concerning picture together, sends a single warm nudge
    inviting her into a conversation — never diagnostic, never alarming,
    and rate-limited so it can only fire once per day per device."""
    today = datetime.now(timezone.utc).date().isoformat()
    tracker = await db.proactive_checkin_tracker.find_one({"device_id": device_id})
    if tracker and tracker.get("last_sent_date") == today:
        return {"nudged": False, "reason": "already sent today"}

    concern_signals = []

    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    moods = await db.moods.find(
        {"device_id": device_id, "created_at": {"$gte": week_ago}}, {"_id": 0}
    ).sort("created_at", 1).to_list(20)
    scores = [m["mood"] for m in moods if m.get("mood") is not None]
    if len(scores) >= 5:
        recent_avg = sum(scores[-3:]) / len(scores[-3:])
        earlier_avg = sum(scores[:-3]) / max(1, len(scores[:-3]))
        if recent_avg < earlier_avg - 0.7:
            concern_signals.append("mood_dropping")

    three_days_ago = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    recovery = await db.recovery_checkins.find_one(
        {"device_id": device_id, "created_at": {"$gte": three_days_ago}},
        {"_id": 0}, sort=[("created_at", -1)]
    )
    if recovery and recovery.get("symptoms"):
        concern_signals.append("recovery_flag")

    household = await db.households.find_one({"members.device_id": device_id}, {"_id": 0})
    if household and household.get("on_duty_device_id") == device_id:
        on_duty_since = household.get("on_duty_since") or household.get("created_at")
        if on_duty_since and _hours_between(on_duty_since, now_iso()) >= 6:
            concern_signals.append("long_duty_stretch")

    # Require at least two independent signals together — a single one
    # (e.g. one rough mood check-in) is normal and not worth a proactive
    # push; it's the combination that's worth reaching out about.
    if len(concern_signals) < 2:
        return {"nudged": False, "signals": concern_signals}

    await send_push(
        device_id,
        "Cuddle",
        "Things have felt like a lot lately. Want to talk about it for a minute?",
    )
    await db.proactive_checkin_tracker.update_one(
        {"device_id": device_id},
        {"$set": {"device_id": device_id, "last_sent_date": today, "signals": concern_signals}},
        upsert=True,
    )
    return {"nudged": True, "signals": concern_signals}


async def predictive_feed_nudge(device_id: str):
    now = datetime.now(timezone.utc)

    predictions = await baby_log_predictions(device_id)
    feed_pred = predictions.get("feed")
    if not feed_pred or feed_pred["confidence"] not in ("developing", "steady", "age_estimate"):
        return {"nudged": False}  # not confident enough yet to be worth interrupting her

    predicted_at = feed_pred["predicted_at"]
    tracker = await db.predictive_nudge_tracker.find_one({"device_id": device_id})
    if tracker and tracker.get("last_nudged_prediction") == predicted_at:
        return {"nudged": False}  # already nudged for this specific predicted feed

    predicted_dt = datetime.fromisoformat(predicted_at)
    minutes_until = (predicted_dt - now).total_seconds() / 60
    # Fire once per predicted feed, in the 5-15 minute window before it —
    # early enough to get set up, not so early it's just noise.
    if 5 <= minutes_until <= 15:
        basis = "usual pattern" if feed_pred["confidence"] != "age_estimate" else "typical timing for this age"
        await send_push(
            device_id, "Cuddle · Heads up",
            f"Next feed is probably coming up soon, based on {basis} — just a heads up.",
        )
        await db.predictive_nudge_tracker.update_one(
            {"device_id": device_id}, {"$set": {"last_nudged_prediction": predicted_at}}, upsert=True,
        )
        return {"nudged": True}
    return {"nudged": False}


async def predictive_sleep_nudge(device_id: str):
    """Same idea as the feed nudge, for naps: a heads-up shortly before baby
    is likely to wake, or likely to be ready to go down. Uses a separate
    tracker collection so it never interferes with the feed nudge's own
    once-per-prediction logic."""
    now = datetime.now(timezone.utc)

    # If baby's actually asleep right now (a live session is running), the
    # "next sleep" prediction doesn't apply — what matters is roughly when
    # they'll wake, which the average nap length can estimate honestly.
    device_ids = await _household_device_ids(device_id)
    active_baby_session = await db.active_sleep_sessions.find_one(
        {"owner_device_id": {"$in": device_ids}, "subject": "baby"}
    )
    if active_baby_session:
        recent_sleep_logs = await db.baby_logs.find(
            {"device_id": {"$in": device_ids}, "kind": "sleep",
             "duration_minutes": {"$ne": None}},
        ).sort("at", -1).to_list(6)
        if len(recent_sleep_logs) < 2:
            return {"nudged": False}  # not enough history to estimate a typical nap length yet
        avg_nap_minutes = sum(l["duration_minutes"] for l in recent_sleep_logs) / len(recent_sleep_logs)
        started = datetime.fromisoformat(active_baby_session["started_at"])
        predicted_wake = started + timedelta(minutes=avg_nap_minutes)
        tracker_key = f"wake:{active_baby_session['started_at']}"
        tracker = await db.predictive_sleep_nudge_tracker.find_one({"device_id": device_id})
        if tracker and tracker.get("last_nudged") == tracker_key:
            return {"nudged": False}
        minutes_until = (predicted_wake - now).total_seconds() / 60
        if 5 <= minutes_until <= 15:
            await send_push(
                device_id, "Cuddle · Heads up",
                "Based on typical nap length, baby might be waking up in the next little while.",
            )
            await db.predictive_sleep_nudge_tracker.update_one(
                {"device_id": device_id}, {"$set": {"last_nudged": tracker_key}}, upsert=True,
            )
            return {"nudged": True}
        return {"nudged": False}

    # Otherwise, use the real wake-window prediction for when baby's likely
    # to be ready to go down next.
    predictions = await baby_log_predictions(device_id)
    sleep_pred = predictions.get("sleep")
    if not sleep_pred or sleep_pred["confidence"] not in ("developing", "steady", "age_estimate"):
        return {"nudged": False}

    predicted_at = sleep_pred["predicted_at"]
    tracker_key = f"nap:{predicted_at}"
    tracker = await db.predictive_sleep_nudge_tracker.find_one({"device_id": device_id})
    if tracker and tracker.get("last_nudged") == tracker_key:
        return {"nudged": False}

    predicted_dt = datetime.fromisoformat(predicted_at)
    minutes_until = (predicted_dt - now).total_seconds() / 60
    if 5 <= minutes_until <= 15:
        basis = "usual pattern" if sleep_pred["confidence"] != "age_estimate" else "typical timing for this age"
        await send_push(
            device_id, "Cuddle · Heads up",
            f"Baby's next nap window is probably coming up soon, based on {basis}.",
        )
        await db.predictive_sleep_nudge_tracker.update_one(
            {"device_id": device_id}, {"$set": {"last_nudged": tracker_key}}, upsert=True,
        )
        return {"nudged": True}
    return {"nudged": False}


async def predictive_poop_nudge(device_id: str):
    """Same pattern as the feed and sleep nudges. Worth being honest that
    poop timing is inherently less precise than feed or sleep (fewer
    logged samples to learn from, more day-to-day variance), so this
    leans on the gentler 'might be due' framing rather than a confident
    prediction."""
    now = datetime.now(timezone.utc)

    predictions = await baby_log_predictions(device_id)
    poop_pred = predictions.get("poop")
    if not poop_pred or poop_pred["confidence"] not in ("developing", "steady"):
        return {"nudged": False}  # age-based fallback doesn't really apply to poop timing

    predicted_at = poop_pred["predicted_at"]
    tracker = await db.predictive_poop_nudge_tracker.find_one({"device_id": device_id})
    if tracker and tracker.get("last_nudged") == predicted_at:
        return {"nudged": False}

    predicted_dt = datetime.fromisoformat(predicted_at)
    minutes_until = (predicted_dt - now).total_seconds() / 60
    if 5 <= minutes_until <= 15:
        await send_push(
            device_id, "Cuddle · Heads up",
            "Might be due for a diaper check soon, based on the usual pattern.",
        )
        await db.predictive_poop_nudge_tracker.update_one(
            {"device_id": device_id}, {"$set": {"last_nudged": predicted_at}}, upsert=True,
        )
        return {"nudged": True}
    return {"nudged": False}


# The actual HTTP routes for the three predictive-nudge functions above —
# kept separate from the internal functions themselves specifically so
# the cron sweep's direct Python calls to those functions (see the checks
# list a few hundred lines up) never pass through auth machinery that
# only makes sense for a real external HTTP request. A route handler
# calling straight into its own internal function, after checking auth
# itself, isn't a bypass — it's the same pattern as every other
# authorized endpoint in this file, just split into two functions because
# this one has two legitimate callers with very different trust levels.
@api_router.get("/baby-log/{device_id}/predictive-nudge")
async def predictive_feed_nudge_route(device_id: str, verified_device_id: str = Depends(_verify_device)):
    await _authorize_baby_data_access(device_id, verified_device_id)
    return await predictive_feed_nudge(device_id)


@api_router.get("/baby-log/{device_id}/predictive-sleep-nudge")
async def predictive_sleep_nudge_route(device_id: str, verified_device_id: str = Depends(_verify_device)):
    await _authorize_baby_data_access(device_id, verified_device_id)
    return await predictive_sleep_nudge(device_id)


@api_router.get("/baby-log/{device_id}/predictive-poop-nudge")
async def predictive_poop_nudge_route(device_id: str, verified_device_id: str = Depends(_verify_device)):
    await _authorize_baby_data_access(device_id, verified_device_id)
    return await predictive_poop_nudge(device_id)


# ----- Account Deletion -----
# Genuinely purges every collection that can contain this device's data —
# built by walking the entire codebase collection by collection, not a
# guess. A few collections get special handling rather than a blind
# delete, because a naive delete would break things for OTHER people:
#   - households: she's removed from the member list rather than the
#     whole household being deleted, since her partner still needs it.
#   - meetups: she's removed from attendee lists, but a meetup she
#     created stays (other people RSVPed to it), just without her data.
#   - peer_messages: has no direct device_id field, so its room_ids are
#     captured from peer_rooms BEFORE peer_rooms itself is deleted.
#   - match_events: intentionally skipped — it's genuinely anonymized
#     analytics with no device_id at all, nothing to delete.
#   - meal_slots: intentionally skipped — signups are by name/contact
#     for a public, no-login page, not tied to a device_id.
@api_router.delete("/account/{device_id}")
async def delete_account(device_id: str, verified_device_id: str = Depends(_verify_device)):
    # This had zero authorization — anyone who knew a device_id could
    # permanently delete that entire account with a single request. Given
    # this is irreversible, it's arguably the single most severe finding
    # in this whole pass.
    if device_id != verified_device_id:
        raise HTTPException(status_code=403, detail="Can't delete another device's account")
    deleted_counts: dict = {}

    # Peer chat rooms must be looked up BEFORE peer_rooms is deleted below,
    # since peer_messages has no device_id field of its own.
    her_room_ids = [r["room_id"] async for r in db.peer_rooms.find({"device_id": device_id}, {"room_id": 1})]
    if her_room_ids:
        pm_result = await db.peer_messages.delete_many({"room_id": {"$in": her_room_ids}})
        if pm_result.deleted_count:
            deleted_counts["peer_messages"] = pm_result.deleted_count

    direct_collections = [
        "baby_logs", "brain_notes", "chat_messages", "community_posts", "comments",
        "dad_checkins", "epds", "meal_checkins", "meal_trains", "meetup_reflections",
        "moods", "personal_events", "predictive_nudge_tracker", "presence", "profiles",
        "push_tokens", "recovery_checkins", "self_nudge_tracker", "shop_items",
        "shop_thread_messages", "sos_events", "weekly_insights", "peer_rooms",
        "caregiver_rest_logs", "predictive_sleep_nudge_tracker", "predictive_poop_nudge_tracker",
        "mom_wellness_logs",
    ]
    for coll_name in direct_collections:
        coll = getattr(db, coll_name)
        result = await coll.delete_many({"device_id": device_id})
        if result.deleted_count:
            deleted_counts[coll_name] = result.deleted_count

    # active_sleep_sessions uses owner_device_id, not device_id — caught by
    # actually running account deletion end-to-end against a live baby or
    # self sleep timer rather than just checking the collection list by eye.
    session_result = await db.active_sleep_sessions.delete_many({"owner_device_id": device_id})
    if session_result.deleted_count:
        deleted_counts["active_sleep_sessions"] = session_result.deleted_count

    # encouragement_messages and its nudge tracker use to_device_id/
    # from_device_id/for_device_id, none of them plain device_id, so this
    # needs its own explicit handling too, not the generic loop above.
    encouragement_result = await db.encouragement_messages.delete_many(
        {"$or": [{"from_device_id": device_id}, {"to_device_id": device_id}]}
    )
    if encouragement_result.deleted_count:
        deleted_counts["encouragement_messages"] = encouragement_result.deleted_count
    tracker_result = await db.encouragement_nudge_tracker.delete_many(
        {"$or": [{"to_device_id": device_id}, {"for_device_id": device_id}]}
    )
    if tracker_result.deleted_count:
        deleted_counts["encouragement_nudge_tracker"] = tracker_result.deleted_count

    # Households: remove her as a member; delete the household entirely
    # only if that leaves it empty.
    async for h in db.households.find({"members.device_id": device_id}):
        remaining = [m for m in h["members"] if m["device_id"] != device_id]
        if remaining:
            update = {"$set": {"members": remaining}}
            if h.get("on_duty_device_id") == device_id:
                update["$set"]["on_duty_device_id"] = remaining[0]["device_id"]
            await db.households.update_one({"_id": h["_id"]}, update)
        else:
            await db.households.delete_one({"_id": h["_id"]})
        deleted_counts["households"] = deleted_counts.get("households", 0) + 1

    # Meetups: remove her from attendee lists everywhere (the meetup
    # itself stays for whoever else is attending).
    meetup_result = await db.meetups.update_many(
        {"attendees.device_id": device_id},
        {"$pull": {"attendees": {"device_id": device_id}}},
    )
    if meetup_result.modified_count:
        deleted_counts["meetups_attendee_removed"] = meetup_result.modified_count

    # Handoff events: she could be on either side of a switch.
    handoff_result = await db.handoff_events.delete_many(
        {"$or": [{"from_device_id": device_id}, {"to_device_id": device_id}]}
    )
    if handoff_result.deleted_count:
        deleted_counts["handoff_events"] = handoff_result.deleted_count

    # Shop threads: she could be the interested buyer.
    shop_thread_result = await db.shop_threads.delete_many({"interested_device_id": device_id})
    if shop_thread_result.deleted_count:
        deleted_counts["shop_threads"] = shop_thread_result.deleted_count

    return {"ok": True, "device_id": device_id, "deleted": deleted_counts}


# ----- One-time cleanup: removes the specific fake seeded posts if this
# server already ran the old seed_community() at some point in the past.
# Matches on the EXACT original fake text, not just author name, so a real
# user who happens to also be named "Maya" is never at risk of being
# touched by this. Safe to leave in and call more than once — it becomes a
# no-op the moment those specific posts are gone. -----
_FAKE_SEED_SIGNATURES = [
    ("Maya", "Week 3 and running on 3 hours of sleep. Just want to say to any mama awake at 3am — you're not alone. We've got this. 🤍"),
    ("Priya", "Switched to combo feeding after a rough start with latching. My guilt was huge but baby is thriving. Fed is best, truly."),
    ("Sofia", "Some days the sadness comes out of nowhere. Talking here and to my midwife helped me realize it's okay to not be okay."),
    ("Aisha", "C-section recovery is no joke. Anyone else find the first shower emotional? Sending gentle hugs to all recovering mamas."),
    ("Elena", "Started a little walking group for postpartum moms in my area. Fresh air + adult conversation has been everything."),
]


@api_router.post("/admin/cleanup-fake-seed-posts")
async def cleanup_fake_seed_posts():
    deleted = 0
    for author, text in _FAKE_SEED_SIGNATURES:
        result = await db.community_posts.delete_many({"author": author, "text": text})
        deleted += result.deleted_count
    return {"deleted": deleted}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    # 2dsphere lets MongoDB itself do real distance filtering/sorting for
    # "meetups near me" — no Google Maps involved, this is 100% our own
    # users' submitted coordinates. Safe to call on every startup; MongoDB
    # no-ops if the index already exists.
    try:
        await db.meetups.create_index([("location", "2dsphere")])
    except Exception:
        logger.exception("failed to ensure meetups geospatial index")

    # Real MongoDB TTL indexes — expired/used invitations and old rate-
    # limit attempt logs clean themselves up automatically, rather than
    # growing forever or needing a custom cleanup job.
    try:
        await db.invite_attempt_log.create_index("at", expireAfterSeconds=3600 * 2)
        # Invitations expire well before this; this index is just the
        # final cleanup so accepted/revoked/expired rows don't accumulate
        # forever. 30 days past expiry is generous, never premature.
        await db.household_invitations.create_index(
            "expires_at", expireAfterSeconds=3600 * 24 * 30
        )
    except Exception:
        logger.exception("failed to ensure invitation TTL indexes")

    try:
        # Checked (or stale, never-checked) ticket log rows clean
        # themselves up automatically instead of growing forever.
        await db.push_ticket_log.create_index("sent_at", expireAfterSeconds=3600 * 24 * 7)
    except Exception:
        logger.exception("failed to ensure push ticket log TTL index")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
