$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$testImage = "sionna-simulation-backend-test:local"

Push-Location $projectRoot
try {
    docker build --target test --tag $testImage --file Dockerfile.backend .
    if ($LASTEXITCODE -ne 0) {
        throw "Backend test image build failed with exit code $LASTEXITCODE."
    }

    docker run --rm $testImage
    if ($LASTEXITCODE -ne 0) {
        throw "Backend test suite failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
