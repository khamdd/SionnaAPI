from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool
from sqlalchemy.dialects.postgresql.base import ischema_names
from sqlalchemy.engine import URL

from backend.database import resolve_database_url
from backend.models import Base, Geography, Geometry


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
extension_owned_table_names = frozenset({"spatial_ref_sys"})

# The application deliberately uses small custom PostGIS types instead of a
# GeoAlchemy dependency. Register them for PostgreSQL reflection so Alembic can
# compare the live schema with the model metadata without treating them as
# unknown types.
ischema_names.setdefault("geometry", Geometry)
ischema_names.setdefault("geography", Geography)


def include_name(name: str | None, type_: str, parent_names: dict) -> bool:
    """Exclude tables owned by installed database extensions."""
    if type_ == "table":
        return name not in extension_owned_table_names
    return True


def get_database_url() -> str | URL:
    """Resolve migration connectivity from the application's configuration."""
    database_url = resolve_database_url()
    if database_url is None:
        raise RuntimeError(
            "Database connection is not configured. Set DATABASE_URL or "
            "POSTGRES_HOST before running Alembic."
        )
    return database_url


def run_migrations_offline() -> None:
    """Run migrations without creating a live database connection."""
    context.configure(
        url=get_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        include_name=include_name,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations using a short-lived database connection."""
    connectable = create_engine(
        get_database_url(),
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_name=include_name,
        )

        with context.begin_transaction():
            context.run_migrations()

    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
