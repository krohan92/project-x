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
from datetime import datetime, timezone, date

from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')

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


class CommentCreate(BaseModel):
    device_id: str
    author: str
    text: str


# ---------------------------------------------------------------------------
# Static / research-backed content
# ---------------------------------------------------------------------------
QUOTES = [
    {"text": "You are not the same as you were before, and that is okay. You are becoming.", "author": "Aura"},
    {"text": "Being a mother is learning about strengths you didn't know you had.", "author": "Linda Wooten"},
    {"text": "You don't have to be perfect to be an amazing mom.", "author": "Aura"},
    {"text": "Rest is not a reward for finishing. It is fuel for continuing.", "author": "Aura"},
    {"text": "The days are long, but the years are short. Be gentle with today.", "author": "Aura"},
    {"text": "You are doing a beautiful job, even on the days it doesn't feel like it.", "author": "Aura"},
    {"text": "Your baby doesn't need a perfect mother. They need a present one — and you are here.", "author": "Aura"},
    {"text": "Healing is not linear. Some days will feel heavier, and that's part of it.", "author": "Aura"},
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
        "You are Aura, a warm, deeply empathetic companion for mothers in the postpartum period. "
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
    return {"message": "Aura Postpartum API"}


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

    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="LLM key not configured")

    chat_client = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=req.session_id,
        system_message=system_prompt,
    ).with_model("anthropic", "claude-sonnet-4-6")

    # feed prior turns so the model has context (exclude the just-added msg)
    prior = history[:-1][-12:]
    context_preamble = ""
    if prior:
        lines = []
        for m in prior:
            who = "Mother" if m["role"] == "user" else "You (Aura)"
            lines.append(f"{who}: {m['text']}")
        context_preamble = ("Here is the recent conversation so far:\n" +
                            "\n".join(lines) + "\n\nHer new message:\n")

    try:
        reply = await chat_client.send_message(
            UserMessage(text=context_preamble + req.message))
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
async def community_feed():
    docs = await db.community_posts.find({}).sort("created_at", -1).to_list(100)
    out = []
    for d in docs:
        d["id"] = str(d["_id"])
        d.pop("_id", None)
        out.append(d)
    return out


@api_router.post("/community")
async def create_post(post: PostCreate):
    doc = {
        "author": post.author, "avatar_color": "#D68C7A", "location": "You",
        "text": post.text, "topic": post.topic, "likes": 0, "created_at": now_iso(),
        "device_id": post.device_id,
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
