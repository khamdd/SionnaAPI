"""Shared schema-comparison configuration for Alembic tooling."""

from sqlalchemy.dialects.postgresql.base import ischema_names

from backend.models import Geography, Geometry

UNMANAGED_TABLE_NAMES = frozenset(
    {
        "alembic_version",
        "spatial_ref_sys",
    }
)


class ReflectedGeometry(Geometry):
    """Geometry type that accepts PostgreSQL reflection arguments."""

    def __init__(self, *type_arguments, **kwargs):
        self.type_arguments = tuple(type_arguments)

    def get_col_spec(self, **kw):
        if self.type_arguments:
            arguments = ",".join(str(value) for value in self.type_arguments)
            return f"geometry({arguments})"
        return "geometry"


class ReflectedGeography(Geography):
    """Geography type that accepts PostgreSQL reflection arguments."""

    def __init__(self, *type_arguments, **kwargs):
        self.type_arguments = tuple(type_arguments)

    def get_col_spec(self, **kw):
        if self.type_arguments:
            arguments = ",".join(str(value) for value in self.type_arguments)
            return f"geography({arguments})"
        return "geography"


def configure_postgresql_reflection() -> None:
    """Teach SQLAlchemy reflection about the project's lightweight PostGIS types."""
    ischema_names["geometry"] = ReflectedGeometry
    ischema_names["geography"] = ReflectedGeography


def set_application_search_path(connection) -> None:
    """Restrict migration inspection and DDL to the public application schema."""
    connection.exec_driver_sql("SET search_path TO public")
    # SQLAlchemy 2 starts a transaction for SET. End that transaction so
    # Alembic can own and commit the migration transaction that follows.
    connection.commit()


def include_name(name: str | None, type_: str, parent_names: dict) -> bool:
    """Exclude tables owned by Alembic or installed database extensions."""
    if type_ == "table":
        return name not in UNMANAGED_TABLE_NAMES
    return True
