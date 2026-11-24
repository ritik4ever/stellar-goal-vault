#!/bin/bash

# Deploy Stellar Goal Vault contract to Stellar testnet or mainnet
# 
# Required environment variables:
#   SECRET_KEY - Stellar account secret key for deployment (starts with 'S', 56 chars)
#
# Optional environment variables:
#   NETWORK - Target network: testnet (default), mainnet, futurenet, standalone
#   NETWORK_PASSPHRASE - Network passphrase (defaults according to NETWORK)
#   RPC_URL - RPC endpoint URL (defaults according to NETWORK)
#
# Usage:
#   SECRET_KEY="S..." ./scripts/deploy.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
CONTRACTS_DIR="contracts"
CONTRACT_ID_FILE="contract_id.txt"
RAW_NETWORK="${NETWORK:-testnet}"
NETWORK="$(echo "$RAW_NETWORK" | tr '[:upper:]' '[:lower:]')"
if [ "$NETWORK" = "public" ]; then
    NETWORK="mainnet"
fi

TESTNET_PASSPHRASE="Test SDF Network ; September 2015"
MAINNET_PASSPHRASE="Public Global Stellar Network ; September 2015"
FUTURENET_PASSPHRASE="Test SDF Future Network ; October 2022"

# Check for required environment variables and format
if [ -z "$SECRET_KEY" ]; then
    echo -e "${RED}Error: SECRET_KEY environment variable is required${NC}"
    echo "Please set SECRET_KEY to your Stellar account secret key"
    echo "Example: SECRET_KEY=\"S...\" ./scripts/deploy.sh"
    exit 1
fi

if [[ ! "$SECRET_KEY" =~ ^S[A-Z2-7]{55}$ ]]; then
    echo -e "${RED}Error: Invalid SECRET_KEY format${NC}"
    echo "Expected a 56-character Stellar secret key starting with 'S' (base32)"
    exit 1
fi

# Validate network, passphrase, and RPC endpoint alignment
case "$NETWORK" in
  testnet)
    if [ -z "$NETWORK_PASSPHRASE" ]; then
      NETWORK_PASSPHRASE="$TESTNET_PASSPHRASE"
    elif [ "$NETWORK_PASSPHRASE" = "$MAINNET_PASSPHRASE" ]; then
      echo -e "${RED}Error: Network mismatch - testnet selected but mainnet passphrase provided${NC}"
      exit 1
    fi
    if [ -z "$RPC_URL" ]; then
      RPC_URL="https://soroban-testnet.stellar.org:443"
    elif [[ "$RPC_URL" == *"mainnet"* ]] || [[ "$RPC_URL" == *"publicnode"* ]]; then
      echo -e "${RED}Error: Network mismatch - testnet selected but mainnet RPC URL provided${NC}"
      exit 1
    fi
    ;;
  mainnet)
    if [ -z "$NETWORK_PASSPHRASE" ]; then
      NETWORK_PASSPHRASE="$MAINNET_PASSPHRASE"
    elif [ "$NETWORK_PASSPHRASE" = "$TESTNET_PASSPHRASE" ]; then
      echo -e "${RED}Error: Network mismatch - mainnet selected but testnet passphrase provided${NC}"
      exit 1
    fi
    if [ -z "$RPC_URL" ]; then
      RPC_URL="https://soroban-rpc.mainnet.stellar.org:443"
    elif [[ "$RPC_URL" == *"testnet"* ]]; then
      echo -e "${RED}Error: Network mismatch - mainnet selected but testnet RPC URL provided${NC}"
      exit 1
    fi
    ;;
  futurenet)
    if [ -z "$NETWORK_PASSPHRASE" ]; then
      NETWORK_PASSPHRASE="$FUTURENET_PASSPHRASE"
    elif [ "$NETWORK_PASSPHRASE" = "$MAINNET_PASSPHRASE" ] || [ "$NETWORK_PASSPHRASE" = "$TESTNET_PASSPHRASE" ]; then
      echo -e "${RED}Error: Network mismatch - futurenet selected with conflicting passphrase${NC}"
      exit 1
    fi
    if [ -z "$RPC_URL" ]; then
      RPC_URL="https://rpc-futurenet.stellar.org:443"
    fi
    ;;
  standalone|local)
    if [ -z "$NETWORK_PASSPHRASE" ]; then
      NETWORK_PASSPHRASE="Standalone Network ; February 2017"
    fi
    if [ -z "$RPC_URL" ]; then
      RPC_URL="http://localhost:8000/soroban/rpc"
    fi
    ;;
  *)
    echo -e "${RED}Error: Unsupported NETWORK \"$RAW_NETWORK\". Expected testnet, mainnet, or futurenet.${NC}"
    exit 1
    ;;
esac

# Check if soroban-cli is installed
if ! command -v soroban &> /dev/null; then
    echo -e "${RED}Error: soroban-cli is not installed${NC}"
    echo "Please install it from: https://soroban.stellar.org/docs/getting-started/setup#install-the-soroban-cli"
    exit 1
fi

echo -e "${GREEN}Starting contract deployment...${NC}"
echo "Network: $NETWORK"
echo "Passphrase: $NETWORK_PASSPHRASE"
echo "RPC URL: $RPC_URL"
echo ""

# Change to contracts directory
cd "$CONTRACTS_DIR" || exit 1

# Build the contract
echo -e "${YELLOW}Building contract...${NC}"
soroban contract build

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Contract build failed${NC}"
    exit 1
fi

echo -e "${GREEN}Contract built successfully${NC}"
echo ""

# Deploy the contract
echo -e "${YELLOW}Deploying contract to $NETWORK...${NC}"

# Capture both stdout and stderr, but check exit code separately
DEPLOY_OUTPUT=$(soroban contract deploy \
    --wasm target/wasm32v1-none/release/stellar_goal_vault.wasm \
    --source-account "$SECRET_KEY" \
    --network "$NETWORK" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --rpc-url "$RPC_URL" \
    2>&1)
DEPLOY_EXIT_CODE=$?

if [ $DEPLOY_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}Error: Contract deployment failed${NC}"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi

# Extract contract ID (soroban-cli outputs it directly, may have whitespace)
CONTRACT_ID=$(echo "$DEPLOY_OUTPUT" | grep -oE '[A-Z0-9]{56}' | head -n 1)

# If no 56-char match found, try trimming whitespace from the output
if [ -z "$CONTRACT_ID" ]; then
    CONTRACT_ID=$(echo "$DEPLOY_OUTPUT" | tr -d '[:space:]')
fi

# Validate contract ID format (Stellar contract IDs are 56 characters starting with C)
if [[ ! "$CONTRACT_ID" =~ ^C[A-Z2-7]{55}$ ]]; then
    echo -e "${RED}Error: Invalid contract ID format${NC}"
    echo "Expected a 56-character Soroban contract ID starting with 'C' (base32)"
    echo "Output was: $DEPLOY_OUTPUT"
    exit 1
fi

# Save contract ID to file
echo "$CONTRACT_ID" > "$CONTRACT_ID_FILE"

# Return to root directory
cd ..

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Contract deployed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Contract ID: ${YELLOW}$CONTRACT_ID${NC}"
echo -e "Saved to: ${YELLOW}$CONTRACTS_DIR/$CONTRACT_ID_FILE${NC}"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "1. Set CONTRACT_ID=$CONTRACT_ID in your backend .env file"
echo "2. Ensure SERVER_PRIVATE_KEY is set in your backend .env file"
echo "3. Restart your backend service"
echo ""
