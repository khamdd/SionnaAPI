from dataclasses import dataclass

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
        "send_to_elasticsearch",
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
        "send_to_elasticsearch",
        lambda *args: calls.append(args),
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


def test_log_event_failure_does_not_raise(monkeypatch):
    def fail_send(*args):
        raise OSError("elasticsearch down")

    monkeypatch.setattr(
        event_logger,
        "send_to_elasticsearch",
        fail_send,
    )

    sent = event_logger.log_event(
        "test_event",
        settings=FakeSettings(enabled=True),
    )

    assert sent is False
