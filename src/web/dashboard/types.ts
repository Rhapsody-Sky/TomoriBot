import type {
  AssembledServerConfig,
  PersonalMemoryRow,
  ServerMemoryRow,
  TomoriState,
  UserRow,
} from "@/types/db/schema";

export interface DiscordOAuthUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export interface DiscordOAuthGuild {
  id: string;
  name: string;
  icon?: string | null;
  owner?: boolean;
  permissions?: string;
}

export interface DashboardGuild {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number | null;
  canManage: boolean;
}

export interface DashboardSession {
  id: string;
  user: DiscordOAuthUser;
  accessToken: string;
  tokenExpiresAt: number;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
  guildCache?: {
    fetchedAt: number;
    guilds: DashboardGuild[];
  };
}

export interface DashboardPersona {
  personaId: number;
  lineageId: number;
  nickname: string;
  isAlter: boolean;
  isPointer: boolean;
  avatarUrl: string | null;
  triggerWords: string[];
  personaPrompt: string | null;
  attributes: Array<{
    text: string;
    isPublic: boolean;
  }>;
  sampleDialogues: Array<{
    input: string;
    output: string;
  }>;
  contextNote: string | null;
  contextNoteDepth: number;
  physicalAppearanceTags: string[];
  humanizerOverride: number | null;
}

export interface DashboardGuildSnapshot {
  serverId: number;
  serverDiscordId: string;
  config: AssembledServerConfig;
  personas: DashboardPersona[];
  rawPersonas: TomoriState[];
}

export interface DashboardActor {
  discordId: string;
  user: RegisteredDashboardUser;
  canManage: boolean;
}

export type RegisteredDashboardUser = UserRow & { user_id: number };

export interface MemoryMutationInput {
  lineageId: number;
  content: string;
  tags: string[];
}

export interface PersonalMemoryView {
  id: number;
  lineageId: number;
  content: string;
  tags: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ServerMemoryView extends PersonalMemoryView {
  taughtByUserId: number | null;
  editable: boolean;
}

export function serializePersonalMemory(row: PersonalMemoryRow): PersonalMemoryView {
  return {
    id: row.personal_memory_id ?? 0,
    lineageId: row.persona_lineage_id,
    content: row.content,
    tags: row.tags ?? [],
    createdAt: row.created_at?.toISOString() ?? null,
    updatedAt: row.updated_at?.toISOString() ?? null,
  };
}

export function serializeServerMemory(row: ServerMemoryRow, actorUserId: number, canManage: boolean): ServerMemoryView {
  return {
    id: row.server_memory_id ?? 0,
    lineageId: row.persona_lineage_id,
    content: row.content,
    tags: row.tags ?? [],
    taughtByUserId: row.user_id,
    editable: canManage || row.user_id === actorUserId,
    createdAt: row.created_at?.toISOString() ?? null,
    updatedAt: row.updated_at?.toISOString() ?? null,
  };
}
