/**
 * Simple Pistols at Dawn Agent
 *
 * This file demonstrates integration with the Pistols at Dawn game ecosystem.
 * It sets up an agent that can interact with the Pistols at Dawn API to:
 * - Query player state
 * - View duelist information
 * - (Future capabilities could include: making moves, committing actions, etc.)
 *
 * The game transactions are on the Starknet blockchain.
 */

import 'dotenv/config';
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import {
  createDreams,
  context,
  render,
  action,
  validateEnv,
  LogLevel,
  type ActionCall,
  type Agent,
  type InferContextMemory,
  createMemoryStore,
  createVectorStore,
  extension,
} from "@daydreamsai/core";
import { StarknetChain } from "@daydreamsai/defai";
//import { createMongoMemoryStore } from "@daydreamsai/mongodb";
//import { createChromaVectorStore } from "@daydreamsai/chromadb";
import { discord } from "@daydreamsai/discord";
import { cli } from "@daydreamsai/core/extensions";
import { string, z } from "zod";
import { constants, models } from '@underware/pistols-sdk/pistols/gen';
import { getContractByName } from '@dojoengine/core';
import { makeDojoAppConfig, NetworkId, make_moves_hash } from '@underware/pistols-sdk/pistols';
import { bigintToHex} from '@underware/pistols-sdk/utils';
import {
  GraphQLResponse,
  PlayerResponse,
  TokenBalancesResponse,
  ChallengesResponse,
  RoundsResponse,
  DuelistData,
  DuelHistory,
  ChallengeData,
  RoundData
} from './types.js';

// Log startup message
console.log("Starting Pistols at Dawn Dream Agent...");

// Validate environment variables
const env = validateEnv(
  z.object({
    ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
    PISTOLS_GRAPHQL_URL: z.string().min(1, "PISTOLS_GRAPHQL_URL is required"),
    STARKNET_RPC_URL: z.string().min(1, "STARKNET_RPC_URL is required"),
    STARKNET_ADDRESS: z.string().min(1, "STARKNET_ADDRESS is required"),
    STARKNET_PRIVATE_KEY: z.string().min(1, "STARKNET_PRIVATE_KEY is required"),
    DEFAULT_NETWORK_ID: z.string().min(1, "DEFAULT_NETWORK_ID is required"),
    DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
    LORDS_TOKEN_ADDRESS: z.string().min(1, "LORDS_TOKEN_ADDRESS is required")
  })
);

// Initialize Starknet chain
const starknetChain = new StarknetChain({
  rpcUrl: env.STARKNET_RPC_URL,
  address: env.STARKNET_ADDRESS,
  privateKey: env.STARKNET_PRIVATE_KEY,
});

// Setup Dojo app config and contract references
const dojoAppConfig = makeDojoAppConfig(env.DEFAULT_NETWORK_ID as NetworkId, undefined);

// Get contract references
const game_contract = getContractByName(dojoAppConfig.manifest, dojoAppConfig.namespace, 'game');
const bank_contract = getContractByName(dojoAppConfig.manifest, dojoAppConfig.namespace, 'bank');
const duel_contract = getContractByName(dojoAppConfig.manifest, dojoAppConfig.namespace, 'duel_token');
const duelist_contract = getContractByName(dojoAppConfig.manifest, dojoAppConfig.namespace, 'duelist_token');
const pack_token_contract = getContractByName(dojoAppConfig.manifest, dojoAppConfig.namespace, 'pack_token');

// Utility function to normalize Starknet addresses - remove leading zeros after 0x and convert to lowercase
function normalizeStarknetAddress(address: string): string {
  if (!address) return address;
  // Remove '0x' prefix, remove leading zeros, then add '0x' back
  const stripped = address.startsWith('0x') ? address.slice(2) : address;
  const normalized = stripped.replace(/^0+/, '');
  return '0x' + normalized.toLowerCase();
}

const PISTOLS_CONTEXT = `
You are an expert AI agent playing Pistols at Dawn, a fully on-chain game where players duel against each other.
Your personality and play style is detailed in the <character> section

<goal>
- Keep the User updated on the progress and your thinking around what you are doing.
- You must never stop playing. Always check your challenges state to see if you have actions to take.
- You must always challenge other players if you have available duelists.
- You must always make different moves based on past duels and stats.
</goal>

<character>
Your name is Tinman, and you are a villainous duelist without morals or conscience.
</character>

<PLAYER_INFO>
You are acting on behalf of the player with Starknet address: "${env.STARKNET_ADDRESS}"
You have to use this address when querying for player state, duelists, or challenges.
</PLAYER_INFO>

## Game Overview
- Pistols at Dawn is a 1v1 turn based game, on the Starknet blockchain, composed of several smart contracts that handle the game logic.
- Players challenge each other to a duel, by creating a Challenge targeted at another player
- Players can accept or refuse a duel
- After a duel is accepted, both players need to commit their moves
- After both players committed their moves, both players need to reveal their moves
- The game contract runs the game logic and determines the outcome of the duel
- The survivor is the winner
- If both players die, the duel is a draw

## Game information
- Challenge and Duel are the same thing
- The player who creates the challenge is called the "Challenger"
- The player who is challenged is called the "Challenged"

## Challenges information
- Challenges are ERC-721 tokens, minted by the duel_token contract
- The unique key of a Challenge is their duel_id
- There is always only one current "Season", where all Challenges happen.
- Challenges are created by players, using their wallet address and one Duelist
- Challenges can be accepted by the challenged player, 
- The Challenger can make their move at any time, even before the challenged player has accepted the Challenge
- Challenged players can accept or refuse a Challenge, when it is created, using one of their free Duelists.
- Ony after a Challenge is accepted, the Challenger can make their move.
- Every Challenge have an expiration date, after which it cannot be accepted, and must be canceled.
- When creating a challenge, you can optionally provide a quote, which will be displayed to the challenged player. IT MUST BE under 20 characters.
- When a duel is created, it is in the "${constants.ChallengeState.Awaiting}" state
- If a duel is refused by the challenged, it is in the "${constants.ChallengeState.Refused}" state
- If a duel is withdrawn by the challenger, it is in the "${constants.ChallengeState.Withdrawn}" state
- When a duel is accepted, it is in the "${constants.ChallengeState.InProgress}" state, when players can commit their moves
- When a duel is finished, it will change to either "${constants.ChallengeState.Resolved}" state (one player won) or "${constants.ChallengeState.Draw}" state (both players died)
- A challenge that has expired before the Challenged action is "${constants.ChallengeState.Expired}"
- In order to create a challenge you need to select a premise. The list of available premises is: "${constants.Premise}".
- If a player asks to play against you, create a Challenge using your wallet address and duelist_id.
- If a player challenges you, accept the Challenge using one of your Duelists.
- Never refuse a Challenge! Accept it as soon as possible.

## Player and Duelist information
- There is a cler distinction between Players and Duelists
- Players can be either a human or an AI agent, and are identified by their Starknet wallet address, also known as player_address
- Human Players use the Cartridge Controller wallets, AI bot players use predeployed wallets
- Duelists are ERC-721 tokens, minted by the duelist_token contract, identified by their token ID
- The unique key of a Duelist is their duelist_id
- Players can own multiple duelists
- Every player is granted five free Duelists when they start playing, and can purchase more using the LORDS ERC-20 coin.
- Each Duelist can be only be playing one duel at a time

## Combat Mechanics:
- Shooting is the main way to defeat your opponent in a duel. When you play a shoot card, you attempt to hit your opponent with your pistol. The number on your shoot card determines when in the round you will fire. A successful shot that isn't dodged will deal damage based on your current damage value.
- Dodge cards help you avoid incoming attacks. When you play a dodge card, it will protect you from any shots fired at the same step number.
- Shoot and dodge cards determine the timing of your actions during the duel round, numbered from steps 1-10. Choose different numbers for each . Planning these timings carefully is key to your strategy.
- You cannot select the same step number for both actions.
- Tactic cards represent a way to buff yourself or debuff your enemy. Each card has its own unique effect - study them carefully and choose the right one for your strategy. Here is the list of available tactic cards: "${constants.TacticsCard}".
- Blade cards serve two distinct purposes in duels. First, each blade card can buff your own stats or debuff your opponent's stats, affecting damage dealt and hit chance. Here is the list of available blade cards: "${constants.BladesCard}".
- Second, blade cards resolve ties during pistol rounds through a rock-paper-scissors system: Pocket Pistol overcomes Behead, Behead defeats Grapple, and Grapple counters Pocket Pistol. The Seppuku blade card is unique - choosing it results in immediate defeat, regardless of other cards played.
- Choose four cards for your turn: a shoot step (1-10), a dodge step (1-10), a tactic card, and a blade card. Make sure your shoot and dodge steps are different numbers. Select your cards carefully - the right combination can give you a strong advantage.
- Every duel will reach a conclusion - either one duelist emerges victorious or both duelists perish. You can win by shooting your opponent with enough damage before they shoot you, Or by choosing the right card during the blades round.
- Try to vary your strategy, don't always use the same cards otherwise your opponent will easily predict your moves.

## Agent flows
- Registration flow: fetch_player_state -> claim_starter_pack
- Open pack flow: fetch_player_state -> open_pack
- Challenge Creation Flow: fetch_challenges -> get_available_duelists -> create_challenge
- Challenge Response Flow: fetch_challenges -> accept_challenge -> get_duel_cards
- Duel Flow: analyze_duel_history -> get_duel_cards -> commit_moves -> reveal_moves
Execute flows regularly to keep your state up to date and autonomously play the game

## Strategic Elements:
- Analyze past duels and stats
- Choose optimal moves based on historical data
- Make strategic decisions about which duelists to use
- Balance aggressive and defensive playstyles
- Adapt strategy based on current game state

Remember to:
- Monitor your duelists life count and fame balance
- Monitor your past duels and stats
- Make informed decisions about which duelists to use
- Learn from opponents data to predict their moves and beat them

`;

// Define interfaces for type safety
interface PackData {
  pack_id: string;
  pack_type: string;
  seed: string;
  is_open: boolean;
  timestamp?: number;
}

interface Challenge {
  duel_id: string;
  state: string;
  duelist_id: string;
  premise: string;
  quote: string;
  address_a: string;
  address_b: string;
  duelist_id_a: string;
  duelist_id_b: string;
  winner?: string;
  timestamps: {
    start: number;
    end?: number;
  };
}

interface DeckData {
  shoot: number[];
  dodge: number[];
  tactics: number[];
  blades: number[];
}

interface DuelistCache {
  [duelistId: string]: {
    timestamp: number;
    data: {
      life_count: number;
      is_alive: boolean;
      fame_balance: number;
      is_inactive: boolean;
    }
  }
}

interface PistolsState {
  goal: string;
  tasks: string[];
  currentTask: string | null;
  playerAddress: string;
  duelistId: string;
  activeChallenge: string;
  activeChallenges: ChallengeData[];
  challengeState: string;
  isRegistered: boolean;
  starterPackClaimed: boolean;
  duelResults: DuelHistory;
  playerDuelists: DuelistData[];
  playerPacks: PackData[];
  committedMoves: {
    [duelId: string]: {
      salt: bigint;
      moves: number[];
      hash: bigint;
    }
  };
  duelistCache: DuelistCache;
}

// Card type constants for duel moves
const CARD_TYPES = {
  SHOOT: 0,
  DODGE: 1,
  TACTIC: 2,
  BLADE: 3
} as const;

// Interface for processed deck response
interface ProcessedDeck {
  shoot: number[];   // Available shoot step numbers (1-10)
  dodge: number[];   // Available dodge step numbers (1-10)
  tactics: number[]; // Available tactic card IDs
  blades: number[];  // Available blade card IDs
}

// Context for the agent
const pistolsContexts = context({
  type: "goal",
  schema: z.object({
    id: string(),
    initialGoal: z.string(),
    initialTasks: z.array(z.string()),
    playerAddress: z.string().optional(),
  }),

  key({ id }) {
    return id;
  },

  create(state): PistolsState {
    return {
      goal: state.args.initialGoal,
      tasks: state.args.initialTasks,
      currentTask: state.args.initialTasks[0],
      playerAddress: normalizeStarknetAddress(state.args.playerAddress || env.STARKNET_ADDRESS),
      duelistId: "",
      activeChallenge: "",
      activeChallenges: [],
      challengeState: "",
      isRegistered: false,
      starterPackClaimed: false,
      duelResults: { rounds: [], totalDuels: 0, lastAnalyzed: 0 },
      playerDuelists: [],
      playerPacks: [],
      committedMoves: {},
      duelistCache: {},
    };
  },

  render({ memory }) {
    return render(PISTOLS_CONTEXT, {
      goal: memory.goal,
      tasks: memory.tasks.join("\n"),
      currentTask: memory.currentTask ?? "NONE",
      playerAddress: normalizeStarknetAddress(memory.playerAddress ?? env.STARKNET_ADDRESS),
      duelistId: memory.duelistId ?? "",
      activeChallenge: memory.activeChallenge ?? "",
      challengeState: memory.challengeState ?? "",
      playerDuelists: memory.playerDuelists ?? []
    } as any);
  },
});

// Helper function to parse duelist metadata
function parseDuelistMetadata(tokenMetadata: any): DuelistData {
  const metadata = JSON.parse(tokenMetadata.metadata);
  const attributes = metadata.attributes.reduce((acc: any, attr: { trait: string; value: string }) => {
    acc[attr.trait] = attr.value;
    return acc;
  }, {});

  return {
    duelist_id: tokenMetadata.tokenId,
    name: attributes.Name || "Unknown",
    archetype: attributes.Archetype || "Unknown",
    image_url: metadata.metadata?.duelist_image || "",
    metadata: metadata,
    life_count: parseInt(attributes.Lives) || 0,
    is_alive: attributes.Alive === "Alive",
    fame_balance: parseInt(attributes.Fame) || 0,
    is_inactive: false // This is determined by active challenges
  };
}

/**
 * Helper function to query the Pistols GraphQL API
 */
async function queryPistolsAPI<T>(query: string, variables = {}): Promise<GraphQLResponse<T>> {
  const response = await fetch(env.PISTOLS_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`);
  }

  return await response.json() as GraphQLResponse<T>;
}

const pistolsExtension = extension({
  name: "pistols",
  contexts: {
    goal: pistolsContexts,
  },
  actions: [    
    /**
     * Action to fetch player state
     */
    action({
      name: "fetch_player_state",
      description: "Fetch the current state of a player in Pistols at Dawn",
      schema: z.object({
        playerAddress: z.string().describe("The player's Starknet address"),
      }),
      async handler(
        call: ActionCall<{
          playerAddress: string;
        }>,
        ctx: any,
        agent: Agent
      ) {
          try {
            const playerAddress = normalizeStarknetAddress(call.data.playerAddress);
            console.log(`Fetching state for player: ${playerAddress}`);
            
            const query = `
              query GetPlayerState {
                pistolsPlayerModels(where: { player_address: "${playerAddress}" }) {
                  edges {
                    node {
                      player_address
                      timestamps {
                        registered
                        claimed_starter_pack
                      }
                    }
                  }
                }
              }
            `;
         
            const result = await queryPistolsAPI<PlayerResponse>(query);
            const state = ctx.agentMemory as PistolsState;
            const playerData = result.data?.pistolsPlayerModels?.edges?.[0]?.node;
            
            const isRegistered = !!playerData && !!playerData.timestamps?.registered;
            const hasClaimedStarterPack = !!playerData?.timestamps?.claimed_starter_pack;
            
            state.isRegistered = isRegistered;
            state.starterPackClaimed = hasClaimedStarterPack;
            
            let playerDuelists: DuelistData[] = [];
            
            if (state.starterPackClaimed) {
              console.log(`Querying duelists for player: ${playerAddress}`);
              
              try {
                const query = `
                  query tokenBalances {
                    tokenBalances(
                      accountAddress: "${playerAddress}"
                      first: 1000
                    ) {
                      edges {
                        node {
                          tokenMetadata {
                            __typename
                            ... on ERC721__Token {
                              contractAddress
                              symbol
                              tokenId
                              metadata
                            }
                          }
                        }
                      }
                    }
                  }
                `;
                
                const result = await queryPistolsAPI<TokenBalancesResponse>(query);
                
              // Process duelists
                const duelistTokens = result?.data?.tokenBalances?.edges
                .filter((edge: { node: { tokenMetadata: { __typename: string; contractAddress: string; } } }) => {
                    const token = edge.node.tokenMetadata;
                    return token.__typename === 'ERC721__Token' && 
                           token.contractAddress.toLowerCase() === duelist_contract.address.toLowerCase();
                  })
                .map((edge: { node: { tokenMetadata: any } }) => edge.node.tokenMetadata);

              playerDuelists = duelistTokens.map(parseDuelistMetadata);
              
              // Process packs
              const packTokens = result?.data?.tokenBalances?.edges
                .filter((edge: { node: { tokenMetadata: { __typename: string; contractAddress: string; } } }) => {
                    const token = edge.node.tokenMetadata;
                  return token.__typename === 'ERC721__Token' && 
                         token.contractAddress.toLowerCase() === pack_token_contract.address.toLowerCase();
                })
                .map((edge: { 
                  node: { 
                    tokenMetadata: { 
                      tokenId: string; 
                      metadata: string;
                    } 
                  } 
                }): PackData => {
                  const token = edge.node.tokenMetadata;
                    const metadata = JSON.parse(token.metadata);
                    
                    return {
                    pack_id: token.tokenId,
                    pack_type: metadata.attributes.find((attr: { trait: string; value: string }) => 
                      attr.trait === 'Type')?.value || 'Unknown',
                    seed: metadata.attributes.find((attr: { trait: string; value: string }) => 
                      attr.trait === 'Seed')?.value || '0',
                    is_open: metadata.attributes.find((attr: { trait: string; value: string }) => 
                      attr.trait === 'Is Open')?.value === 'true',
                    timestamp: parseInt(metadata.attributes.find((attr: { trait: string; value: string }) => 
                      attr.trait === 'Timestamp')?.value || '0')
                  };
                });

              state.playerPacks = packTokens;
              state.playerDuelists = playerDuelists;
              } catch (error) {
              console.error('Error querying player tokens:', error);
            }
          }
          /*
            if (state.starterPackClaimed) {
              if (state.tasks.includes("Claim starter pack")) {
                state.tasks = state.tasks.filter(task => task !== "Claim starter pack");
              }
              if (!state.tasks.includes("Duel other players")) {
                state.tasks.push("Duel other players");
              }
              state.currentTask = "Duel other players";
            } else if (state.isRegistered && !state.tasks.includes("Claim starter pack")) {
              state.tasks.push("Claim starter pack");
              state.currentTask = "Claim starter pack";
          }*/
            
            state.playerDuelists = playerDuelists;
            
            return {
              success: true,
              playerState: {
                player_address: playerData?.player_address,
                timestamps: playerData?.timestamps
              },
              message: "Successfully fetched player state",
              isRegistered: state.isRegistered,
              starterPackClaimed: state.starterPackClaimed,
              playerDuelists: state.playerDuelists
            };
          } catch (error: unknown) {
            console.error("Error fetching player state:", error);
            return {
              success: false,
            error: error instanceof Error ? error.message : String(error),
              message: "Failed to fetch player state",
            };
          }
      },
    }),
    
    /**
     * Action to claim the free starter duelist pack
     */
    action({
      name: "claim_starter_pack",
      description: "Claim the free starter duelist pack for a new player",
      schema: z.object({
        playerAddress: z.string().describe("The player's Starknet address")
      }),
      async handler(
        call: ActionCall<{
          playerAddress: string;
        }>,
        ctx: any,
        agent: Agent
      ) {
        try {
          const state = ctx.agentMemory as PistolsState;
          
          const claimResponse = await starknetChain.write({
            contractAddress: pack_token_contract.address,
            entrypoint: 'claim_starter_pack',
            calldata: []
          });
          
          console.log('Claim response:', claimResponse);
          
          // Get duelist IDs from the first event's data
          const duelistData = claimResponse.events?.[0]?.data;
          const duelistIds = duelistData ? duelistData.map((id: string) => id.toString()) : [];
          
          console.log('Claimed duelist IDs:', duelistIds);
          
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Update state
          state.starterPackClaimed = true;
          state.playerDuelists = duelistIds.map((id: string) => ({
            duelist_id: id,
            name: "Unknown",
            archetype: "Unknown",
            image_url: "",
            metadata: {}
          }));
          
          /* Update tasks
          if (state.tasks.includes("Claim starter pack")) {
            state.tasks = state.tasks.filter(task => task !== "Claim starter pack");
          }
          if (!state.tasks.includes("Duel other players")) {
            state.tasks.push("Duel other players");
          }
          state.currentTask = "Duel other players";*/
          
          return {
            success: true,
            message: "Successfully claimed starter pack",
            transaction: claimResponse,
            duelistIds: duelistIds
          };
        } catch (error: unknown) {
          console.error("Error claiming starter pack:", error);
            return {
              success: false,
            error: error instanceof Error ? error.message : String(error),
            message: "Failed to claim starter pack",
          };
        }
      },
    }),

    /**
     * Action to purchase a pistols pack token
     * Commented because we cant use it without VRF
    action({
      name: "purchase_pack",
      description: "Purchase a duelist 5 pack token using LORDS",
      schema: z.object({
        playerAddress: z.string().describe("The player's Starknet address"),
        amount: z.number().min(1).max(10).default(1).describe("Number of packs to purchase")
      }),
      async handler(
        call: ActionCall<{
          playerAddress: string;
          amount: number;
        }>,
        ctx: any,
        agent: Agent
      ) {
        try {
          const playerAddress = normalizeStarknetAddress(call.data.playerAddress);
          const amount = call.data.amount || 1;
          const packType = PackType.Duelists5x;

          // Calculate total cost using price from constants
          const packPrice = PACK_TYPES[packType].price_lords;
          const totalCost = packPrice * BigInt(10*amount);
          
          // Check LORDS balance with detailed logging
          let balance = BigInt(0);
          try {
            console.log(`Checking LORDS balance for address: ${playerAddress}`);
            const balanceResponse = await starknetChain.write({
              contractAddress: env.LORDS_TOKEN_ADDRESS,
              entrypoint: 'balanceOf',
              calldata: [playerAddress]
            });
            
            // Get balance from the first event's data
            const balanceData = balanceResponse.events?.[0]?.data;
            if (balanceData && Array.isArray(balanceData) && balanceData.length >= 3) {
              balance = BigInt(balanceData[2]);
              console.log('Parsed balance:', balance.toString());
            } else {
              console.log('Invalid balance data format:', balanceData);
            }
          } catch (error) {
            console.error('Error fetching LORDS balance:', error);
            return {
              success: false,
              message: "Failed to fetch LORDS balance",
              error: error instanceof Error ? error.message : String(error)
            };
          }
          
          if (balance < totalCost) {
            const requiredLords = Number(totalCost / BigInt(10 ** 18));
            const currentLords = Number(balance / BigInt(10 ** 18));
            return {
              success: false,
              message: `Insufficient LORDS balance. Need ${requiredLords} LORDS but have ${currentLords} LORDS`,
              error: "Insufficient funds"
            };
          }
          
          // First approve LORDS spending
          try {
            console.log('Approving LORDS spending...');
            // Split totalCost into high and low parts for u256
            const MAX_FELT = BigInt(2) ** BigInt(128) - BigInt(1);  // 2^128 - 1
            const lowPart = totalCost & MAX_FELT;
            const highPart = totalCost >> BigInt(128);

            const approveResponse = await starknetChain.write({
              contractAddress: env.LORDS_TOKEN_ADDRESS,
              entrypoint: 'approve',
              calldata: [
                bank_contract.address,    // spender
                lowPart.toString(),      // low part first
                highPart.toString()      // high part second
              ]
            });
            
            // Wait for approval to be processed
            await new Promise(resolve => setTimeout(resolve, 3000));
            console.log('Approval response:', approveResponse);
          } catch (error) {
            console.error('Error approving LORDS spend:', error);
            return {
              success: false,
              message: "Failed to approve LORDS spending",
              error: error instanceof Error ? error.message : String(error)
            };
          }

          // Then proceed with the purchase
          try {
            console.log('Attempting pack purchase...');
            const purchaseResponse = await starknetChain.write({
              contractAddress: pack_token_contract.address,
              entrypoint: 'purchase',
              calldata: [2]  // PackType.Duelists5x = 2
            });
            console.log('Purchase response:', purchaseResponse);
            
            if (!purchaseResponse.events || purchaseResponse.events.length === 0) {
              throw new Error('Purchase transaction failed - no events emitted');
            }
            
            // Get pack ID from the first event's data
            const packData = purchaseResponse.events[0].data;
            if (!packData || packData.length === 0) {
              throw new Error('Purchase transaction succeeded but no pack data returned');
            }
            
            const packId = packData[0];
            console.log('Pack ID:', packId);
            
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Update state with new packs
            const state = ctx.agentMemory as PistolsState;
            
            const newPack: PackData = {
              pack_id: packId.toString(),
              pack_type: PACK_TYPES[packType].name,
              seed: "0",
              is_open: false,
              timestamp: Math.floor(Date.now() / 1000)
            };
            
            state.playerPacks.push(newPack);
            
            return {
              success: true,
              message: `Successfully purchased ${amount} ${PACK_TYPES[packType].name}(s)`,
              transaction: purchaseResponse,
              pack: newPack,
              cost: totalCost.toString()
            };
          } catch (error) {
            console.error('Purchase transaction failed:', error);
            return {
              success: false,
              message: "Failed to purchase pack - transaction failed",
              error: error instanceof Error ? error.message : String(error)
            };
          }
        } catch (error: unknown) {
          console.error("Error purchasing pack:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            message: "Failed to purchase pack",
          };
        }
      },
    }),
    */

    /**
     * Action to open a pistols pack token
     */
    action({
      name: "open_pack",
      description: "Open a pistols pack token to reveal duelists",
      schema: z.object({
        playerAddress: z.string().describe("The player's Starknet address"),
        packId: z.string().describe("The ID of the pack to open")
      }),
      async handler(
        call: ActionCall<{
          playerAddress: string;
          packId: string;
        }>,
        ctx: any,
        agent: Agent
      ) {
        try {
          const packId = call.data.packId;
          const state = ctx.agentMemory as PistolsState;
          
          const openResponse = await starknetChain.write({
            contractAddress: pack_token_contract.address,
            entrypoint: 'open',
            calldata: [packId]
          });
          
          console.log('Open pack response:', openResponse);
          
          // Get duelist IDs from the first event's data
          const openDuelistData = openResponse.events?.[0]?.data;
          const duelistIds = openDuelistData ? openDuelistData.map((id: string) => id.toString()) : [];
          
          console.log('Opened pack duelist IDs:', duelistIds);
          
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Update pack state
          state.playerPacks = state.playerPacks.map(p => 
            p.pack_id === packId ? { ...p, is_open: true } : p
          );
          
          // Add new duelists to state
          const newDuelists = duelistIds.map((id: string) => ({
            duelist_id: id,
            name: "Unknown",
            archetype: "Unknown",
            image_url: "",
            metadata: {}
          }));
          state.playerDuelists.push(...newDuelists);
          
          return {
            success: true,
            message: "Pack successfully opened",
            transaction: openResponse,
            duelistIds: duelistIds,
            duelists: newDuelists
          };
        } catch (error: unknown) {
          console.error("Error opening pack:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            message: "Failed to open pack",
          };
        }
      },
    }),

    /**
     * Action to fetch player challenges
     */
    action({
      name: "fetch_challenges",
      description: "Fetch challenges for a player from Pistols at Dawn",
      schema: z.object({
        playerAddress: z.string().describe("The player's Starknet address"),
      }),
      async handler(
        call: ActionCall<{
          playerAddress: string;
        }>,
        ctx: any,
        agent: Agent
      ) {
          try {
            const playerAddress = normalizeStarknetAddress(call.data.playerAddress);
            console.log(`Fetching challenges for player: ${playerAddress}`);
            
            const query = `
            query GetPlayerChallenges {
              addressAChallenges: pistolsChallengeModels(
                where: {
                  address_aEQ: "${playerAddress}"
                }
              ) {
                edges {
                  node {
                    duel_id
                    premise
                    quote
                    address_a
                    address_b
                    duelist_id_a
                    duelist_id_b
                    state
                    winner
                    timestamps {
                      start
                      end
                    }
                  }
                }
              }
              
              addressBChallenges: pistolsChallengeModels(
                where: {
                  address_bEQ: "${playerAddress}"
                }
              ) {
                edges {
                  node {
                    duel_id
                    premise
                    quote
                    address_a
                    address_b
                    duelist_id_a
                    duelist_id_b
                    state
                    winner
                    timestamps {
                      start
                      end
                    }
                  }
                }
              }
          }`;
            
            const result = await queryPistolsAPI<ChallengesResponse>(query);
            
          const challengesAsA = result.data?.addressAChallenges?.edges?.map((edge: { node: ChallengeData }) => ({
            ...edge.node,
            duelist_id: edge.node.duelist_id_a
          }));
          const challengesAsB = result.data?.addressBChallenges?.edges?.map((edge: { node: ChallengeData }) => ({
            ...edge.node,
            duelist_id: edge.node.duelist_id_b
          }));
          
            const challenges = [...challengesAsA, ...challengesAsB];
            
          const sortedChallenges = challenges.sort((a: Challenge, b: Challenge) => {
            const statePriority: { [key: string]: number } = {
              [constants.ChallengeState.InProgress]: 0,
              [constants.ChallengeState.Awaiting]: 1,
              [constants.ChallengeState.Resolved]: 2,
              [constants.ChallengeState.Draw]: 3,
              [constants.ChallengeState.Refused]: 4,
              [constants.ChallengeState.Withdrawn]: 5,
              [constants.ChallengeState.Expired]: 6,
              [constants.ChallengeState.Null]: 7
            };
            
            const priorityDiff = statePriority[a.state] - statePriority[b.state];
            if (priorityDiff !== 0) return priorityDiff;
            
            return (b.timestamps?.start || 0) - (a.timestamps?.start || 0);
          });
          
          const activeChallenges = sortedChallenges.filter((challenge: Challenge) => 
            challenge.state === constants.ChallengeState.InProgress ||
            challenge.state === constants.ChallengeState.Awaiting
          );
          
          if (activeChallenges.length > 0) {
              const state = ctx.agentMemory as PistolsState;
            
            state.activeChallenges = activeChallenges.map((challenge: Challenge): Challenge => ({
              ...challenge,
              duelist_id: challenge.duelist_id_a
            }));
            
            const currentChallenge = activeChallenges[0];
            state.activeChallenge = currentChallenge.duel_id;
            state.challengeState = currentChallenge.state;
            
            if (currentChallenge.state === constants.ChallengeState.InProgress) {
              state.duelistId = currentChallenge.duelist_id_a;
            }
            }
            
            return {
              success: true,
            challenges: sortedChallenges,
            activeChallenges: activeChallenges,
            message: `Found ${challenges.length} total challenges (${activeChallenges.length} active)`,
            };
          } catch (error: unknown) {
            console.error("Error fetching challenges:", error);
            return {
              success: false,
            error: error instanceof Error ? error.message : String(error),
              message: "Failed to fetch challenges",
            };
          }
      },
    }),
    
    
    /**
     * Action to accept a challenge from another player
     */
    action({
      name: "accept_challenge",
      description: "Accept a challenge from another player",
      schema: z.object({
        playerAddress: z.string().describe("The player's Starknet address"),
        duelistId: z.string().describe("The duelist ID to use for accepting the challenge"),
        challengeId: z.string().describe("The challenge ID to accept")
      }),
      async handler(
        call: ActionCall<{
          playerAddress: string;
          duelistId: string;
          challengeId: string;
        }>,
        ctx: any,
        agent: Agent
      ) {
        try {
          const duelistId = call.data.duelistId;
          const challengeId = call.data.challengeId;
          
            const acceptResponse = await starknetChain.write({
              contractAddress: duel_contract.address,
              entrypoint: 'reply_duel',
              calldata: [
                challengeId,
                duelistId,
                '1'           // accepted (1 for true)
              ]
            });
            
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const state = ctx.agentMemory as PistolsState;
          
          // Update active challenge state
            state.activeChallenge = challengeId;
            state.duelistId = duelistId;
            state.challengeState = constants.ChallengeState.InProgress;
          
          // Update challenge in activeChallenges list
          state.activeChallenges = state.activeChallenges.map(c => 
            c.duel_id === challengeId 
              ? { 
                  ...c, 
                  state: constants.ChallengeState.InProgress,
                  duelist_id_b: duelistId 
                }
              : c
          );

            return {
              success: true,
              message: "Challenge successfully accepted",
              transaction: acceptResponse
            };
        } catch (error: unknown) {
          console.error("Error accepting challenge:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            message: "Failed to accept challenge",
          };
        }
      },
    }),
    
    /**
     * Action to create a challenge to another player
     */
    action({
      name: "create_challenge",
      description: "Creates a new challenge to another player",
      schema: z.object({
        playerAddress: z.string(),
        duelistId: z.string(),
        challengedAddress: z.string(),
        premise: z.string().optional(),
        quote: z.string().max(30),
        expireHours: z.number().min(1).max(24).default(24),
        livesStaked: z.number().min(1).max(255).default(1)
      }),
      async handler(
        call: ActionCall<{
          playerAddress: string;
          duelistId: string;
          challengedAddress: string;
          premise?: string;
          quote: string;
          expireHours: number;
          livesStaked?: number;
        }>,
        ctx: any,
        agent: Agent
      ) {
        try {
          const playerAddress = normalizeStarknetAddress(call.data.playerAddress);
          const duelistId = call.data.duelistId;
          const challengedAddress = normalizeStarknetAddress(call.data.challengedAddress);
          
          let premiseValue = "1";
          if (call.data.premise) {
            const value = constants.getPremiseValue(call.data.premise as constants.Premise);
            premiseValue = value !== undefined ? value.toString() : call.data.premise;
          }
            
          const duelType = constants.getDuelTypeValue(constants.DuelType.Practice) as number;
          const expireHours = call.data.expireHours || 24;
          const livesStaked = call.data.livesStaked || 1;
          const message = call.data.quote;
          
          const createResponse = await starknetChain.write({
            contractAddress: duel_contract.address,
            entrypoint: 'create_duel',
            calldata: [
              duelType,
              duelistId,
              challengedAddress,
              livesStaked,
              expireHours.toString(),
              premiseValue,
              message,
            ]
          });
          
          // Get duel ID from the first event's data
          const duelData = createResponse.events?.[0]?.data;
          const duelId = duelData?.[0];
          
          console.log('Created duel ID:', duelId);
          
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Update state with new challenge
          const state = ctx.agentMemory as PistolsState;
          const newChallenge: Challenge = {
            duel_id: duelId,
            state: constants.ChallengeState.Awaiting,
            duelist_id: duelistId,
            premise: premiseValue,
            quote: call.data.quote,
            address_a: playerAddress,
            address_b: challengedAddress,
            duelist_id_a: duelistId,
            duelist_id_b: "",
            timestamps: {
              start: Math.floor(Date.now() / 1000)
            }
          };
          state.activeChallenges.push(newChallenge);
          
          return {
            success: true,
            message: `Challenge successfully created to ${challengedAddress}`,
            transaction: createResponse,
            challenge: newChallenge
          };
        } catch (error: unknown) {
          console.error("Error creating challenge:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            message: "Failed to create challenge"
          };
        }
      },
    }),

    /**
     * Action to get all available cards for a duel
     */
    action({
      name: "get_duel_cards",
      description: "Get all available cards/possible moves for a duel",
      schema: z.object({
        duelId: z.string().describe("The duel ID to get cards for")
      }),
      async handler(
        call: ActionCall<{
          duelId: string;
        }>,
        ctx: any,
        agent: Agent
      ) {
        try {
          const duelId = call.data.duelId;
          console.log(`Fetching duel cards for duel ID: ${duelId}`);
          
            const deckResponse = await starknetChain.write({
              contractAddress: game_contract.address,
              entrypoint: 'get_duel_deck',
            calldata: [duelId]
          });
          
          console.log('Raw deck response:', deckResponse);
          
          const processedDeck: ProcessedDeck = {
            shoot: [],
            dodge: [],
            tactics: [],
            blades: []
          };

          // Get the deck data from the first event's data array
          const deckData = deckResponse.events?.[0]?.data;
          
          if (deckData && Array.isArray(deckData)) {
            console.log('Processing deck data array:', deckData);
            
            // Skip header values (0x1, 0x23, 0x4)
            let currentIndex = 3;
            
            // Process each card type
            for (const cardType of Object.values(CARD_TYPES)) {
              if (currentIndex >= deckData.length) {
                console.log(`Reached end of data at index ${currentIndex}`);
                break;
              }
              
              // Get number of cards for this type
              const cardCount = parseInt(deckData[currentIndex], 16);
              console.log(`Processing card type ${cardType}, count: ${cardCount}`);
                currentIndex++;
                
              if (!isNaN(cardCount)) {
                const cards: number[] = [];
                for (let i = 0; i < cardCount && currentIndex < deckData.length; i++) {
                  const cardValue = parseInt(deckData[currentIndex], 16);
                  if (!isNaN(cardValue)) {
                    cards.push(cardValue);
                  }
                  currentIndex++;
                }
                
                switch(cardType) {
                  case CARD_TYPES.SHOOT:
                    processedDeck.shoot = cards;
                    console.log('Shoot cards:', cards);
                    break;
                  case CARD_TYPES.DODGE:
                    processedDeck.dodge = cards;
                    console.log('Dodge cards:', cards);
                    break;
                  case CARD_TYPES.TACTIC:
                    processedDeck.tactics = cards;
                    console.log('Tactic cards:', cards);
                    break;
                  case CARD_TYPES.BLADE:
                    processedDeck.blades = cards;
                    console.log('Blade cards:', cards);
                    break;
                }
              }
            }
          } else {
            console.log('Empty or invalid deck response');
            }
            
            return {
              success: true,
              message: "Successfully retrieved duel cards",
              deck: processedDeck,
            availableMoves: {
              shoot: processedDeck.shoot.length,
              dodge: processedDeck.dodge.length,
              tactics: processedDeck.tactics.length,
              blades: processedDeck.blades.length
            }
          };
        } catch (error: unknown) {
          console.error("Error getting duel cards:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            message: "Failed to get duel cards",
          };
        }
      },
    }),

    /**
     * Action to commit moves for a challenge
     */
    action({
      name: "commit_moves",
      description: "Commit moves for a challenge",
      schema: z.object({
        playerAddress: z.string(),
        duelistId: z.string(),
        duelId: z.string(),
        moves: z.array(z.number())
      }),
      async handler(
        call: ActionCall<{
          playerAddress: string;
          duelistId: string;
          duelId: string;
          moves: number[];
        }>,
        ctx: any,
        agent: Agent
      ) {
        try {
          const duelistId = call.data.duelistId;
          const duelId = call.data.duelId;
          const moves = call.data.moves;
          
          console.log(`Committing moves for duel ${duelId} with duelist ${duelistId}`);
          console.log('Moves to commit:', moves);
          
          const saltValue = Math.floor(Math.random() * 0xFFFFFFFF);
          const saltBigInt = BigInt(saltValue);
          const saltHex = bigintToHex(saltBigInt);
          
          console.log('Generated salt:', {
            value: saltValue,
            bigint: saltBigInt.toString(),
            hex: saltHex
          });
          
          const hashResult = make_moves_hash(saltBigInt, moves);
          const hashResultHex = bigintToHex(hashResult);
          
          console.log('Generated hash:', {
            bigint: hashResult.toString(),
            hex: hashResultHex
          });
          
          const commitResponse = await starknetChain.write({
            contractAddress: game_contract.address,
            entrypoint: 'commit_moves',
            calldata: [
              duelistId,
              duelId,
              hashResultHex
            ]
          });
          
          // Only store the moves if the commit was successful
          if (commitResponse.events && commitResponse.events.length > 0) {
          const state = ctx.agentMemory as PistolsState;
          state.activeChallenge = duelId;
          state.duelistId = duelistId;
            state.committedMoves[duelId] = {
            salt: saltBigInt,
            moves: moves,
            hash: hashResult
          };
            
            console.log('Successfully saved moves to state:', {
              duelId,
              storedMoves: state.committedMoves[duelId]
            });
          } else {
            throw new Error('Commit transaction did not emit events');
          }
          
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          return {
            success: true,
            message: "Moves successfully committed",
            salt: saltHex,
            moves: moves,
            hash: hashResultHex,
            transaction: commitResponse
          };
        } catch (error: unknown) {
          console.error("Error committing moves:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            message: "Failed to commit moves"
          };
        }
      },
    }),

    /**
     * Action to reveal moves for a challenge
     */
    action({
      name: "reveal_moves",
      description: "Reveal previously committed moves for a challenge",
      schema: z.object({
        playerAddress: z.string(),
        duelistId: z.string(),
        duelId: z.string(),
      }),
      async handler(
        call: ActionCall<{
          playerAddress: string;
          duelistId: string;
          duelId: string;
        }>,
        ctx: any,
        agent: Agent
      ) {
        try {
          const duelistId = call.data.duelistId;
          const duelId = call.data.duelId;
          
          const state = ctx.agentMemory as PistolsState;
          const storedMoves = state.committedMoves[duelId];
          
          if (!storedMoves) {
            console.error('No stored moves found for duel:', duelId);
            console.log('Current stored moves:', state.committedMoves);
            throw new Error('No committed moves found for this duel');
          }

          console.log('Revealing moves for duel:', {
            duelistId,
            duelId,
            salt: bigintToHex(storedMoves.salt),
            moves: storedMoves.moves
          });
          
          const calldata = [
            duelistId,
            duelId,
            bigintToHex(storedMoves.salt),
            storedMoves.moves
          ];
          
          const revealResponse = await starknetChain.write({
            contractAddress: game_contract.address,
            entrypoint: 'reveal_moves',
            calldata: calldata
          });
          
          // Only clean up state if reveal was successful
          if (revealResponse.events && revealResponse.events.length > 0) {
            delete state.committedMoves[duelId];
          state.activeChallenge = duelId;
          state.duelistId = duelistId;
            
            console.log('Successfully cleaned up moves from state:', {
              duelId,
              remainingMoves: Object.keys(state.committedMoves)
            });
          } else {
            throw new Error('Reveal transaction did not emit events');
          }
          
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          return {
            success: true,
            message: "Moves successfully revealed",
            salt: bigintToHex(storedMoves.salt),
            moves: storedMoves.moves,
            transaction: revealResponse
          };
        } catch (error: unknown) {
          console.error("Error revealing moves:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            message: "Failed to reveal moves"
          };
        }
      },
    }),

    /**
     * Action to get available duelists for challenges
     */
    action({
      name: "get_available_duelists",
      description: "Select a duelist to challenge from a player's collection",
      schema: z.object({
        playerAddress: z.string().optional(),
        targetAddress: z.string().optional().describe("Optional specific player to target")
      }),
      async handler(
        call: ActionCall<{
          playerAddress?: string;
          targetAddress?: string;
        }>,
        ctx: any,
        agent: Agent
      ) {
        try {
          const ourAddress = normalizeStarknetAddress(call.data.playerAddress || env.STARKNET_ADDRESS);
          
          // First, get all players in the game
          const playersQuery = `
          query GetPlayers {
            pistolsPlayerModels{
              edges {
                node {
                  player_address
                }
              }
            }
          }`;

          const playersResult = await queryPistolsAPI<PlayerResponse>(playersQuery);
          
          // Get all player addresses and remove ours
          const playerAddresses = playersResult.data?.pistolsPlayerModels?.edges
            ?.map((edge: { node: { player_address: string } }) => 
              normalizeStarknetAddress(edge.node.player_address))
            .filter((address: string) => address !== ourAddress) || [];

          if (playerAddresses.length === 0) {
            return {
              success: true,
              message: "No other players found",
              selectedDuelist: null
            };
          }

          // If targetAddress is provided and valid, use it, otherwise pick random
          let targetAddress: string | undefined = call.data.targetAddress;
          if (!targetAddress || !playerAddresses.includes(normalizeStarknetAddress(targetAddress))) {
            targetAddress = playerAddresses[Math.floor(Math.random() * playerAddresses.length)];
          }
          if (!targetAddress) {
            throw new Error("No valid target address found");
          }
          targetAddress = normalizeStarknetAddress(targetAddress);

          // Get all active challenges to check for busy duelists
          const challengesQuery = `
          query GetActiveChallenges {
            challenges: pistolsChallengeModels(
              where: {state: "${constants.ChallengeState.InProgress}"}
            ) {
              edges {
                node {
                  duelist_id_a
                  duelist_id_b
                }
              }
            }
          }`;
          
          const challengesResult = await queryPistolsAPI<{
            challenges: {
              edges: Array<{
                node: {
                  duelist_id_a: string;
                  duelist_id_b: string;
                }
              }>
            }
          }>(challengesQuery);
          
          // Track busy duelists
          const busyDuelists = new Set<string>();
          const challenges = challengesResult.data?.challenges?.edges?.map((edge: {
            node: { duelist_id_a: string; duelist_id_b: string }
          }) => edge.node) || [];
          challenges.forEach((challenge: { duelist_id_a: string; duelist_id_b: string }) => {
            busyDuelists.add(challenge.duelist_id_a);
            busyDuelists.add(challenge.duelist_id_b);
          });

          // Now get the target player's duelists with metadata
          const duelistsQuery = `
          query GetPlayerDuelists {
            tokenBalances(
              accountAddress: "${targetAddress}"
              first: 1000
            ) {
              edges {
                node {
                  tokenMetadata {
                    __typename
                    ... on ERC721__Token {
                      contractAddress
                      symbol
                      tokenId
                      metadata
                    }
                  }
                }
              }
            }
          }`;
          
          const duelistsResult = await queryPistolsAPI<TokenBalancesResponse>(duelistsQuery);
          
          // Process duelists with metadata
          const duelistTokens = duelistsResult.data?.tokenBalances?.edges
            ?.filter((edge: { node: { tokenMetadata: { __typename: string; contractAddress: string; } } }) => {
              const token = edge.node.tokenMetadata;
              return token.__typename === 'ERC721__Token' && 
                     token.contractAddress.toLowerCase() === duelist_contract.address.toLowerCase();
            })
            .map((edge: { node: { tokenMetadata: any } }) => edge.node.tokenMetadata) || [];

          // Parse metadata and filter out busy/dead duelists
          const availableDuelists = duelistTokens
            .map(parseDuelistMetadata)
            .filter((duelist: DuelistData) => 
              duelist.is_alive && 
              !duelist.is_inactive && 
              !busyDuelists.has(duelist.duelist_id)
            );

          // If no available duelists, try another player
          if (availableDuelists.length === 0) {
            const remainingPlayers = playerAddresses.filter((addr: string) => addr !== targetAddress);
            if (remainingPlayers.length > 0) {
              return this.handler({
                ...call,
                data: {
                  ...call.data,
                  targetAddress: remainingPlayers[Math.floor(Math.random() * remainingPlayers.length)]
                }
              }, ctx, agent as any);
            }
            return {
              success: true,
              message: "No available duelists found from any player",
              selectedDuelist: null
            };
          }

          // Select a random duelist from available ones
          const selectedDuelist = availableDuelists[Math.floor(Math.random() * availableDuelists.length)];
          
          return {
            success: true,
            message: "Successfully selected a duelist to challenge",
            selectedDuelist: {
              ...selectedDuelist,
              owner_address: targetAddress
            }
          };
        } catch (error: unknown) {
          console.error("Error selecting duelist to challenge:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            message: "Failed to select duelist to challenge"
          };
        }
      }
    }),

    /**
     * Action to analyze duel history
     */
    action({
      name: "analyze_duel_history",
      description: "Fetch duel history data for agent analysis",
      schema: z.object({
        playerAddress: z.string().describe("The player's Starknet address"),
      }),
      async handler(
        call: ActionCall<{
          playerAddress: string;
        }>,
        ctx: any,
        agent: Agent
      ) {
        try {
          const playerAddress = normalizeStarknetAddress(call.data.playerAddress);
          
          // First get our challenges to identify our duels
          const challengesQuery = `
          query GetPlayerChallenges {
            addressAChallenges: pistolsChallengeModels(
              where: {
                address_aEQ: "${playerAddress}",
                state: "${constants.ChallengeState.Resolved}"
              }
            ) {
              edges {
                node {
                  duel_id
                  address_a
                  address_b
                  duelist_id_a
                  duelist_id_b
                  state
                  winner
                  timestamps {
                    start
                    end
                  }
                }
              }
            }
            addressBChallenges: pistolsChallengeModels(
              where: {
                address_bEQ: "${playerAddress}",
                state: "${constants.ChallengeState.Resolved}"
              }
            ) {
              edges {
                node {
                  duel_id
                  address_a
                  address_b
                  duelist_id_a
                  duelist_id_b
                  state
                  winner
                  timestamps {
                    start
                    end
                  }
                }
              }
            }
          }`;

          // Get rounds data for all finished duels
          const roundsQuery = `
          query GetDuelRounds {
            pistolsRoundModels(where: {state: "${constants.RoundState.Finished}"}) {
              edges {
                node {
                  duel_id
                  moves_a {
                    card_1
                    card_2
                    card_3
                    card_4
                  }
                  moves_b {
                    card_1
                    card_2
                    card_3
                    card_4
                  }
                  state_a {
                    chances
                    damage
                    health
                    dice_fire
                    honour
                  }
                  state_b {
                    chances
                    damage
                    health
                    dice_fire
                    honour
                  }
                  state
                  final_blow {
                    Paces
                    Blades
                  }
                }
              }
            }
          }`;

          const [challengesResult, roundsResult] = await Promise.all([
            queryPistolsAPI<ChallengesResponse>(challengesQuery),
            queryPistolsAPI<RoundsResponse>(roundsQuery)
          ]);

          // Process challenges
          const ourChallenges = [
            ...(challengesResult.data?.addressAChallenges?.edges || []),
            ...(challengesResult.data?.addressBChallenges?.edges || [])
          ].map(edge => edge.node);

          // Create a map of duel_id -> challenge details
          const duelMap = new Map(ourChallenges.map(c => [
            c.duel_id,
            {
              isPlayerA: c.address_a === playerAddress,
              result: c.state === 'Draw' ? 'draw' : 
                      c.winner === (c.address_a === playerAddress ? c.duelist_id_a : c.duelist_id_b) ? 
                      'win' : 'loss'
            }
          ]));

          // Filter and process rounds that belong to our duels
          const ourRounds = (roundsResult.data?.pistolsRoundModels?.edges || [])
            .map((edge: { node: RoundData }) => edge.node)
            .filter((round: RoundData) => duelMap.has(round.duel_id))
            .map((round: RoundData) => {
              const duelInfo = duelMap.get(round.duel_id);
              if (!duelInfo) {
                throw new Error(`No duel info found for round ${round.duel_id}`);
              }
              return {
                duel_id: round.duel_id,
                playerMoves: duelInfo.isPlayerA ? round.moves_a : round.moves_b,
                opponentMoves: duelInfo.isPlayerA ? round.moves_b : round.moves_a,
                playerState: duelInfo.isPlayerA ? round.state_a : round.state_b,
                opponentState: duelInfo.isPlayerA ? round.state_b : round.state_a,
                result: duelInfo.result,
                final_blow: round.final_blow
              };
            });

          // Store the data in state for the agent to analyze
          const state = ctx.agentMemory as PistolsState;
          state.duelResults = {
            rounds: ourRounds,
            totalDuels: ourChallenges.length,
            lastAnalyzed: Date.now()
          } as DuelHistory;
          
          return {
            success: true,
            message: "Successfully gathered duel history data",
            data: {
              rounds: ourRounds,
              totalDuels: ourChallenges.length,
              duelMap: Object.fromEntries(duelMap)
            }
          };
        } catch (error: unknown) {
          console.error("Error gathering duel history:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            message: "Failed to gather duel history"
          };
        }
      }
    }),
  ],
});


// Create the Pistols at Dawn agent
const agent = createDreams({
  logger: LogLevel.INFO,
  model: anthropic("claude-3-7-sonnet-latest"),
  extensions: [cli, pistolsExtension, discord],
  memory: {
    store: createMemoryStore(),
    vector: createVectorStore(), //createChromaVectorStore("pistols-agent", "http://localhost:8000"),
    vectorModel: openai("gpt-4o-mini"),
  },
  context: pistolsContexts
});

// Start the agent with initial goals
console.log("Starting agent with initial goals...");

agent.start({
  id: "pistols-game",
  initialGoal:
    "Play as a duelist in the Pistols at Dawn game, accept challenges, defy players and play until you die.",
  initialTasks: [
    "Check player state to understand the current situation",
    "Fetch information about upcoming challenges",
    "Analyze past duels to learn winning strategies and apply them to new challenges",
    "Accept and create challenges",
    "Duel other players",
    "Play until all your duelists die"
  ],
});

// Handle exit
process.on("SIGINT", () => {
  console.log("Shutting down agent...");
  process.exit(0);
});
