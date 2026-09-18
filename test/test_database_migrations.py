import pytest

from backend import database


def test_database_revision_check_requires_database(monkeypatch):
    monkeypatch.setattr(database, "DATABASE_URL", None)
    monkeypatch.setattr(
        database,
        "_get_current_migration_heads",
        lambda: pytest.fail("database should not be inspected"),
    )

    with pytest.raises(RuntimeError, match="PostgreSQL/PostGIS is required"):
        database.ensure_database_is_current()


def test_database_revision_check_accepts_current_database(monkeypatch):
    monkeypatch.setattr(database, "DATABASE_URL", "postgresql+psycopg://configured")
    monkeypatch.setattr(
        database,
        "_get_expected_migration_heads",
        lambda: ("0001_initial_schema",),
    )
    monkeypatch.setattr(
        database,
        "_get_current_migration_heads",
        lambda: ("0001_initial_schema",),
    )

    assert database.ensure_database_is_current() is True


def test_database_revision_check_rejects_outdated_database(monkeypatch):
    monkeypatch.setattr(database, "DATABASE_URL", "postgresql+psycopg://configured")
    monkeypatch.setattr(
        database,
        "_get_expected_migration_heads",
        lambda: ("0002_new_schema",),
    )
    monkeypatch.setattr(
        database,
        "_get_current_migration_heads",
        lambda: ("0001_initial_schema",),
    )

    with pytest.raises(RuntimeError, match="Database schema is not current"):
        database.ensure_database_is_current()


def test_global_antenna_inventory_migration_is_the_current_head():
    assert database._get_expected_migration_heads() == (
        "0009_global_antenna_inventory",
    )
