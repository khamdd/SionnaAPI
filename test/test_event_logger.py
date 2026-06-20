from dataclasses import dataclass
import queue
import time

from backend.services import event_logger


@dataclass(frozen=True)
class FakeSettings:
    enabled: bool
    url: str = "http://localhost:9200"
    index: str = "sionna-logs-test"


def test_log_event_does_nothing_when_disabled(monkeypatch):
    calls = []
    monkeypatch.setattr(
        event_logger,
        "enqueue_log_event",
        lambda *args: calls.append(args),
    )

    sent = event_logger.log_event(
        "test_event",
        settings=FakeSettings(enabled=False),
    )

    assert sent is False
    assert calls == []


def test_log_event_redacts_sensitive_fields(monkeypatch):
    calls = []
    monkeypatch.setattr(
        event_logger,
        "enqueue_log_event",
        lambda *args: calls.append(args) or True,
    )

    sent = event_logger.log_event(
        "login_attempt",
        data={
            "username": "alice",
            "password": "secret-password",
            "nested": {
                "access_token": "secret-token",
            },
        },
        settings=FakeSettings(enabled=True),
    )

    payload = calls[0][2]

    assert sent is True
    assert payload["username"] == "alice"
    assert payload["password"] == "[REDACTED]"
    assert payload["nested"]["access_token"] == "[REDACTED]"


def test_log_event_returns_false_when_queue_rejects_event(monkeypatch):
    monkeypatch.setattr(
        event_logger,
        "enqueue_log_event",
        lambda *args: False,
    )

    accepted = event_logger.log_event(
        "test_event",
        settings=FakeSettings(enabled=True),
    )

    assert accepted is False


def test_worker_delivery_failure_does_not_raise(monkeypatch):
    def fail_send(*args):
        raise OSError("elasticsearch down")

    monkeypatch.setattr(
        event_logger,
        "send_to_elasticsearch",
        fail_send,
    )

    sent = event_logger.deliver_log_event(
        "http://localhost:9200",
        "sionna-logs-test",
        {"event": "test_event"},
    )

    assert sent is False


def test_enqueue_does_not_wait_for_elasticsearch(monkeypatch):
    isolated_queue = queue.Queue(maxsize=4)
    monkeypatch.setattr(event_logger, "_log_queue", isolated_queue)
    monkeypatch.setattr(event_logger, "start_event_logger", lambda: None)

    started_at = time.perf_counter()
    accepted = event_logger.enqueue_log_event(
        "http://localhost:9200",
        "sionna-logs-test",
        {"event": "test_event"},
    )
    elapsed = time.perf_counter() - started_at

    assert accepted is True
    assert elapsed < 0.2
    assert isolated_queue.get_nowait() == (
        "http://localhost:9200",
        "sionna-logs-test",
        {"event": "test_event"},
    )


def test_daily_index_name_uses_event_timestamp():
    index = event_logger.build_daily_index_name(
        "sionna-logs-test",
        {"@timestamp": "2026-06-20T11:43:34.476766+00:00"},
    )

    assert index == "sionna-logs-test-2026.06.20"
