import os
from contextlib import contextmanager

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import sessionmaker


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


def is_database_configured():
    return bool(DATABASE_URL)


def initialize_database():
    """Create missing application tables in a new Docker database."""
    if not is_database_configured():
        return False

    from backend.models import Base

    Base.metadata.create_all(bind=get_engine())
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
