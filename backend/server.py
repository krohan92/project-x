from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
from pathlib import Path
from pydantic import BaseModel, Field, BeforeValidator
from typing import List, Optional, Annotated, Any
from bson import ObjectId
import uuid
import random
import math
from datetime import datetime, timezone, date, timedelta

import anthropic
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY')
anthropic_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

app = FastAPI()
api_router = APIRouter(prefix="/api")

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
    created_at: str = Field(default_factory=now_iso)


class MoodEntry(BaseModel):
    device_id: str
    mood: int                                     # 1 (low) - 5 (great)
    energy: Optional[int] = None                  # 1-5
    sleep_hours: Optional[float] = None
    note: Optional[str] = None
    tags: List[str] = []
    created_at: str = Field(default_factory=now_iso)


class MoodEntryCreate(BaseModel):
    device_id: str
    mood: int
    energy: Optional[int] = None
    sleep_hours: Optional[float] = None
    note: Optional[str] = None
    tags: List[str] = []


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
    {"text": "You are not the same as you were before, and that is okay. You are becoming.", "author": "Cuddle"},
    {"text": "Being a mother is learning about strengths you didn't know you had.", "author": "Linda Wooten"},
    {"text": "You don't have to be perfect to be an amazing mom.", "author": "Cuddle"},
    {"text": "Rest is not a reward for finishing. It is fuel for continuing.", "author": "Cuddle"},
    {"text": "The days are long, but the years are short. Be gentle with today.", "author": "Cuddle"},
    {"text": "You are doing a beautiful job, even on the days it doesn't feel like it.", "author": "Cuddle"},
    {"text": "Your baby doesn't need a perfect mother. They need a present one — and you are here.", "author": "Cuddle"},
    {"text": "Healing is not linear. Some days will feel heavier, and that's part of it.", "author": "Cuddle"},
    {"text": "You can love this life and still find parts of it incredibly hard. Both are true.", "author": "Cuddle"},
    {"text": "Asking for help is not giving up. It's how you keep going.", "author": "Cuddle"},
    {"text": "Small moments count. A held gaze, a soft word — you're building something real.", "author": "Cuddle"},
    {"text": "You get to have needs too. Meeting them isn't selfish, it's sustainable.", "author": "Cuddle"},
    {"text": "Some days survival is the whole job, and that's still doing it well.", "author": "Cuddle"},
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
# Seeding
# ---------------------------------------------------------------------------
async def seed_community():
    count = await db.community_posts.count_documents({})
    if count > 0:
        return
    seed = [
        {"author": "Maya", "avatar_color": "#D68C7A", "location": "2 mi away", "topic": "Sleep",
         "text": "Week 3 and running on 3 hours of sleep. Just want to say to any mama awake at 3am — you're not alone. We've got this. 🤍", "likes": 24},
        {"author": "Priya", "avatar_color": "#98A99B", "location": "5 mi away", "topic": "Feeding",
         "text": "Switched to combo feeding after a rough start with latching. My guilt was huge but baby is thriving. Fed is best, truly.", "likes": 41},
        {"author": "Sofia", "avatar_color": "#E2C8B5", "location": "1 mi away", "topic": "Mental health",
         "text": "Some days the sadness comes out of nowhere. Talking here and to my midwife helped me realize it's okay to not be okay.", "likes": 33},
        {"author": "Aisha", "avatar_color": "#DEB068", "location": "3 mi away", "topic": "Recovery",
         "text": "C-section recovery is no joke. Anyone else find the first shower emotional? Sending gentle hugs to all recovering mamas.", "likes": 18},
        {"author": "Elena", "avatar_color": "#8CA8B0", "location": "4 mi away", "topic": "Support",
         "text": "Started a little walking group for postpartum moms in my area. Fresh air + adult conversation has been everything.", "likes": 52},
    ]
    for s in seed:
        s["created_at"] = now_iso()
    await db.community_posts.insert_many(seed)
    logger.info("Seeded community posts")


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
# Routes
# ---------------------------------------------------------------------------
@api_router.get("/")
async def root():
    return {"message": "Cuddle Postpartum API"}


@api_router.post("/profile")
async def upsert_profile(profile: Profile):
    data = profile.model_dump()
    await db.profiles.update_one({"device_id": profile.device_id}, {"$set": data}, upsert=True)
    return data


@api_router.get("/profile/{device_id}")
async def get_profile(device_id: str):
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


@api_router.get("/pump-providers")
async def get_pump_providers():
    return PUMP_PROVIDERS


# ----- Mood -----
@api_router.post("/mood")
async def add_mood(entry: MoodEntryCreate):
    obj = MoodEntry(**entry.model_dump())
    await db.moods.insert_one(obj.model_dump())
    return obj.model_dump()


@api_router.get("/mood/{device_id}")
async def get_moods(device_id: str, limit: int = 60):
    docs = await db.moods.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return list(reversed(docs))


@api_router.get("/mood/{device_id}/today")
async def mood_today(device_id: str):
    today = datetime.now(timezone.utc).date().isoformat()
    doc = await db.moods.find_one(
        {"device_id": device_id, "created_at": {"$regex": f"^{today}"}}, {"_id": 0})
    return {"done": doc is not None, "entry": doc}


# ----- EPDS -----
@api_router.get("/epds/questions")
async def epds_questions():
    return EPDS_QUESTIONS


@api_router.post("/epds")
async def submit_epds(sub: EpdsSubmit):
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
async def epds_history(device_id: str):
    docs = await db.epds.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return docs


# ----- Chat (Claude Sonnet 4.6) -----
@api_router.get("/chat/{session_id}")
async def chat_history(session_id: str):
    docs = await db.chat_messages.find({"session_id": session_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
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
        "description": "Log a completed nap. Use when she mentions the baby slept or napped for some length of time.",
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
    """A short, factual summary of her last few days — for grounding
    'what should I do' type answers in what she's actually logged, not
    guessing. This reflects her own self-reported data back to her; it
    never labels or diagnoses a mental state."""
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    moods = await db.moods.find(
        {"device_id": device_id, "created_at": {"$gte": week_ago}}, {"_id": 0}
    ).sort("created_at", 1).to_list(20)
    if not moods:
        return ""
    scores = [m["mood"] for m in moods if m.get("mood") is not None]
    if not scores:
        return ""
    recent_avg = sum(scores[-3:]) / len(scores[-3:])
    trend = ""
    if len(scores) >= 5:
        earlier_avg = sum(scores[:-3]) / max(1, len(scores[:-3]))
        if recent_avg < earlier_avg - 0.7:
            trend = ", trending lower than earlier this week"
        elif recent_avg > earlier_avg + 0.7:
            trend = ", trending better than earlier this week"
    return f"Her self-reported mood over the last few check-ins has averaged about {recent_avg:.1f}/5{trend}."


@api_router.post("/chat")
async def chat(req: ChatRequest):
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

# Simulated concurrent "active" peers for the presence map + matching demo.
# NOTE: these are DEMO peers so the map/matching feel alive in preview; real
# two-way presence appears when multiple real users are online at once.
MOCK_PEERS = [
    {"id": "peer_dawn", "handle": "QuietDawn", "ethnicity": "South Asian / Indian", "allow_cultural_match": True, "display_tags": True, "dlat": 0.06, "dlng": -0.09, "mins": 4},
    {"id": "peer_moon", "handle": "MoonlitMama", "ethnicity": "Latina / Hispanic", "allow_cultural_match": True, "display_tags": False, "dlat": -0.11, "dlng": 0.07, "mins": 12},
    {"id": "peer_tide", "handle": "GentleTide", "ethnicity": None, "allow_cultural_match": True, "display_tags": False, "dlat": 0.09, "dlng": 0.12, "mins": 2},
    {"id": "peer_ember", "handle": "SoftEmber", "ethnicity": "Black / African", "allow_cultural_match": True, "display_tags": True, "dlat": -0.07, "dlng": -0.13, "mins": 21},
    {"id": "peer_lotus", "handle": "NightLotus", "ethnicity": "South Asian / Indian", "allow_cultural_match": True, "display_tags": False, "dlat": 0.13, "dlng": -0.05, "mins": 7},
    {"id": "peer_willow", "handle": "WillowRest", "ethnicity": "East Asian", "allow_cultural_match": True, "display_tags": False, "dlat": -0.05, "dlng": 0.10, "mins": 15},
    {"id": "peer_sol", "handle": "SolMadre", "ethnicity": "Latina / Hispanic", "allow_cultural_match": False, "display_tags": False, "dlat": 0.03, "dlng": 0.14, "mins": 33},
    {"id": "peer_star", "handle": "StillStar", "ethnicity": None, "allow_cultural_match": True, "display_tags": False, "dlat": -0.12, "dlng": -0.04, "mins": 9},
]

PEER_REPLIES = [
    "I hear you. The nights are so long, aren't they? You're not alone in this. 🤍",
    "That sounds really hard. Thank you for trusting me with it.",
    "I'm awake too, feeding right now. We've got each other tonight.",
    "You're doing so much better than you think. Be gentle with yourself.",
    "Sending you a big virtual hug. What helps you feel even a little calmer?",
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


class MatchRequest(BaseModel):
    device_id: str


class PeerMessageCreate(BaseModel):
    device_id: str
    text: str


class BabyLogCreate(BaseModel):
    device_id: str
    kind: str            # feed / sleep / diaper
    detail: Optional[str] = None
    amount_ml: Optional[float] = None       # feed quantity, stored canonically in ml
    diaper_type: Optional[str] = None       # pee / poop / both
    duration_minutes: Optional[int] = None  # sleep length, if known
    at: Optional[str] = None                # backdate a log to when it actually happened


class SpaceAction(BaseModel):
    device_id: str
    space: str


# ----- Caregiver hand-off ("Tag Out") -----
class HouseholdCreate(BaseModel):
    device_id: str
    name: str
    role: str = "primary"          # primary / partner / caregiver


class HouseholdJoin(BaseModel):
    device_id: str
    household_code: str
    name: str
    role: str = "partner"


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
    note: Optional[str] = None


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
async def create_brain_note(n: BrainNoteCreate):
    doc = {
        "device_id": n.device_id, "text": n.text, "category": n.category or "other",
        "done": False, "created_at": now_iso(),
    }
    res = await db.brain_notes.insert_one(dict(doc))
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)
    return doc


@api_router.get("/brain-notes/{device_id}")
async def list_brain_notes(device_id: str, include_done: bool = False):
    query: dict = {"device_id": device_id}
    if not include_done:
        query["done"] = False
    docs = await db.brain_notes.find(query).sort("created_at", -1).to_list(200)
    for d in docs:
        d["id"] = str(d.pop("_id"))
    return docs


@api_router.patch("/brain-notes/{note_id}/done")
async def complete_brain_note(note_id: str):
    await db.brain_notes.update_one({"_id": ObjectId(note_id)}, {"$set": {"done": True}})
    return {"ok": True}


@api_router.delete("/brain-notes/{note_id}")
async def delete_brain_note(note_id: str):
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


# ----- Nearby settings / profile extension -----
@api_router.get("/nearby/meta")
async def nearby_meta():
    return {"ethnicity_tags": ETHNICITY_TAGS, "cultural_spaces": CULTURAL_SPACES}


@api_router.patch("/nearby/settings")
async def update_nearby_settings(s: NearbySettings):
    update = {k: v for k, v in s.model_dump().items() if k != "device_id" and v is not None}
    if update:
        await db.profiles.update_one({"device_id": s.device_id}, {"$set": update}, upsert=True)
    doc = await db.profiles.find_one({"device_id": s.device_id}, {"_id": 0})
    return doc or {}


@api_router.delete("/nearby/ethnicity/{device_id}")
async def delete_ethnicity(device_id: str):
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
async def presence_toggle(p: PresenceToggle):
    doc = {"device_id": p.device_id, "awake": p.awake, "last_active": now_iso()}
    if p.awake and p.lat is not None and p.lng is not None:
        # jitter immediately; store ONLY the randomized location, discard raw.
        jlat, jlng = jitter_coords(p.lat, p.lng)
        doc["lat"] = jlat
        doc["lng"] = jlng
    await db.presence.update_one({"device_id": p.device_id}, {"$set": doc}, upsert=True)
    return {"awake": p.awake}


@api_router.get("/presence/active")
async def presence_active(device_id: str):
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    # real active peers (anonymized, jittered coords only)
    reals = await db.presence.find(
        {"awake": True, "last_active": {"$gte": cutoff}, "device_id": {"$ne": device_id}}
    ).to_list(100)
    pins = []
    for r in reals:
        if r.get("lat") is not None:
            pins.append({"id": r["device_id"][:8], "lat": r["lat"], "lng": r["lng"], "mins": 0})

    # anchor mock peers around requester's stored (already jittered) location
    me = await db.presence.find_one({"device_id": device_id})
    anchor_lat = me.get("lat") if me and me.get("lat") is not None else 40.7128
    anchor_lng = me.get("lng") if me and me.get("lng") is not None else -74.0060
    for mp in MOCK_PEERS:
        pins.append({
            "id": mp["id"], "handle": mp["handle"],
            "lat": round(anchor_lat + mp["dlat"], 5),
            "lng": round(anchor_lng + mp["dlng"], 5),
            "mins": mp["mins"],
        })
    return {"count": len(pins), "pins": pins,
            "anchor": {"lat": anchor_lat, "lng": anchor_lng}}


# ----- Smart peer matching (modular) -----
def _select_peer(profile: dict):
    """Returns (peer, outcome). Modular so the algorithm can be swapped later."""
    pref = (profile or {}).get("matching_preference", "none")
    my_tag = (profile or {}).get("ethnicity")
    pool = list(MOCK_PEERS)
    random.shuffle(pool)

    if pref == "similar" and my_tag:
        for p in pool:
            if p["ethnicity"] == my_tag and p["allow_cultural_match"]:
                return p, "matched-on-preference"
    if pref == "diverse" and my_tag:
        for p in pool:
            if p["ethnicity"] and p["ethnicity"] != my_tag:
                return p, "matched-on-diversity"
    # fallback: any available active peer
    return pool[0], "fallback"


@api_router.post("/match/request")
async def match_request(req: MatchRequest):
    profile = await db.profiles.find_one({"device_id": req.device_id}, {"_id": 0}) or {}
    peer, outcome = _select_peer(profile)

    # tags only revealed if BOTH sides opted to display them
    both_display = bool(profile.get("display_tags")) and bool(peer.get("display_tags"))
    room_id = str(uuid.uuid4())
    room = {
        "room_id": room_id,
        "device_id": req.device_id,
        "peer_id": peer["id"],
        "peer_handle": peer["handle"],
        "peer_tag": peer["ethnicity"] if both_display else None,
        "outcome": outcome,
        "is_demo": True,
        "created_at": now_iso(),
    }
    await db.peer_rooms.insert_one(room)
    # opening message from peer
    await db.peer_messages.insert_one({
        "room_id": room_id, "sender": "peer", "handle": peer["handle"],
        "text": "Hi, I'm here with you. Couldn't sleep either — want to talk?",
        "created_at": now_iso(),
    })
    # anonymized analytics event
    await db.match_events.insert_one({
        "outcome": outcome,
        "preference": profile.get("matching_preference", "none"),
        "had_tag": bool(profile.get("ethnicity")),
        "created_at": now_iso(),
    })
    return {"room_id": room_id, "peer_handle": peer["handle"],
            "peer_tag": room["peer_tag"], "outcome": outcome}


@api_router.get("/match/analytics")
async def match_analytics():
    total = await db.match_events.count_documents({})
    on_pref = await db.match_events.count_documents({"outcome": "matched-on-preference"})
    fallback = await db.match_events.count_documents({"outcome": "fallback"})
    diverse = await db.match_events.count_documents({"outcome": "matched-on-diversity"})
    return {"total": total, "matched_on_preference": on_pref,
            "fallback": fallback, "matched_on_diversity": diverse}


# ----- Peer chat (polling) -----
@api_router.get("/peerchat/{room_id}")
async def peerchat_get(room_id: str):
    room = await db.peer_rooms.find_one({"room_id": room_id}, {"_id": 0})
    msgs = await db.peer_messages.find({"room_id": room_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return {"room": room, "messages": msgs}


@api_router.post("/peerchat/{room_id}")
async def peerchat_send(room_id: str, m: PeerMessageCreate):
    room = await db.peer_rooms.find_one({"room_id": room_id})
    await db.peer_messages.insert_one({
        "room_id": room_id, "sender": "me", "handle": "You",
        "text": m.text, "created_at": now_iso(),
    })
    # demo peer gently responds so the conversation feels alive
    if room and room.get("is_demo"):
        reply = random.choice(PEER_REPLIES)
        await db.peer_messages.insert_one({
            "room_id": room_id, "sender": "peer",
            "handle": room.get("peer_handle", "Peer"),
            "text": reply, "created_at": now_iso(),
        })
    return {"ok": True}


# ----- Baby tracker -----
@api_router.post("/baby-log")
async def baby_log(b: BabyLogCreate):
    doc = {
        "device_id": b.device_id,
        "kind": b.kind,
        "detail": b.detail,
        "amount_ml": b.amount_ml,
        "diaper_type": b.diaper_type,
        "duration_minutes": b.duration_minutes,
        "at": b.at or now_iso(),
        "logged_at": now_iso(),  # when it was actually entered, distinct from when it happened
    }
    await db.baby_logs.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/baby-log/{device_id}")
async def baby_logs(device_id: str, limit: int = 50):
    docs = await db.baby_logs.find({"device_id": device_id}, {"_id": 0}).sort("at", -1).to_list(limit)
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


@api_router.get("/baby-log/{device_id}/summary")
async def baby_log_summary(device_id: str):
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

    return {
        "date": today,
        "feed_count": len(feed_logs),
        "feed_total_ml": round(total_ml, 1),
        "feed_total_oz": _ml_to_oz(total_ml),
        "pee_count": pee_count,
        "poop_count": poop_count,
        "sleep_count": len(sleep_logs),
        "sleep_total_minutes": sleep_minutes,
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


@api_router.get("/baby-log/{device_id}/predictions")
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
    }


PLAYFUL_BALANCE_LINES = [
    "{leader} has logged {pct}% of today's baby duties — {other}, the tag-team jersey is right there 👕",
    "{leader}'s on a bit of a streak today ({pct}% of the logs) — {other}, MVP substitution opportunity available",
    "Scoreboard check: {leader} {pct}%, {other} — your turn to rack up some points 😄",
]


@api_router.get("/handoff/balance/{household_code}")
async def handoff_balance(household_code: str):
    """A light, funny nudge about today's workload split — deliberately the
    one playful voice in an otherwise gentle app, since a little humor here
    lands better than more heavy language about who's 'behind'."""
    h = await _get_household(household_code)
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
            await client.post(EXPO_PUSH_URL, json=payload)
    except Exception:
        logger.exception("push send failed")


@api_router.post("/push/register")
async def register_push_token(p: PushRegister):
    await db.push_tokens.update_one(
        {"device_id": p.device_id},
        {"$set": {"device_id": p.device_id, "expo_push_token": p.expo_push_token, "updated_at": now_iso()}},
        upsert=True,
    )
    return {"ok": True}


def _make_household_code() -> str:
    return uuid.uuid4().hex[:6].upper()


async def _get_household(code: str):
    h = await db.households.find_one({"household_code": code}, {"_id": 0})
    if not h:
        raise HTTPException(status_code=404, detail="Household not found")
    return h


@api_router.post("/household")
async def create_household(h: HouseholdCreate):
    code = _make_household_code()
    doc = {
        "household_code": code,
        "members": [{"device_id": h.device_id, "name": h.name, "role": h.role}],
        "on_duty_device_id": h.device_id,
        "on_duty_since": now_iso(),
        "created_at": now_iso(),
    }
    await db.households.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api_router.post("/household/join")
async def join_household(j: HouseholdJoin):
    h = await _get_household(j.household_code)
    if not any(m["device_id"] == j.device_id for m in h["members"]):
        await db.households.update_one(
            {"household_code": j.household_code},
            {"$push": {"members": {"device_id": j.device_id, "name": j.name, "role": j.role}}},
        )
    h = await _get_household(j.household_code)
    return h


@api_router.patch("/household/role")
async def update_role(r: RoleUpdate):
    h = await _get_household(r.household_code)
    if not any(m["device_id"] == r.device_id for m in h["members"]):
        raise HTTPException(status_code=404, detail="Not a member of this household")
    await db.households.update_one(
        {"household_code": r.household_code, "members.device_id": r.device_id},
        {"$set": {"members.$.role": r.role}},
    )
    return await _get_household(r.household_code)


@api_router.get("/household/by-device/{device_id}")
async def household_for_device(device_id: str):
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
    latest_mood = await db.mood.find_one(
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
async def handoff_score(household_code: str):
    h = await _get_household(household_code)
    return await compute_handoff_score(h)


class SOSRequest(BaseModel):
    household_code: str
    device_id: str
    note: Optional[str] = None


@api_router.post("/handoff/sos")
async def handoff_sos(s: SOSRequest):
    """One tap, no calling. Fires immediately — no score threshold, no
    once-a-day cap. This is for right now, not a nudge."""
    h = await _get_household(s.household_code)
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
async def handoff_switch(s: HandoffSwitch):
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
async def handoff_history(household_code: str, limit: int = 20):
    docs = await db.handoff_events.find(
        {"household_code": household_code}, {"_id": 0}
    ).sort("at", -1).to_list(limit)
    return docs


# ----- Cultural spaces (opt-in) -----
@api_router.get("/spaces/{device_id}")
async def spaces_for(device_id: str):
    prof = await db.profiles.find_one({"device_id": device_id}, {"_id": 0}) or {}
    joined = prof.get("joined_spaces", [])
    counts = {}
    for space in CULTURAL_SPACES:
        counts[space["key"]] = await db.profiles.count_documents({"joined_spaces": space["key"]})
    spaces_with_counts = [{**s, "member_count": counts.get(s["key"], 0)} for s in CULTURAL_SPACES]
    return {"spaces": spaces_with_counts, "joined": joined}


@api_router.post("/spaces/join")
async def join_space(a: SpaceAction):
    await db.profiles.update_one({"device_id": a.device_id},
                                 {"$addToSet": {"joined_spaces": a.space}}, upsert=True)
    return {"ok": True}


@api_router.post("/spaces/leave")
async def leave_space(a: SpaceAction):
    await db.profiles.update_one({"device_id": a.device_id},
                                 {"$pull": {"joined_spaces": a.space}})
    return {"ok": True}


# ----- Guides & resources (culturally-aware) -----
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
async def create_shop_item(item: ShopItemCreate):
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
async def claim_shop_item(item_id: str):
    await db.shop_items.update_one({"_id": ObjectId(item_id)}, {"$set": {"claimed": True}})
    return {"ok": True}


@api_router.delete("/shop/items/{item_id}")
async def delete_shop_item(item_id: str):
    await db.shop_items.delete_one({"_id": ObjectId(item_id)})
    return {"ok": True}


@api_router.post("/shop/items/{item_id}/interest")
async def express_interest(item_id: str, body: InterestCreate):
    """Starts (or resumes) a private thread between an interested caregiver
    and the person who posted the item. One thread per interested device
    per item, so repeated taps don't spawn duplicate conversations."""
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
async def my_shop_threads(device_id: str):
    docs = await db.shop_threads.find(
        {"$or": [{"poster_device_id": device_id}, {"interested_device_id": device_id}]}
    ).sort("created_at", -1).to_list(100)
    for d in docs:
        d["id"] = str(d.pop("_id"))
        d["am_poster"] = d["poster_device_id"] == device_id
    return docs


@api_router.get("/shop/thread/{thread_id}")
async def shop_thread_messages(thread_id: str):
    thread = await db.shop_threads.find_one({"_id": ObjectId(thread_id)})
    if not thread:
        raise HTTPException(status_code=404, detail="Not found")
    thread["id"] = str(thread.pop("_id"))
    msgs = await db.shop_thread_messages.find({"thread_id": thread_id}, {"_id": 0}).sort("created_at", 1).to_list(300)
    return {"thread": thread, "messages": msgs}


@api_router.post("/shop/thread/{thread_id}")
async def send_shop_message(thread_id: str, m: ShopMessageCreate):
    await db.shop_thread_messages.insert_one({
        "thread_id": thread_id, "device_id": m.device_id, "text": m.text, "created_at": now_iso(),
    })
    return {"ok": True}


# ----- Postpartum recovery -----
@api_router.get("/recovery/warning-signs")
async def recovery_warning_signs():
    return RECOVERY_WARNING_SIGNS


@api_router.post("/recovery/checkin")
async def recovery_checkin(c: RecoveryCheckinCreate):
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
async def recovery_checkins(device_id: str, limit: int = 30):
    docs = await db.recovery_checkins.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


@api_router.get("/recovery/today/{device_id}")
async def recovery_today(device_id: str):
    today = datetime.now(timezone.utc).date().isoformat()
    doc = await db.recovery_checkins.find_one(
        {"device_id": device_id, "created_at": {"$regex": f"^{today}"}}, {"_id": 0})
    return {"done": doc is not None, "entry": doc}


@api_router.patch("/profile/appointment")
async def update_appointment(u: ProfileApptUpdate):
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
    {"key": "riverstone", "label": "Riverstone", "city": "Madera"},
    {"key": "tesoro_viejo", "label": "Tesoro Viejo", "city": "Madera"},
    {"key": "clovis", "label": "Clovis", "city": "Clovis"},
    {"key": "fresno", "label": "Fresno (general)", "city": "Fresno"},
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
    return MEETUP_NEIGHBORHOODS


@api_router.get("/meetups/categories")
async def meetup_categories():
    return MEETUP_CATEGORIES


@api_router.get("/meetups/venues/{neighborhood}")
async def meetup_venues(neighborhood: str):
    return MEETUP_VENUES.get(neighborhood, [])


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
    await db.meetups.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@api_router.get("/meetups")
async def list_meetups(neighborhood: Optional[str] = None, category: Optional[str] = None, cultural_tag: Optional[str] = None):
    today = datetime.now(timezone.utc).date().isoformat()
    query: dict = {"date": {"$gte": today}}
    if neighborhood and neighborhood != "all":
        query["neighborhood"] = neighborhood
    if category and category != "all":
        query["category"] = category
    if cultural_tag:
        query["cultural_tag"] = cultural_tag
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
async def weekly_insights(device_id: str, force: bool = False):
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
async def catch_up(device_id: str):
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
async def wellbeing_self_check(device_id: str):
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
@api_router.get("/baby-log/{device_id}/predictive-nudge")
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
    await seed_community()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
