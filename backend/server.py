from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
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
def build_system_prompt(profile: Optional[dict]) -> str:
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
    return (
        "You are Cuddle, a warm, deeply empathetic companion for mothers in the postpartum period. "
        "You are NOT a doctor and you never diagnose, prescribe, or give clinical medical instructions. "
        "You are a supportive, non-judgmental listener — like a wise, gentle friend who has been through it. "
        f"{ctx}\n\n"
        "How you respond:\n"
        "- Lead with warmth and validation. Reflect her feelings back before offering anything.\n"
        "- Keep replies fairly short (2-5 sentences), soft, and human. Avoid clinical or robotic language.\n"
        "- Ask one gentle, open follow-up question when it feels natural, so she feels heard.\n"
        "- Offer small, doable suggestions (rest, hydration, breathing, reaching out) — never overwhelming lists.\n"
        "- Normalize the hard parts of new motherhood. Remind her she is doing enough.\n"
        "- Encourage her to lean on her real-life support and her healthcare provider for medical concerns.\n\n"
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
    idx = date.today().toordinal() % len(QUOTES)
    return QUOTES[idx]


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


@api_router.post("/chat")
async def chat(req: ChatRequest):
    profile = await db.profiles.find_one({"device_id": req.device_id}, {"_id": 0})
    system_prompt = build_system_prompt(profile)

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
# BEACON — presence, matching, peer chat, baby tracker, spaces, guides, i18n
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


class BeaconSettings(BaseModel):
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


def jitter_coords(lat: float, lng: float, max_miles: float = 10.0):
    """Privacy-preserving randomization. Returns coords offset by up to max_miles."""
    r = max_miles / 69.0
    u = random.random()
    w = r * math.sqrt(u)
    t = 2 * math.pi * random.random()
    dlat = w * math.cos(t)
    dlng = w * math.sin(t) / max(math.cos(math.radians(lat)), 0.1)
    return round(lat + dlat, 5), round(lng + dlng, 5)


# ----- Beacon settings / profile extension -----
@api_router.get("/beacon/meta")
async def beacon_meta():
    return {"ethnicity_tags": ETHNICITY_TAGS, "cultural_spaces": CULTURAL_SPACES}


@api_router.patch("/beacon/settings")
async def update_beacon_settings(s: BeaconSettings):
    update = {k: v for k, v in s.model_dump().items() if k != "device_id" and v is not None}
    if update:
        await db.profiles.update_one({"device_id": s.device_id}, {"$set": update}, upsert=True)
    doc = await db.profiles.find_one({"device_id": s.device_id}, {"_id": 0})
    return doc or {}


@api_router.delete("/beacon/ethnicity/{device_id}")
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
    doc = {"device_id": b.device_id, "kind": b.kind, "detail": b.detail, "at": now_iso()}
    await db.baby_logs.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/baby-log/{device_id}")
async def baby_logs(device_id: str, limit: int = 50):
    docs = await db.baby_logs.find({"device_id": device_id}, {"_id": 0}).sort("at", -1).to_list(limit)
    return docs


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

    other_member = next(
        (m for m in household["members"] if m["device_id"] != on_duty_id), None
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
    return {"spaces": CULTURAL_SPACES, "joined": joined}


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
