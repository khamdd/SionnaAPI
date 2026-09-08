import os
from contextlib import contextmanager
from pathlib import Path

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import sessionmaker

from backend.migrations.schema import set_application_search_path


load_dotenv()


def resolve_database_url():
    direct_url = os.getenv("DATABASE_URL")
    if direct_url:
        return direct_url

    host = os.getenv("POSTGRES_HOST")
    if not host:
        return None

    return URL.create(
        drivername="postgresql+psycopg",
        username=os.getenv("POSTGRES_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", ""),
        host=host,
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        database=os.getenv("POSTGRES_DB", "postgres"),
    )


DATABASE_URL = resolve_database_url()

_engine = None
_session_factory = None
_project_root = Path(__file__).resolve().parents[1]
_alembic_config_path = _project_root / "alembic.ini"


def is_database_configured():
    return bool(DATABASE_URL)


def _get_expected_migration_heads():
    alembic_config = Config(str(_alembic_config_path))
    return tuple(ScriptDirectory.from_config(alembic_config).get_heads())


def _get_current_migration_heads():
    with get_engine().connect() as connection:
        set_application_search_path(connection)
        migration_context = MigrationContext.configure(connection)
        return tuple(migration_context.get_current_heads())


def ensure_database_is_current():
    """Fail startup when a configured database has unapplied migrations."""
    if not is_database_configured():
        return False

    expected_heads = set(_get_expected_migration_heads())
    current_heads = set(_get_current_migration_heads())
    if current_heads != expected_heads:
        current_label = ", ".join(sorted(current_heads)) or "none"
        expected_label = ", ".join(sorted(expected_heads)) or "none"
        raise RuntimeError(
            "Database schema is not current "
            f"(current: {current_label}; expected: {expected_label}). "
            "Run 'python -m alembic upgrade head' before starting the backend. "
            "For a pre-Alembic database, run "
            "'python -m backend.migrations.adopt_legacy_database' first."
        )

    return True


def get_engine():
    global _engine

    if _engine is None:
        if not DATABASE_URL:
            raise RuntimeError("Database connection is not configured.")

        _engine = create_engine(
            DATABASE_URL,
            pool_pre_ping=True,
        )

    return _engine


def get_session_factory():
    global _session_factory

    if _session_factory is None:
        _session_factory = sessionmaker(
            bind=get_engine(),
            autoflush=False,
            autocommit=False,
        )

    return _session_factory


@contextmanager
def db_session():
    session = get_session_factory()()

    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
