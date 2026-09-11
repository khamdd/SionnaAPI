import hashlib
import json
import re
from pathlib import Path

import pytest

from backend.main import app
from backend.schemas.requests import (
    CoverageRequest,
    NetworkCoverageOptimizationRequest,
    NetworkCoverageRequest,
    RSRPRequest,
    SINRRequest,
    ThroughputRequest,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ROOT = PROJECT_ROOT / "test" / "fixtures" / "refactor"
EXPECTED_OPENAPI_SHA256 = "a2ed3a1f2524129da668553520cdab2d8621f1fe832aff9f7b84f4b63289a6b6"
EXPECTED_OPENAPI_PATH_COUNT = 46
EXPECTED_OPENAPI_OPERATION_COUNT = 53
PUBLIC_OPERATIONS = {
    ("post", "/api/v1/auth/login"),
    ("post", "/api/v1/auth/register"),
    ("get", "/health"),
}
REQUEST_MODELS = {
    "coverage_map": CoverageRequest,
    "network_coverage": NetworkCoverageRequest,
    "network_coverage_optimization": NetworkCoverageOptimizationRequest,
    "rsrp_simulation": RSRPRequest,
    "sinr": SINRRequest,
    "throughput_comparison": ThroughputRequest,
}


def load_fixture(name):
    return json.loads((FIXTURE_ROOT / name).read_text(encoding="utf-8"))


def openapi_operations(schema):
    return {
        (method, path): operation
        for path, methods in schema["paths"].items()
        for method, operation in methods.items()
    }


def test_normalized_openapi_matches_refactor_baseline():
    schema = app.openapi()
    normalized = json.dumps(
        schema,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")
    operations = openapi_operations(schema)

    assert len(schema["paths"]) == EXPECTED_OPENAPI_PATH_COUNT
    assert len(operations) == EXPECTED_OPENAPI_OPERATION_COUNT
    assert hashlib.sha256(normalized).hexdigest() == EXPECTED_OPENAPI_SHA256


def test_openapi_authentication_boundary_matches_refactor_baseline():
    operations = openapi_operations(app.openapi())

    assert PUBLIC_OPERATIONS <= operations.keys()
    for key, operation in operations.items():
        assert bool(operation.get("security")) is (key not in PUBLIC_OPERATIONS)


@pytest.mark.parametrize("simulation_type", sorted(REQUEST_MODELS))
def test_simulation_request_fixture_matches_schema(simulation_type):
    payload = load_fixture("simulation_requests.json")[simulation_type]
    request = REQUEST_MODELS[simulation_type].model_validate(payload)

    assert request.model_dump(mode="json") == payload


def test_frontend_route_constants_match_refactor_fixture():
    source = (
        PROJECT_ROOT / "frontend" / "src" / "constants" / "routes.js"
    ).read_text(encoding="utf-8")
    actual = [
        {"path": path, "label": label}
        for path, label in re.findall(
            r'\{\s*path:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}',
            source,
        )
    ]

    assert actual == load_fixture("frontend_contract.json")["navbar_routes"]


def test_local_storage_keys_match_refactor_fixture():
    source = (
        PROJECT_ROOT / "frontend" / "src" / "constants" / "storage.js"
    ).read_text(encoding="utf-8")
    actual = dict(
        re.findall(r'export const (\w+) = "([^"]+)";', source)
    )
    contract = load_fixture("local_storage_contract.json")

    assert actual == contract["keys"]
    assert set(contract["representative_state"]) == set(actual.values())
