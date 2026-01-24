#!/bin/bash
# Arcium MPC Integration Test Runner
# Usage: ./scripts/test-arcium.sh [mode]
# Modes: mock (default), live

set -e

MODE=${1:-mock}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "==================================="
echo "Arcium MPC Integration Tests"
echo "Mode: $MODE"
echo "==================================="

if [ "$MODE" = "live" ]; then
    echo ""
    echo "Running LIVE tests against Arcium cluster..."
    echo ""

    # Check required environment variables
    if [ -z "$ENCRYPTION_MASTER_KEY" ]; then
        echo "Error: ENCRYPTION_MASTER_KEY is required for live tests"
        echo "Generate with: openssl rand -hex 32"
        exit 1
    fi

    if [ -z "$ARCIUM_PROGRAM_ID" ]; then
        echo "Error: ARCIUM_PROGRAM_ID is required for live tests"
        exit 1
    fi

    if [ -z "$ARCIUM_CLUSTER_ADDRESS" ]; then
        echo "Warning: ARCIUM_CLUSTER_ADDRESS not set, using default"
        export ARCIUM_CLUSTER_ADDRESS="https://mpc.arcium.network"
    fi

    export ARCIUM_TEST_MODE=live
    pnpm vitest run arcium-integration --reporter=verbose
else
    echo ""
    echo "Running MOCK tests (no cluster connection)..."
    echo ""

    # Use test defaults
    export ENCRYPTION_MASTER_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    export ARCIUM_PROGRAM_ID="test-program-id"
    export ARCIUM_CALLBACK_SECRET="test-callback-secret-32-chars-ok"
    export ARCIUM_TEST_MODE=mock

    pnpm vitest run arcium-integration --reporter=verbose
fi

echo ""
echo "==================================="
echo "Tests completed!"
echo "==================================="
