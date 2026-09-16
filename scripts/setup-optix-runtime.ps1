$ErrorActionPreference = "Stop"

$runtimePath = Join-Path $PSScriptRoot "..\.optix-driver"
New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null
$runtimeRoot = (Resolve-Path $runtimePath).Path
docker run --rm `
  -v "${runtimeRoot}:/work" `
  ubuntu:24.04 `
  bash -lc "apt-get update -qq && apt-get install -y -qq wget dpkg >/dev/null && rm -rf /work/extracted && mkdir -p /work/extracted && for pkg in libnvoptix1_595.71.05-1_amd64.deb libnvidia-rtcore_595.71.05-1_amd64.deb libnvidia-gpucomp_595.71.05-1_amd64.deb libnvidia-ptxjitcompiler1_595.71.05-1_amd64.deb; do wget -q --show-progress https://developer.download.nvidia.com/compute/cuda/repos/debian13/x86_64/`$pkg -O /work/`$pkg && dpkg-deb -x /work/`$pkg /work/extracted; done"

Write-Host "OptiX runtime extracted to $runtimeRoot"
