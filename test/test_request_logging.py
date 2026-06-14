from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.middleware import request_logging
from backend.middleware.request_logging import RequestLoggingMiddleware


def make_client():
    app = FastAPI()
    app.add_middleware(RequestLoggingMiddleware)

    @app.get("/ok")
    def ok():
        return {"status": "success"}

    @app.get("/bad-request")
    def bad_request():
        return {"status": "failure"}

    @app.get("/boom")
    def boom():
        raise RuntimeError("forced failure")

    return TestClient(app, raise_server_exceptions=False)


def test_request_logging_logs_success(monkeypatch):
    events = []
    monkeypatch.setattr(
        request_logging,
        "log_event",
        lambda event, level="INFO", data=None: events.append((event, level, data)),
    )
    client = make_client()

    response = client.get("/ok")

    assert response.status_code == 200
    assert response.headers["x-request-id"]
    assert events[0][0] == "http_request"
    assert events[0][1] == "INFO"
    assert events[0][2]["method"] == "GET"
    assert events[0][2]["path"] == "/ok"
    assert events[0][2]["status_code"] == 200
    assert events[0][2]["request_id"] == response.headers["x-request-id"]
    assert "duration_ms" in events[0][2]
    assert "query" not in events[0][2]
    assert "body" not in events[0][2]


def test_request_logging_warns_for_client_errors(monkeypatch):
    events = []
    monkeypatch.setattr(
        request_logging,
        "log_event",
        lambda event, level="INFO", data=None: events.append((event, level, data)),
    )
    client = make_client()

    response = client.get("/missing")

    assert response.status_code == 404
    assert events[0][0] == "http_request"
    assert events[0][1] == "WARNING"
    assert events[0][2]["status_code"] == 404


def test_request_logging_logs_unhandled_exceptions(monkeypatch):
    events = []
    monkeypatch.setattr(
        request_logging,
        "log_event",
        lambda event, level="INFO", data=None: events.append((event, level, data)),
    )
    client = make_client()

    response = client.get("/boom")

    assert response.status_code == 500
    assert events[0][0] == "http_request_failed"
    assert events[0][1] == "ERROR"
    assert events[0][2]["path"] == "/boom"
    assert events[0][2]["status_code"] == 500
    assert events[0][2]["error"]


def test_request_logging_skips_static_paths(monkeypatch):
    events = []
    monkeypatch.setattr(
        request_logging,
        "log_event",
        lambda event, level="INFO", data=None: events.append((event, level, data)),
    )
    client = make_client()

    response = client.get("/static/demo.png")

    assert response.status_code == 404
    assert events == []
