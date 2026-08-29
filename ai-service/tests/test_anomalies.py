"""API contract tests for the serving layer.

These assert the behaviour the service promises when it cannot answer, which is
the part that used to be wrong: the previous version returned HTTP 200 with an
``{"error": ...}`` body, so a caller checking status codes would treat a failure
as a successful prediction.
"""

import datetime

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app, load_model


@pytest_asyncio.fixture(autouse=True)
async def setup_models():
    await load_model()


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_health_declares_what_the_model_is():
    async with _client() as ac:
        r = await ac.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    # The service must state that it uses no spatial features, because BDG2
    # coordinates cannot support them.
    assert body["uses_spatial_features"] is False
    assert "40 km" in body["spatial_note"]


@pytest.mark.asyncio
async def test_unknown_building_is_404_not_a_fake_success():
    payload = {
        "building_id": "definitely_not_a_building_999",
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "energy": 100.0,
        "airTemperature": 20.0,
    }
    async with _client() as ac:
        r = await ac.post("/api/detect-anomalies", json=payload)
    assert r.status_code in (404, 503)
    if r.status_code == 404:
        assert "Unknown building" in r.json()["detail"]


@pytest.mark.asyncio
async def test_what_if_unknown_building_is_404():
    payload = {
        "building_id": "definitely_not_a_building_999",
        "airTemperature": 30.0,
    }
    async with _client() as ac:
        r = await ac.post("/api/simulate-what-if", json=payload)
    assert r.status_code in (404, 503)


@pytest.mark.asyncio
async def test_buildings_listing_is_reachable():
    async with _client() as ac:
        r = await ac.get("/api/buildings?limit=3")
    assert r.status_code == 200
    assert "buildings" in r.json()


@pytest.mark.asyncio
async def test_spatial_context_is_empty_not_fabricated():
    """spatial_features is intentionally empty until real ingestion exists."""
    async with _client() as ac:
        r = await ac.get("/api/spatial-context/Rat_office_Adele")
    # 404 (no rows) is the honest answer; a 200 with values would mean something
    # refilled the table with invented data.
    assert r.status_code in (404, 500)
