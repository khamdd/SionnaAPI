"""Validate and adopt a pre-Alembic database without rebuilding its tables."""

from __future__ import annotations

import argparse
from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, pool

from backend.database import resolve_database_url
from backend.migrations.schema import (
    configure_postgresql_reflection,
    include_name,
    set_application_search_path,
)
from backend.models import Base

BASELINE_REVISION = "0001_initial_schema"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
ALEMBIC_CONFIG_PATH = PROJECT_ROOT / "alembic.ini"


def get_database_url():
    database_url = resolve_database_url()
    if database_url is None:
        raise RuntimeError(
            "Database connection is not configured. Set DATABASE_URL or "
            "POSTGRES_HOST before adopting a legacy database."
        )
    return database_url


def get_schema_differences(connection) -> list:
    """Return changes needed to make the database match current model metadata."""
    migration_context = MigrationContext.configure(
        connection,
        opts={
            "compare_type": True,
            "compare_server_default": True,
            "include_name": include_name,
        },
    )
    return compare_metadata(migration_context, Base.metadata)


def get_current_revisions(connection) -> tuple[str, ...]:
    migration_context = MigrationContext.configure(connection)
    return tuple(migration_context.get_current_heads())


def main(*, check_only: bool = False) -> int:
    configure_postgresql_reflection()
    engine = create_engine(get_database_url(), poolclass=pool.NullPool)

    try:
        with engine.connect() as connection:
            set_application_search_path(connection)
            current_revisions = get_current_revisions(connection)
            differences = get_schema_differences(connection)

        if differences:
            print("Legacy database schema does not match the Alembic baseline:")
            for difference in differences:
                print(f"- {difference!r}")
            print("Database was not stamped.")
            return 1

        if current_revisions:
            if current_revisions == (BASELINE_REVISION,):
                print(
                    "Database schema matches the baseline and is already stamped "
                    f"at {BASELINE_REVISION}."
                )
                return 0

            print(
                "Database already has a different Alembic revision: "
                f"{', '.join(current_revisions)}. Database was not stamped."
            )
            return 1

        if check_only:
            print(
                "Database schema matches the baseline and is not yet stamped. "
                "Check-only mode made no changes."
            )
            return 0

        alembic_config = Config(str(ALEMBIC_CONFIG_PATH))
        command.stamp(alembic_config, BASELINE_REVISION)

        with engine.connect() as connection:
            set_application_search_path(connection)
            stamped_revisions = get_current_revisions(connection)

        if stamped_revisions != (BASELINE_REVISION,):
            print(
                "Alembic stamp did not produce the expected revision. Found: "
                f"{stamped_revisions!r}."
            )
            return 1

        print(
            "Database schema matches the baseline and was stamped at "
            f"{BASELINE_REVISION}. No application tables were recreated."
        )
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Validate and adopt a database created before Alembic."
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="validate compatibility without stamping the database",
    )
    args = parser.parse_args()
    raise SystemExit(main(check_only=args.check_only))
