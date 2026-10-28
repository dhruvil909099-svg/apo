from fastapi.testclient import TestClient


def test_health_liveness_unauthenticated(unauthenticated_client: TestClient):
    """Liveness probe must be public, instantaneous, and return status UP."""
    res = unauthenticated_client.get("/api/v1/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "UP"
    assert "version" in data
    assert "app_name" in data


def test_health_readiness_healthy_db(client: TestClient):
    """Readiness probe must verify database connectivity and return HTTP 200 READY."""
    res = client.get("/api/v1/health/ready")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "READY"
    assert data["database"] == "CONNECTED"
