from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SimulationType = Literal[
    "network_coverage",
    "coverage_map",
    "rsrp_simulation",
    "sinr",
    "throughput_comparison",
]


class SimulationProfileCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_id: str = Field(min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=120)
    simulation_type: SimulationType
    enabled: Literal[False] = False
    request_template: dict[str, Any] = Field(default_factory=dict)

    @field_validator("scene_id", "name")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value cannot be empty")
        return normalized


class SimulationProfileUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    simulation_type: SimulationType | None = None
    request_template: dict[str, Any] | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("name cannot be empty")
        return normalized

    @model_validator(mode="after")
    def require_at_least_one_change(self):
        if not self.model_fields_set:
            raise ValueError("at least one profile field must be provided")
        for field_name in self.model_fields_set:
            if getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self


class SimulationProfileBuildRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    configuration_id: UUID


class SimulationProfileEnableRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    configuration_id: UUID
