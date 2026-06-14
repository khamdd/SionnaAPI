import base64
import hashlib
import hmac
import secrets

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from backend.database import db_session, is_database_configured


HASH_ALGORITHM = "pbkdf2_sha256"
HASH_ITERATIONS = 390000
SALT_BYTES = 16


def create_user(username, password):
    if not is_database_configured():
        return {
            "status": "failure",
            "status_code": 503,
            "error": "Database is not configured.",
        }

    clean_username = normalize_username(username)

    try:
        with db_session() as session:
            row = session.execute(
                text(
                    """
                    INSERT INTO app_users (
                        username,
                        password_hash
                    )
                    VALUES (
                        :username,
                        :password_hash
                    )
                    RETURNING
                        id,
                        username,
                        created_at
                    """
                ),
                {
                    "username": clean_username,
                    "password_hash": hash_password(password),
                },
            ).mappings().first()

        return {
            "status": "success",
            "user": serialize_user(row),
        }

    except IntegrityError:
        return {
            "status": "failure",
            "status_code": 409,
            "error": "Username already exists.",
        }

    except SQLAlchemyError:
        return {
            "status": "failure",
            "status_code": 500,
            "error": "Failed to create user.",
        }


def login_user(username, password):
    if not is_database_configured():
        return {
            "status": "failure",
            "status_code": 503,
            "error": "Database is not configured.",
        }

    try:
        with db_session() as session:
            row = session.execute(
                text(
                    """
                    SELECT
                        id,
                        username,
                        password_hash,
                        is_active,
                        created_at
                    FROM app_users
                    WHERE lower(username) = lower(:username)
                    """
                ),
                {
                    "username": normalize_username(username),
                },
            ).mappings().first()

            if (
                row is None
                or not row["is_active"]
                or not verify_password(password, row["password_hash"])
            ):
                return invalid_login()

            session.execute(
                text(
                    """
                    UPDATE app_users
                    SET last_login_at = now()
                    WHERE id = :user_id
                    """
                ),
                {
                    "user_id": row["id"],
                },
            )

        return {
            "status": "success",
            "user": serialize_user(row),
        }

    except SQLAlchemyError:
        return {
            "status": "failure",
            "status_code": 500,
            "error": "Failed to login.",
        }


def normalize_username(username):
    return username.strip()


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


def invalid_login():
    return {
        "status": "failure",
        "status_code": 401,
        "error": "Invalid username or password.",
    }


def serialize_user(row):
    return {
        "id": str(row["id"]),
        "username": row["username"],
        "created_at": row["created_at"].isoformat()
        if row["created_at"]
        else None,
    }
