# Pistols at Dawn Agent

This is an AI agent that plays Pistols at Dawn, a dueling game on the Starknet blockchain. The agent, named Tinman, is a villainous duelist that autonomously participates in duels against other players.

## About Pistols at Dawn

Pistols at Dawn is a 1v1 turn-based game on the Starknet blockchain where players challenge each other to duels. Each duel consists of players selecting and committing moves, then revealing them to determine the outcome. The game features:

- Shoot and Dodge cards with timing mechanics (steps 1-10)
- Tactic cards for buffs and debuffs
- Blade cards with a rock-paper-scissors system
- ERC-721 tokens for Duelists and Challenges

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
export ANTHROPIC_API_KEY=your_anthropic_api_key
export PISTOLS_GRAPHQL_URL=https://pistols-graphql-endpoint.com
export STARKNET_RPC_URL=your_starknet_rpc_url
export STARKNET_ADDRESS=your_starknet_wallet_address
export STARKNET_PRIVATE_KEY=your_starknet_private_key
export DEFAULT_NETWORK_ID=your_network_id
export DISCORD_TOKEN=your_discord_token
export LORDS_TOKEN_ADDRESS=your_lords_token_address
```

3. Run the agent:
```bash
npm start
```

## Agent Capabilities

The agent implements several key flows:

### Registration Flow
- Fetch player state
- Claim starter pack of duelists

### Challenge Management
- Create new challenges to other players
- Accept incoming challenges
- Monitor active challenges

### Dueling System
- Analyze past duel history for strategy
- Get available cards for duels
- Commit moves with secure hashing
- Reveal moves at the appropriate time

### Pack Management
- Open duelist packs
- Track owned duelists and packs

## Technical Features

### GraphQL Integration
- Player state queries
- Challenge tracking
- Duelist and pack management
- Round and move history

### Starknet Integration
- Direct blockchain interaction
- Transaction signing and submission
- Smart contract calls for game actions
- State reading and verification

### State Management
- Tracks active challenges
- Maintains duelist inventory
- Stores committed moves securely
- Caches duelist data

## Agent Behavior

The agent follows these principles:
- Never refuses challenges
- Continuously monitors for new challenges
- Analyzes past duels to improve strategy
- Varies move selection to be unpredictable
- Maintains villainous character in interactions

## Code Structure

- `example-pistols.ts`: Main agent implementation
  - Action handlers for all game interactions
  - GraphQL query definitions
  - State management interfaces
  - Starknet transaction handling

## Available Actions

1. `fetch_player_state`: Get current player status
2. `claim_starter_pack`: Claim initial duelists
3. `open_pack`: Open duelist packs
4. `fetch_challenges`: Monitor active and past challenges
5. `accept_challenge`: Accept incoming duels
6. `create_challenge`: Challenge other players
7. `get_duel_cards`: Retrieve available cards for a duel
8. `commit_moves`: Submit encrypted moves
9. `reveal_moves`: Reveal previously committed moves
10. `get_available_duelists`: Find duelists to challenge
11. `analyze_duel_history`: Study past duels for strategy

## Future Enhancements

- Enhanced strategy analysis
- More sophisticated move selection
- Better opponent profiling
- Advanced state tracking
- Improved error handling and recovery

## Notes

This agent is a fully functional autonomous player in the Pistols at Dawn game, capable of participating in duels, managing challenges, and learning from past experiences to improve its strategy. 