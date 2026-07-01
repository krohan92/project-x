"""
End-to-end backend tests for the Aura Postpartum Companion API.
Uses the public EXPO_PUBLIC_BACKEND_URL from frontend/.env so we test what the
user actually sees through the Kubernetes ingress.
"""
import os
import time
import uuid
import pytest
import requests
from pathlib import Path

# Read the public backend URL from frontend/.env (what the app actually calls)
FRONTEND_ENV = Path(__file__).resolve().parents[2] / "frontend" / ".env"
BASE_URL = None
if FRONTEND_ENV.exists():
    for line in FRONTEND_ENV.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break
if not BASE_URL:
    BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
API = f"{BASE_URL}/api"

DEVICE_ID = f"TEST_dev_{uuid.uuid4().hex[:10]}"
SESSION_ID = f"TEST_sess_{uuid.uuid4().hex[:10]}"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------------------------------------------------------------- misc content
def test_root(client):
    r = client.get(f"{API}/")
    assert r.status_code == 200
    assert "message" in r.json()


def test_quote(client):
    r = client.get(f"{API}/quote")
    assert r.status_code == 200
    data = r.json()
    assert "text" in data and "author" in data
    assert isinstance(data["text"], str) and len(data["text"]) > 5


def test_tips(client):
    r = client.get(f"{API}/tips")
    assert r.status_code == 200
    tips = r.json()
    assert isinstance(tips, list) and len(tips) >= 3
    for t in tips:
        assert {"title", "category", "body", "icon"} <= set(t.keys())


def test_helplines(client):
    r = client.get(f"{API}/helplines")
    assert r.status_code == 200
    hl = r.json()
    assert any(h.get("type") == "crisis" for h in hl)
    assert any("988" in h.get("detail", "") for h in hl)


def test_pump_providers(client):
    r = client.get(f"{API}/pump-providers")
    assert r.status_code == 200
    pp = r.json()
    assert isinstance(pp, list) and len(pp) >= 2
    for p in pp:
        assert {"name", "detail", "coverage", "url"} <= set(p.keys())


# ---------------------------------------------------------------- profile
def test_profile_upsert_and_get(client):
    payload = {
        "device_id": DEVICE_ID,
        "name": "TEST_Mom",
        "baby_name": "TEST_Baby",
        "num_children": 1,
        "delivery_type": "Vaginal birth",
        "delivery_date": "2025-12-01",
        "feeding_method": "Breastfeeding",
        "birth_experience": "Mostly positive",
        "support_level": "I have some support",
        "initial_mood": 3,
        "concerns": ["Sleep", "Anxiety"],
    }
    r = client.post(f"{API}/profile", json=payload)
    assert r.status_code == 200, r.text
    saved = r.json()
    assert saved["device_id"] == DEVICE_ID
    assert saved["name"] == "TEST_Mom"

    g = client.get(f"{API}/profile/{DEVICE_ID}")
    assert g.status_code == 200
    got = g.json()
    assert got["name"] == "TEST_Mom"
    assert got["concerns"] == ["Sleep", "Anxiety"]

    # 404 for unknown device
    nf = client.get(f"{API}/profile/TEST_missing_{uuid.uuid4().hex[:6]}")
    assert nf.status_code == 404


# ---------------------------------------------------------------- mood
def test_mood_add_list_today(client):
    entry = {"device_id": DEVICE_ID, "mood": 4, "note": "TEST_mood_note", "tags": ["good"]}
    r = client.post(f"{API}/mood", json=entry)
    assert r.status_code == 200
    body = r.json()
    assert body["mood"] == 4 and body["note"] == "TEST_mood_note"

    lst = client.get(f"{API}/mood/{DEVICE_ID}")
    assert lst.status_code == 200
    moods = lst.json()
    assert isinstance(moods, list) and len(moods) >= 1
    assert any(m["note"] == "TEST_mood_note" for m in moods)

    today = client.get(f"{API}/mood/{DEVICE_ID}/today")
    assert today.status_code == 200
    td = today.json()
    assert td["done"] is True
    assert td["entry"] is not None


# ---------------------------------------------------------------- EPDS
def test_epds_questions(client):
    r = client.get(f"{API}/epds/questions")
    assert r.status_code == 200
    q = r.json()
    assert isinstance(q, list) and len(q) == 10
    for item in q:
        assert "q" in item and "options" in item
        assert len(item["options"]) == 4
        assert sorted(o["score"] for o in item["options"]) == [0, 1, 2, 3]


def test_epds_submit_low(client):
    r = client.post(f"{API}/epds", json={"device_id": DEVICE_ID, "answers": [0] * 10})
    assert r.status_code == 200
    d = r.json()
    assert d["total"] == 0
    assert d["band"] == "low"
    assert d["self_harm_flag"] is False


def test_epds_submit_possible(client):
    # total = 11 -> possible
    ans = [1, 1, 1, 1, 1, 1, 1, 1, 2, 1]
    assert sum(ans) == 11
    r = client.post(f"{API}/epds", json={"device_id": DEVICE_ID, "answers": ans})
    assert r.status_code == 200
    d = r.json()
    assert d["total"] == 11 and d["band"] == "possible"
    assert d["self_harm_flag"] is True  # last answer > 0


def test_epds_submit_likely_and_selfharm(client):
    ans = [2, 2, 2, 2, 2, 2, 2, 2, 2, 3]
    r = client.post(f"{API}/epds", json={"device_id": DEVICE_ID, "answers": ans})
    assert r.status_code == 200
    d = r.json()
    assert d["total"] == sum(ans) and d["band"] == "likely"
    assert d["self_harm_flag"] is True


def test_epds_validation_error(client):
    r = client.post(f"{API}/epds", json={"device_id": DEVICE_ID, "answers": [0, 0, 0]})
    assert r.status_code == 400


def test_epds_history(client):
    r = client.get(f"{API}/epds/{DEVICE_ID}")
    assert r.status_code == 200
    hist = r.json()
    assert isinstance(hist, list) and len(hist) >= 3


# ---------------------------------------------------------------- chat (LLM)
def test_chat_send_and_history(client):
    payload = {
        "device_id": DEVICE_ID,
        "session_id": SESSION_ID,
        "message": "I'm exhausted and feeling low today.",
    }
    r = client.post(f"{API}/chat", json=payload, timeout=60)
    assert r.status_code == 200, r.text
    reply = r.json().get("reply", "")
    assert isinstance(reply, str) and len(reply) > 10, f"empty reply: {reply!r}"

    hist = client.get(f"{API}/chat/{SESSION_ID}")
    assert hist.status_code == 200
    msgs = hist.json()
    roles = [m["role"] for m in msgs]
    assert "user" in roles and "assistant" in roles
    assert msgs[-1]["role"] == "assistant"


# ---------------------------------------------------------------- community
_created_post_id = None


def test_community_seed_feed(client):
    r = client.get(f"{API}/community")
    assert r.status_code == 200
    feed = r.json()
    assert isinstance(feed, list) and len(feed) >= 1
    for p in feed:
        assert "id" in p and "_id" not in p
        assert "author" in p and "text" in p and "topic" in p


def test_community_create_post(client):
    global _created_post_id
    r = client.post(
        f"{API}/community",
        json={"device_id": DEVICE_ID, "author": "TEST_Mom", "text": "TEST_hello_from_pytest", "topic": "Sleep"},
    )
    assert r.status_code == 200
    d = r.json()
    assert d["text"] == "TEST_hello_from_pytest"
    assert d["topic"] == "Sleep"
    assert "id" in d
    _created_post_id = d["id"]

    feed = client.get(f"{API}/community").json()
    assert any(p["id"] == _created_post_id for p in feed)


def test_community_like(client):
    assert _created_post_id, "post must be created first"
    r = client.post(f"{API}/community/{_created_post_id}/like")
    assert r.status_code == 200
    feed = client.get(f"{API}/community").json()
    post = next(p for p in feed if p["id"] == _created_post_id)
    assert post["likes"] >= 1


def test_community_comments(client):
    assert _created_post_id
    r = client.post(
        f"{API}/community/{_created_post_id}/comments",
        json={"device_id": DEVICE_ID, "author": "TEST_Mom", "text": "TEST_comment"},
    )
    assert r.status_code == 200

    g = client.get(f"{API}/community/{_created_post_id}/comments")
    assert g.status_code == 200
    comments = g.json()
    assert any(c["text"] == "TEST_comment" for c in comments)
