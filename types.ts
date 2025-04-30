// API Response Types
export interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{
    message: string;
    locations?: Array<{
      line: number;
      column: number;
    }>;
    path?: string[];
    extensions?: Record<string, any>;
  }>;
}

// Player Types
export interface PlayerData {
  player_address: string;
  timestamps: {
    registered: number;
    claimed_starter_pack: number;
  };
}

export interface PlayerResponse {
  pistolsPlayerModels: {
    edges: Array<{
      node: PlayerData;
    }>;
  };
}

// Token Types
export interface TokenMetadata {
  __typename: string;
  contractAddress: string;
  symbol: string;
  tokenId: string;
  metadata: string;
}

export interface TokenBalance {
  tokenMetadata: TokenMetadata;
}

export interface TokenBalancesResponse {
  tokenBalances: {
    edges: Array<{
      node: TokenBalance;
    }>;
  };
}

// Challenge Types
export interface Challenge extends ChallengeData {
  duelist_id: string;
}

export interface ChallengeData {
  duel_id: string;
  premise: string;
  quote: string;
  address_a: string;
  address_b: string;
  duelist_id_a: string;
  duelist_id_b: string;
  state: string;
  winner?: string;
  timestamps: {
    start: number;
    end?: number;
  };
}

export interface ChallengesResponse {
  addressAChallenges: {
    edges: Array<{
      node: ChallengeData;
    }>;
  };
  addressBChallenges: {
    edges: Array<{
      node: ChallengeData;
    }>;
  };
}

// Round Types
export interface RoundMoves {
  card_1: number;
  card_2: number;
  card_3: number;
  card_4: number;
}

export interface RoundState {
  chances: number;
  damage: number;
  health: number;
  dice_fire: number;
  honour: number;
}

export interface RoundData {
  duel_id: string;
  moves_a: RoundMoves;
  moves_b: RoundMoves;
  state_a: RoundState;
  state_b: RoundState;
  state: string;
  final_blow: {
    Paces: number;
    Blades: number;
  };
}

export interface RoundsResponse {
  pistolsRoundModels: {
    edges: Array<{
      node: RoundData;
    }>;
  };
}

// Duelist Types
export interface DuelistData {
  duelist_id: string;
  name: string;
  archetype: string;
  image_url: string;
  metadata: any;
  life_count?: number;
  is_alive?: boolean;
  fame_balance?: number;
  is_inactive?: boolean;
  owner_address?: string;
}

// State Types
export interface DuelResult {
  duel_id: string;
  playerMoves: RoundMoves;
  opponentMoves: RoundMoves;
  playerState: RoundState;
  opponentState: RoundState;
  result: 'win' | 'loss' | 'draw';
  final_blow: {
    Paces: number;
    Blades: number;
  };
}

export interface DuelHistory {
  rounds: DuelResult[];
  totalDuels: number;
  lastAnalyzed: number;
} 