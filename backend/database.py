import os
from contextlib import contextmanager

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

_engine = None
_session_factory = None


def is_database_configured():
    return bool(DATABASE_URL)


def get_engine():
    global _engine

    if _engine is None:
        if not DATABASE_URL:
            raise RuntimeError("DATABASE_URL is not configured.")

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
