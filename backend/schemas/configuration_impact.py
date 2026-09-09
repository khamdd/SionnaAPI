from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ImpactProfilePairRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    baseline_profile_id: UUID
    candidate_profile_id: UUID


class ConfigurationImpactPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    baseline_configuration_id: UUID
    candidate_configuration_id: UUID
    profile_pairs: list[ImpactProfilePairRequest] = Field(
        min_length=1,
        max_length=20,
    )

    @model_validator(mode="after")
    def require_different_versions(self):
        if self.baseline_configuration_id == self.candidate_configuration_id:
            raise ValueError("baseline and candidate configurations must be different")
        pairs = [
            (pair.baseline_profile_id, pair.candidate_profile_id)
            for pair in self.profile_pairs
        ]
        if len(pairs) != len(set(pairs)):
            raise ValueError("profile pairs must be unique")
        return self
