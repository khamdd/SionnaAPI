from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import UserDefinedType


class Base(DeclarativeBase):
    pass


class Geometry(UserDefinedType):
    """Minimal PostGIS type mapping used without a GeoAlchemy dependency."""

    cache_ok = True

    def get_col_spec(self, **kw):
        return "geometry"


class Geography(UserDefinedType):
    cache_ok = True

    def get_col_spec(self, **kw):
        return "geography"


class AppUser(Base):
    __tablename__ = "app_users"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    username: Mapped[str] = mapped_column(Text, unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[object | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime, server_default=func.now())


class Scene(Base):
    __tablename__ = "scenes"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="ready")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    bounds_geom: Mapped[object | None] = mapped_column(Geometry, nullable=True)
    bounds_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    metrics_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    scene_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    preview_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[object] = mapped_column(DateTime, server_default=func.now())


class SimulationRun(Base):
    __tablename__ = "simulation_runs"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    simulation_type: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    transmitter_pattern: Mapped[str] = mapped_column(Text, default="tr38901")
    max_depth: Mapped[int] = mapped_column(Integer)
    samples_per_tx: Mapped[int] = mapped_column(Integer)
    cell_size_m: Mapped[float] = mapped_column(Float)
    center_position: Mapped[object] = mapped_column(Geometry)
    area_geom: Mapped[object] = mapped_column(Geometry)
    bandwidth_mhz: Mapped[float | None] = mapped_column(Float, nullable=True)
    mimo_layers: Mapped[int | None] = mapped_column(Integer, nullable=True)
    request_json: Mapped[dict] = mapped_column(JSONB)
    response_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    coverage_map_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[object | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[object | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime, server_default=func.now())
    scene_id: Mapped[str] = mapped_column(
        ForeignKey("scenes.id", ondelete="RESTRICT"),
        default="munich",
    )

    antennas: Mapped[list["SimulationRunAntenna"]] = relationship(
        back_populates="simulation_run",
        passive_deletes=True,
    )
    artifacts: Mapped[list["SimulationArtifact"]] = relationship(
        back_populates="simulation_run",
        passive_deletes=True,
    )
    jobs: Mapped[list["SimulationJob"]] = relationship(
        back_populates="result_run",
        passive_deletes=True,
    )


class SimulationRunAntenna(Base):
    __tablename__ = "simulation_run_antennas"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    simulation_run_id: Mapped[str] = mapped_column(
        ForeignKey("simulation_runs.id", ondelete="CASCADE")
    )
    antenna_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    antenna_code: Mapped[str] = mapped_column(Text)
    gps_location: Mapped[object | None] = mapped_column(Geography, nullable=True)
    scene_position: Mapped[object] = mapped_column(Geometry)
    azimuth_deg: Mapped[float] = mapped_column(Float)
    tilt_min_deg: Mapped[float] = mapped_column(Float)
    tilt_current_deg: Mapped[float] = mapped_column(Float)
    tilt_max_deg: Mapped[float] = mapped_column(Float)
    tx_power_min_dbm: Mapped[float] = mapped_column(Float)
    tx_power_current_dbm: Mapped[float] = mapped_column(Float)
    tx_power_max_dbm: Mapped[float] = mapped_column(Float)

    simulation_run: Mapped[SimulationRun] = relationship(back_populates="antennas")


class SimulationArtifact(Base):
    __tablename__ = "simulation_artifacts"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    simulation_run_id: Mapped[str] = mapped_column(
        ForeignKey("simulation_runs.id", ondelete="CASCADE")
    )
    artifact_type: Mapped[str] = mapped_column(Text)
    file_path: Mapped[str] = mapped_column(Text)
    public_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime, server_default=func.now())
    expires_at: Mapped[object | None] = mapped_column(DateTime, nullable=True)

    simulation_run: Mapped[SimulationRun] = relationship(back_populates="artifacts")


class SimulationJob(Base):
    __tablename__ = "simulation_jobs"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    simulation_type: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="queued")
    scene_json: Mapped[dict] = mapped_column(JSONB)
    request_json: Mapped[dict] = mapped_column(JSONB)
    result_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    result_run_id: Mapped[str | None] = mapped_column(
        ForeignKey("simulation_runs.id", ondelete="CASCADE"),
        nullable=True,
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    queued_at: Mapped[object] = mapped_column(DateTime, server_default=func.now())
    started_at: Mapped[object | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[object | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[object] = mapped_column(DateTime, server_default=func.now())

    result_run: Mapped[SimulationRun | None] = relationship(back_populates="jobs")
