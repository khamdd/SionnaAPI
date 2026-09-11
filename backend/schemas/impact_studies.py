from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.schemas.requests import OptimizationVariable


class ImpactStudyOptimizationPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["disabled", "if_objectives_fail"] = "disabled"
    tilt_step: float = Field(default=2.0, gt=0, le=20, allow_inf_nan=False)
    power_step: float = Field(default=2.0, gt=0, le=20, allow_inf_nan=False)
    azimuth_step: float = Field(default=30.0, gt=0, le=180, allow_inf_nan=False)
    max_candidates: int = Field(default=300, ge=1, le=5000)
    variables: list[OptimizationVariable] = Field(
        default_factory=lambda: [
            OptimizationVariable(field="tilt"),
            OptimizationVariable(field="tx_power"),
            OptimizationVariable(field="azimuth"),
        ],
        min_length=1,
        max_length=3,
    )

    @model_validator(mode="after")
    def require_unique_variables(self):
        fields = [variable.field for variable in self.variables]
        if len(fields) != len(set(fields)):
            raise ValueError("optimization variables must be unique")
        return self


class ImpactStudyCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    baseline_configuration_id: UUID
    candidate_configuration_id: UUID
    optimization_policy: ImpactStudyOptimizationPolicy = Field(
        default_factory=ImpactStudyOptimizationPolicy
    )

    @model_validator(mode="after")
    def require_different_versions(self):
        if self.baseline_configuration_id == self.candidate_configuration_id:
            raise ValueError("baseline and candidate configurations must be different")
        return self
