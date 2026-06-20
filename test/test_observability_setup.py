from backend import observability_setup


class FakeResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return b"{}"


def test_request_retries_transient_timeout(monkeypatch):
    calls = []

    def flaky_urlopen(*args, **kwargs):
        calls.append((args, kwargs))
        if len(calls) == 1:
            raise TimeoutError("Elasticsearch is busy")
        return FakeResponse()

    monkeypatch.setattr(observability_setup, "urlopen", flaky_urlopen)
    monkeypatch.setattr(observability_setup.time, "sleep", lambda _seconds: None)

    result = observability_setup.request(
        "PUT",
        "http://elasticsearch:9200/_ilm/policy/test",
        {"policy": {}},
        attempts=2,
    )

    assert result == {}
    assert len(calls) == 2
