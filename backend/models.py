from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
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
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class NetworkConfiguration(Base):
    __tablename__ = "network_configurations"
    __table_args__ = (
        UniqueConstraint(
            "scene_id",
            "version",
            name="uq_network_configurations_scene_version",
        ),
        CheckConstraint(
            "status IN ('draft', 'published', 'superseded')",
            name="ck_network_configurations_status",
        ),
        CheckConstraint(
            "source IN ('manual', 'file', 'external_api')",
            name="ck_network_configurations_source",
        ),
        Index(
            "ix_network_configurations_scene_status",
            "scene_id",
            "status",
        ),
        Index(
            "ix_network_configurations_content_hash",
            "content_hash",
        ),
        Index(
            "uq_network_configurations_one_published_per_scene",
            "scene_id",
            unique=True,
            postgresql_where=text("status = 'published'"),
        ),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    scene_id: Mapped[str] = mapped_column(
        ForeignKey("scenes.id", ondelete="RESTRICT")
    )
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text, default="draft")
    parent_configuration_id: Mapped[str | None] = mapped_column(
        ForeignKey("network_configurations.id", ondelete="RESTRICT"),
        nullable=True,
    )
    source: Mapped[str] = mapped_column(Text, default="manual")
    source_reference: Mapped[str | None] = mapped_column(Text, nullable=True)
    antennas_json: Mapped[list[dict]] = mapped_column(JSONB)
    content_hash: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(
        ForeignKey("app_users.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class SimulationProfile(Base):
    __tablename__ = "simulation_profiles"
    __table_args__ = (
        UniqueConstraint(
            "scene_id",
            "created_by",
            "name",
            name="uq_simulation_profiles_owner_scene_name",
        ),
        CheckConstraint(
            "simulation_type IN ("
            "'network_coverage', 'coverage_map', 'rsrp_simulation', "
            "'sinr', 'throughput_comparison'"
            ")",
            name="ck_simulation_profiles_type",
        ),
        Index(
            "ix_simulation_profiles_scene_type_enabled",
            "scene_id",
            "simulation_type",
            "enabled",
        ),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    scene_id: Mapped[str] = mapped_column(
        ForeignKey("scenes.id", ondelete="RESTRICT")
    )
    name: Mapped[str] = mapped_column(Text)
    simulation_type: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    request_template_json: Mapped[dict] = mapped_column(JSONB)
    created_by: Mapped[str] = mapped_column(
        ForeignKey("app_users.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


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
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    scene_id: Mapped[str] = mapped_column(
        ForeignKey("scenes.id", ondelete="RESTRICT"),
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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    simulation_run: Mapped[SimulationRun] = relationship(back_populates="artifacts")


class ImpactStudy(Base):
    __tablename__ = "impact_studies"
    __table_args__ = (
        CheckConstraint(
            "status IN ("
            "'planned', 'queued', 'running', 'aggregating', 'completed', "
            "'completed_with_failures', 'cancelled', 'failed'"
            ")",
            name="ck_impact_studies_status",
        ),
        Index("ix_impact_studies_creator_created", "created_by", "created_at"),
        Index("ix_impact_studies_scene_status", "scene_id", "status"),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    scene_id: Mapped[str] = mapped_column(
        ForeignKey("scenes.id", ondelete="RESTRICT")
    )
    baseline_configuration_id: Mapped[str] = mapped_column(
        ForeignKey("network_configurations.id", ondelete="RESTRICT")
    )
    candidate_configuration_id: Mapped[str] = mapped_column(
        ForeignKey("network_configurations.id", ondelete="RESTRICT")
    )
    policy_version: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="planned")
    difference_json: Mapped[dict] = mapped_column(JSONB)
    execution_plan_json: Mapped[dict] = mapped_column(JSONB)
    summary_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    report_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(
        ForeignKey("app_users.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    jobs: Mapped[list["SimulationJob"]] = relationship(
        back_populates="impact_study",
        passive_deletes=True,
    )


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "impact_study_id",
            name="uq_notifications_user_impact_study",
        ),
        CheckConstraint(
            "event_type IN ("
            "'impact_study_completed', "
            "'impact_study_completed_with_failures', "
            "'impact_study_failed', "
            "'impact_study_needs_review'"
            ")",
            name="ck_notifications_event_type",
        ),
        Index(
            "ix_notifications_user_unread_created",
            "user_id",
            "is_read",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("app_users.id", ondelete="CASCADE")
    )
    impact_study_id: Mapped[str] = mapped_column(
        ForeignKey("impact_studies.id", ondelete="CASCADE")
    )
    event_type: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    message: Mapped[str] = mapped_column(Text)
    payload_json: Mapped[dict] = mapped_column(JSONB)
    is_read: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=text("false"),
    )
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class SimulationJob(Base):
    __tablename__ = "simulation_jobs"
    __table_args__ = (
        UniqueConstraint(
            "impact_study_id",
            "simulation_profile_id",
            "scenario_role",
            name="uq_simulation_jobs_impact_profile_role",
        ),
        CheckConstraint(
            "scenario_role IS NULL OR scenario_role IN ("
            "'baseline', 'candidate', 'optimization'"
            ")",
            name="ck_simulation_jobs_scenario_role",
        ),
        CheckConstraint(
            "max_attempts >= 1",
            name="ck_simulation_jobs_max_attempts",
        ),
        Index("ix_simulation_jobs_impact_status", "impact_study_id", "status"),
        Index("ix_simulation_jobs_input_signature", "input_signature"),
        Index(
            "ix_simulation_jobs_claimable",
            "status",
            "next_attempt_at",
            "priority",
        ),
        Index("ix_simulation_jobs_expired_lease", "status", "lease_expires_at"),
    )

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
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    next_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    worker_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    failure_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    impact_study_id: Mapped[str | None] = mapped_column(
        ForeignKey("impact_studies.id", ondelete="CASCADE"),
        nullable=True,
    )
    simulation_profile_id: Mapped[str | None] = mapped_column(
        ForeignKey("simulation_profiles.id", ondelete="RESTRICT"),
        nullable=True,
    )
    scenario_role: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_signature: Mapped[str | None] = mapped_column(Text, nullable=True)
    queued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    result_run: Mapped[SimulationRun | None] = relationship(back_populates="jobs")
    impact_study: Mapped[ImpactStudy | None] = relationship(back_populates="jobs")
