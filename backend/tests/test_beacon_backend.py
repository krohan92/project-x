"""
Backend tests for Beacon feature layered on Aura.
Covers: meta, settings, ethnicity delete, presence with jitter, active peers,
smart matching (similar / none / fallback), tag hiding rule, peer chat,
baby tracker, spaces, community filter, and culturally-aware guides.
"""
import math
import uuid
import pytest
import requests
from pathlib import Path

FRONTEND_ENV = Path(__file__).resolve().parents[2] / "frontend" / ".env"
BASE_URL = None
for line in FRONTEND_ENV.read_text().splitlines():
    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
        break
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _dev():
    return f"TEST_bcn_{uuid.uuid4().hex[:10]}"


# ---------------------------------------------------------------- meta
def test_beacon_meta(client):
    r = client.get(f"{API}/beacon/meta")
    assert r.status_code == 200
    d = r.json()
    assert len(d["ethnicity_tags"]) == 7
    assert "South Asian / Indian" in d["ethnicity_tags"]
    assert len(d["cultural_spaces"]) == 5
    keys = {s["key"] for s in d["cultural_spaces"]}
    assert {"south_asian", "latina", "black", "east_asian", "mena"} <= keys


# ---------------------------------------------------------------- settings PATCH
def test_beacon_settings_partial_update(client):
    did = _dev()
    # create base profile first so it exists
    client.post(f"{API}/profile", json={"device_id": did, "name": "TEST_mom"})
    r = client.patch(f"{API}/beacon/settings", json={
        "device_id": did,
        "ethnicity": "South Asian / Indian",
        "matching_preference": "similar",
        "display_tags": True,
        "allow_cultural_match": True,
        "language": "hi",
    })
    assert r.status_code == 200
    prof = r.json()
    assert prof["ethnicity"] == "South Asian / Indian"
    assert prof["matching_preference"] == "similar"
    assert prof["display_tags"] is True
    assert prof["allow_cultural_match"] is True
    assert prof["language"] == "hi"

    # partial update should not clobber other fields
    r2 = client.patch(f"{API}/beacon/settings", json={
        "device_id": did, "language": "es"
    })
    p2 = r2.json()
    assert p2["language"] == "es"
    assert p2["ethnicity"] == "South Asian / Indian"


# ---------------------------------------------------------------- delete ethnicity
def test_delete_ethnicity(client):
    did = _dev()
    client.post(f"{API}/profile", json={"device_id": did, "name": "TEST"})
    client.patch(f"{API}/beacon/settings", json={
        "device_id": did, "ethnicity": "Latina / Hispanic",
        "matching_preference": "similar", "display_tags": True,
        "allow_cultural_match": True,
    })
    r = client.delete(f"{API}/beacon/ethnicity/{did}")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    prof = body["profile"]
    assert "ethnicity" not in prof or prof.get("ethnicity") is None
    assert prof["matching_preference"] == "none"
    assert prof["display_tags"] is False

    # verify via GET /profile
    g = client.get(f"{API}/profile/{did}")
    assert g.status_code == 200
    got = g.json()
    assert "ethnicity" not in got or got.get("ethnicity") is None


# ---------------------------------------------------------------- presence
def _miles_between(lat1, lng1, lat2, lng2):
    # rough equirectangular in miles
    x = (lng2 - lng1) * math.cos(math.radians((lat1 + lat2) / 2)) * 69.0
    y = (lat2 - lat1) * 69.0
    return math.hypot(x, y)


def test_presence_toggle_jitters_and_hides_raw(client):
    did = _dev()
    raw_lat, raw_lng = 40.7128, -74.0060
    r = client.post(f"{API}/presence/toggle", json={
        "device_id": did, "awake": True, "lat": raw_lat, "lng": raw_lng
    })
    assert r.status_code == 200
    assert r.json()["awake"] is True

    # active endpoint returns pins; verify no pin equals raw coords for this device
    a = client.get(f"{API}/presence/active", params={"device_id": did})
    assert a.status_code == 200
    body = a.json()
    assert body["count"] > 0
    # anchor should be within 10mi of raw and NOT equal raw
    anchor = body["anchor"]
    assert (anchor["lat"], anchor["lng"]) != (raw_lat, raw_lng)
    dist = _miles_between(raw_lat, raw_lng, anchor["lat"], anchor["lng"])
    assert dist <= 10.5, f"anchor {dist}mi exceeds ~10mi jitter"

    # toggle off works
    r2 = client.post(f"{API}/presence/toggle", json={"device_id": did, "awake": False})
    assert r2.status_code == 200
    assert r2.json()["awake"] is False


def test_presence_active_has_mock_peers(client):
    did = _dev()
    client.post(f"{API}/presence/toggle", json={
        "device_id": did, "awake": True, "lat": 34.05, "lng": -118.24
    })
    a = client.get(f"{API}/presence/active", params={"device_id": did})
    body = a.json()
    assert len(body["pins"]) >= 8  # mock peers
    for p in body["pins"]:
        assert "lat" in p and "lng" in p


# ---------------------------------------------------------------- matching
def test_match_similar_returns_matched_on_preference(client):
    did = _dev()
    client.post(f"{API}/profile", json={"device_id": did, "name": "TEST"})
    client.patch(f"{API}/beacon/settings", json={
        "device_id": did, "ethnicity": "South Asian / Indian",
        "matching_preference": "similar",
        "display_tags": False,          # not both display => tag hidden
        "allow_cultural_match": True,
    })
    r = client.post(f"{API}/match/request", json={"device_id": did})
    assert r.status_code == 200
    d = r.json()
    assert d["outcome"] == "matched-on-preference"
    assert d["room_id"]
    # peer_tag hidden because our display_tags = False
    assert d["peer_tag"] is None

    # peer chat has an opening peer message
    room = client.get(f"{API}/peerchat/{d['room_id']}").json()
    assert room["room"]["outcome"] == "matched-on-preference"
    assert len(room["messages"]) >= 1
    assert room["messages"][0]["sender"] == "peer"


def test_match_tag_revealed_when_both_display(client):
    did = _dev()
    client.post(f"{API}/profile", json={"device_id": did, "name": "TEST"})
    client.patch(f"{API}/beacon/settings", json={
        "device_id": did, "ethnicity": "South Asian / Indian",
        "matching_preference": "similar", "display_tags": True,
        "allow_cultural_match": True,
    })
    # try a few times to hit peer_dawn / peer_lotus (both display_tags True for SA peers only peer_dawn)
    got_tag = False
    for _ in range(15):
        r = client.post(f"{API}/match/request", json={"device_id": did}).json()
        if r["outcome"] == "matched-on-preference" and r["peer_tag"]:
            assert r["peer_tag"] == "South Asian / Indian"
            got_tag = True
            break
    assert got_tag, "expected at least one match where peer_tag revealed (peer_dawn has display_tags=True)"


def test_match_none_returns_fallback(client):
    did = _dev()
    client.post(f"{API}/profile", json={"device_id": did, "name": "TEST"})
    client.patch(f"{API}/beacon/settings", json={
        "device_id": did, "matching_preference": "none"
    })
    r = client.post(f"{API}/match/request", json={"device_id": did})
    assert r.status_code == 200
    d = r.json()
    assert d["outcome"] == "fallback"
    assert d["peer_tag"] is None  # display_tags not set


def test_match_analytics_increments(client):
    a1 = client.get(f"{API}/match/analytics").json()
    did = _dev()
    client.patch(f"{API}/beacon/settings", json={
        "device_id": did, "matching_preference": "none"
    })
    client.post(f"{API}/match/request", json={"device_id": did})
    a2 = client.get(f"{API}/match/analytics").json()
    assert a2["total"] >= a1["total"] + 1
    assert a2["fallback"] >= a1["fallback"] + 1


# ---------------------------------------------------------------- peer chat
def test_peerchat_send_gets_peer_reply(client):
    did = _dev()
    client.patch(f"{API}/beacon/settings", json={
        "device_id": did, "matching_preference": "none"
    })
    m = client.post(f"{API}/match/request", json={"device_id": did}).json()
    room_id = m["room_id"]

    send = client.post(f"{API}/peerchat/{room_id}",
                       json={"device_id": did, "text": "TEST_hi there"})
    assert send.status_code == 200

    got = client.get(f"{API}/peerchat/{room_id}").json()
    msgs = got["messages"]
    senders = [x["sender"] for x in msgs]
    # opening peer + my msg + peer reply
    assert senders.count("me") == 1
    assert senders.count("peer") >= 2
    assert any(x["text"] == "TEST_hi there" for x in msgs)


# ---------------------------------------------------------------- baby tracker
def test_baby_log_add_and_list(client):
    did = _dev()
    for kind in ["feed", "sleep", "diaper"]:
        r = client.post(f"{API}/baby-log", json={
            "device_id": did, "kind": kind, "detail": f"TEST_{kind}"
        })
        assert r.status_code == 200
        assert r.json()["kind"] == kind

    lst = client.get(f"{API}/baby-log/{did}").json()
    assert len(lst) == 3
    # newest first
    assert lst[0]["at"] >= lst[-1]["at"]
    kinds = [x["kind"] for x in lst]
    assert set(kinds) == {"feed", "sleep", "diaper"}


# ---------------------------------------------------------------- spaces
def test_spaces_join_leave(client):
    did = _dev()
    r = client.get(f"{API}/spaces/{did}").json()
    assert len(r["spaces"]) == 5
    assert r["joined"] == []

    client.post(f"{API}/spaces/join", json={"device_id": did, "space": "south_asian"})
    j = client.get(f"{API}/spaces/{did}").json()
    assert "south_asian" in j["joined"]

    client.post(f"{API}/spaces/leave", json={"device_id": did, "space": "south_asian"})
    l = client.get(f"{API}/spaces/{did}").json()
    assert "south_asian" not in l["joined"]


# ---------------------------------------------------------------- community filter
def test_community_space_filter(client):
    did = _dev()
    # post to south_asian space
    r = client.post(f"{API}/community", json={
        "device_id": did, "author": "TEST_SA",
        "text": "TEST_south_asian_only_post", "topic": "Support",
        "space": "south_asian"
    })
    assert r.status_code == 200

    sa = client.get(f"{API}/community", params={"space": "south_asian"}).json()
    assert any(p["text"] == "TEST_south_asian_only_post" for p in sa)

    latina = client.get(f"{API}/community", params={"space": "latina"}).json()
    assert not any(p["text"] == "TEST_south_asian_only_post" for p in latina)


# ---------------------------------------------------------------- guides
def test_guides_featured_variant(client):
    r = client.get(f"{API}/guides", params={"culture": "South Asian / Indian"})
    assert r.status_code == 200
    guides = r.json()
    recovery = next(g for g in guides if g["id"] == "recovery-basics")
    assert recovery["featured_variant"] is not None
    assert recovery["featured_variant"]["culture"] == "South Asian / Indian"
    # a guide with no matching variant returns null featured_variant
    mh = next(g for g in guides if g["id"] == "mental-health")
    assert mh["featured_variant"] is None


def test_guides_no_culture(client):
    r = client.get(f"{API}/guides").json()
    for g in r:
        assert g["featured_variant"] is None
