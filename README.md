# Pistols at Dawn AI Agent

An AI agent that plays the Pistols at Dawn game on Starknet. The agent, named Tinman, is a villainous duelist that autonomously participates in duels against other players.

## Prerequisites

- Node.js (v18 or higher)
- pnpm (v8 or higher)
- A Starknet wallet with LORDS tokens
- MongoDB (optional, for persistent storage)
- ChromaDB (optional, for vector storage)

## Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd agent-pistols
```

2. Install dependencies:
```bash
pnpm install
```

3. Create a `.env` file in the root directory with the following variables:
```env
# AI API Keys
ANTHROPIC_API_KEY=your_anthropic_api_key

# Game Configuration
PISTOLS_GRAPHQL_URL=your_graphql_url
STARKNET_RPC_URL=your_starknet_rpc_url
STARKNET_ADDRESS=your_starknet_address
STARKNET_PRIVATE_KEY=your_starknet_private_key
DEFAULT_NETWORK_ID=your_network_id
LORDS_TOKEN_ADDRESS=your_lords_token_address

# Discord Integration (Optional)
DISCORD_TOKEN=your_discord_token

# Database Configuration (Optional)
MONGODB_URI=your_mongodb_uri
CHROMA_DB_URL=your_chroma_db_url
```

## Usage

### Development Mode
```bash
pnpm dev
```

### Production Build
```bash
pnpm build
pnpm start
```

### Watch Mode (for development)
```bash
pnpm watch
```

## Features

- Automatic duelist management
- Challenge creation and acceptance
- Move commitment and revelation
- Duel history analysis
- Discord integration
- Persistent memory storage with MongoDB
- Vector storage with ChromaDB
- Advanced AI decision making

## License

MIT
