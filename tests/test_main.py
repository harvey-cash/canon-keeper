# tests/test_main.py
import httpx  # Make sure httpx is imported
import pytest

from server.main import app  # Your FastAPI app instance


@pytest.mark.asyncio
async def test_root():
    # Use ASGITransport to wrap your FastAPI app
    transport = httpx.ASGITransport(app=app)

    # Pass the transport to the AsyncClient
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/")

    assert response.status_code == 200
    assert response.json() == {"message": "Hello World"}
