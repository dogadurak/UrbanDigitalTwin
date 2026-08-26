import pytest
from httpx import AsyncClient, ASGITransport
import datetime
import os
import json

from app.main import app, load_models
import pytest_asyncio

@pytest_asyncio.fixture(autouse=True)
async def setup_models():
    await load_models()

@pytest.mark.asyncio
async def test_simulate_what_if_invalid_building():
    # Test simulate what-if with a building that does not exist in spatial_features
    # It should return an error
    
    req_payload = {
        "building_id": "non_existent_building_999",
        "target_temperature": 25.0,
        "target_ndvi": 0.5,
        "target_building_density": 0.3
    }
    
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post("/api/simulate-what-if", json=req_payload)
        
    assert response.status_code == 200
    data = response.json()
    assert "error" in data
    assert "Building spatial context not found" in data["error"]

@pytest.mark.asyncio
async def test_detect_anomalies_invalid_building():
    # Test detect-anomalies with invalid building
    req_payload = {
        "building_id": "invalid_building",
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "energy": 100.0,
        "outdoor_temperature": 20.0,
        "dewTemperature": 10.0,
        "windSpeed": 5.0,
        "cloudCoverage": 0.0
    }
    
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post("/api/detect-anomalies", json=req_payload)
        
    assert response.status_code == 200
    data = response.json()
    assert "error" in data
    assert "Building spatial context not found" in data["error"]
