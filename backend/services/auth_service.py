import base64
import hashlib
import hmac
import json
import secrets
import time

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from backend.constants import (
    ACCESS_TOKEN_EXPIRE_HOURS,
    ACCESS_TOKEN_VERSION,
    HASH_ALGORITHM,
    HASH_ITERATIONS,
    SALT_BYTES,
)
from backend.core.config import get_auth_settings
from backend.database import db_session, is_database_configured
from backend.models import AppUser
from backend.services.event_logger import log_event


def create_user(username, password):
    clean_username = normalize_username(username)

    if not is_database_configured():
        log_auth_event(
            "register_failed",
            clean_username,
            level="WARNING",
            reason="database_not_configured",
        )
        return {
            "status": "failure",
            "status_code": 503,
            "error": "Database is not configured.",
        }

    try:
        with db_session() as session:
            user = AppUser(
                username=clean_username,
                password_hash=hash_password(password),
            )
            session.add(user)
            session.flush()
            row = user_record(user)

        log_auth_event(
            "user_registered",
            row["username"],
            user_id=str(row["id"]),
        )
        return {
            "status": "success",
            "user": serialize_user(row),
            "access_token": create_access_token(row),
            "token_type": "bearer",
        }

    except IntegrityError:
        log_auth_event(
            "register_failed",
            clean_username,
            level="WARNING",
            reason="username_exists",
        )
        return {
            "status": "failure",
            "status_code": 409,
            "error": "Username already exists.",
        }

    except SQLAlchemyError:
        log_auth_event(
            "register_failed",
            clean_username,
            level="ERROR",
            reason="database_error",
        )
        return {
            "status": "failure",
            "status_code": 500,
            "error": "Failed to create user.",
        }


def login_user(username, password):
    clean_username = normalize_username(username)

    if not is_database_configured():
        log_auth_event(
            "login_failed",
            clean_username,
            level="WARNING",
            reason="database_not_configured",
        )
        return {
            "status": "failure",
            "status_code": 503,
            "error": "Database is not configured.",
        }

    try:
        with db_session() as session:
            user = session.scalar(
                select(AppUser).where(
                    func.lower(AppUser.username) == clean_username.lower()
                )
            )

            if (
                user is None
                or not user.is_active
                or not verify_password(password, user.password_hash)
            ):
                log_auth_event(
                    "login_failed",
                    clean_username,
                    level="WARNING",
                    reason="invalid_credentials",
                )
                return invalid_login()

            row = user_record(user)
            user.last_login_at = func.now()

        log_auth_event(
            "login_success",
            row["username"],
            user_id=str(row["id"]),
        )
        return {
            "status": "success",
            "user": serialize_user(row),
            "access_token": create_access_token(row),
            "token_type": "bearer",
        }

    except SQLAlchemyError:
        log_auth_event(
            "login_failed",
            clean_username,
            level="ERROR",
            reason="database_error",
        )
        return {
            "status": "failure",
            "status_code": 500,
            "error": "Failed to login.",
        }


def normalize_username(username):
    return username.strip()


def log_auth_event(event, username, level="INFO", **data):
    log_event(
        event,
        level=level,
        data={
            "username": username,
            **data,
        },
    )


def hash_password(password):
    salt = secrets.token_bytes(SALT_BYTES)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        HASH_ITERATIONS,
    )

    return "$".join(
        [
            HASH_ALGORITHM,
            str(HASH_ITERATIONS),
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(password_hash).decode("ascii"),
        ]
    )


def verify_password(password, encoded_hash):
    try:
        algorithm, iterations, salt, expected_hash = encoded_hash.split("$", 3)

        if algorithm != HASH_ALGORITHM:
            return False

        actual_hash = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            base64.b64decode(salt.encode("ascii")),
            int(iterations),
        )

        return hmac.compare_digest(
            base64.b64encode(actual_hash).decode("ascii"),
            expected_hash,
        )
    except (ValueError, TypeError):
        return False


def create_access_token(row):
    now = int(time.time())
    payload = {
        "version": ACCESS_TOKEN_VERSION,
        "sub": str(row["id"]),
        "username": row["username"],
        "iat": now,
        "exp": now + ACCESS_TOKEN_EXPIRE_HOURS * 60 * 60,
    }
    encoded_payload = base64url_encode(
        json.dumps(
            payload,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    )
    signature = sign_token_payload(encoded_payload)

    return f"{encoded_payload}.{signature}"


def authenticate_access_token(token):
    payload = decode_access_token(token)

    if payload is None:
        return invalid_token()

    if not is_database_configured():
        return {
            "status": "failure",
            "status_code": 503,
            "error": "Database is not configured.",
        }

    try:
        with db_session() as session:
            user = session.get(AppUser, payload["sub"])
            row = user_record(user) if user else None

        if row is None or not row["is_active"]:
            return invalid_token()

        return {
            "status": "success",
            "user": serialize_user(row),
        }

    except SQLAlchemyError:
        return {
            "status": "failure",
            "status_code": 500,
            "error": "Failed to authenticate request.",
        }


def decode_access_token(token):
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
    except ValueError:
        return None

    expected_signature = sign_token_payload(encoded_payload)
    if not hmac.compare_digest(encoded_signature, expected_signature):
        return None

    try:
        payload = json.loads(base64url_decode(encoded_payload).decode("utf-8"))
    except (ValueError, TypeError, UnicodeDecodeError):
        return None

    if payload.get("version") != ACCESS_TOKEN_VERSION:
        return None

    if not payload.get("sub") or not payload.get("username"):
        return None

    try:
        expires_at = int(payload.get("exp", 0))
    except (TypeError, ValueError):
        return None

    if expires_at < int(time.time()):
        return None

    return payload


def sign_token_payload(encoded_payload):
    digest = hmac.new(
        get_auth_settings().secret_key.encode("utf-8"),
        encoded_payload.encode("ascii"),
        hashlib.sha256,
    ).digest()

    return base64url_encode(digest)


def base64url_encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def base64url_decode(value):
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def invalid_login():
    return {
        "status": "failure",
        "status_code": 401,
        "error": "Invalid username or password.",
    }


def invalid_token():
    return {
        "status": "failure",
        "status_code": 401,
        "error": "Invalid or expired access token.",
    }


def serialize_user(row):
    return {
        "id": str(row["id"]),
        "username": row["username"],
        "created_at": row["created_at"].isoformat()
        if row["created_at"]
        else None,
    }


def user_record(user):
    return {
        "id": user.id,
        "username": user.username,
        "password_hash": user.password_hash,
        "is_active": user.is_active,
        "created_at": user.created_at,
    }
