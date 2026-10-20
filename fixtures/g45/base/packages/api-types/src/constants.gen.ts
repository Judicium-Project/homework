// BU DOSYA ÜRETİLDİ (packages/api-types/scripts/postgen.mjs) — elle düzenleme yok.
// Kaynak: contracts/out/openapi.yaml. Her şema için kök tip; sayısal enum'larda aynı adla sabit nesne.
import type { components } from "./openapi.gen.ts";

export type AckRequest = components["schemas"]["AckRequest"];
export type ActiveSession = components["schemas"]["ActiveSession"];
export type AdminBetaCode = components["schemas"]["AdminBetaCode"];
export type AdminBetaCodeCreateRequest = components["schemas"]["AdminBetaCodeCreateRequest"];
export type AdminBetaCodeDeleteResponse = components["schemas"]["AdminBetaCodeDeleteResponse"];
export type AdminBetaCodeDeleteResult = components["schemas"]["AdminBetaCodeDeleteResult"];
export type AdminBetaCodeListResponse = components["schemas"]["AdminBetaCodeListResponse"];
export type AdminBetaCodeStatus = components["schemas"]["AdminBetaCodeStatus"];
export type AdminBetaCodeUser = components["schemas"]["AdminBetaCodeUser"];
export type AdminCapacityLimits = components["schemas"]["AdminCapacityLimits"];
export type AdminCapacityModel = components["schemas"]["AdminCapacityModel"];
export type AdminCapacityPlan = components["schemas"]["AdminCapacityPlan"];
export type AdminChecklistItem = components["schemas"]["AdminChecklistItem"];
export type AdminErrorsSummary = components["schemas"]["AdminErrorsSummary"];
export type AdminFormulaBreakdown = components["schemas"]["AdminFormulaBreakdown"];
export type AdminMediaSampleItem = components["schemas"]["AdminMediaSampleItem"];
export type AdminMediaSessionDetail = components["schemas"]["AdminMediaSessionDetail"];
export type AdminMetricSummary = components["schemas"]["AdminMetricSummary"];
export type AdminPeriodReport = components["schemas"]["AdminPeriodReport"];
export type AdminPlanAssumptions = components["schemas"]["AdminPlanAssumptions"];
export type AdminQualitySummary = components["schemas"]["AdminQualitySummary"];
export type AdminRecommendedSpecs = components["schemas"]["AdminRecommendedSpecs"];
export type AdminReportPeriod = components["schemas"]["AdminReportPeriod"];
export type AdminResourceBaseline = components["schemas"]["AdminResourceBaseline"];
export type AdminResourceCosts = components["schemas"]["AdminResourceCosts"];
export type AdminSeriesRange = components["schemas"]["AdminSeriesRange"];
export type AdminServerSpecs = components["schemas"]["AdminServerSpecs"];
export type AdminSystemLiveResponse = components["schemas"]["AdminSystemLiveResponse"];
export type AdminSystemSeriesPoint = components["schemas"]["AdminSystemSeriesPoint"];
export type AdminSystemSeriesResponse = components["schemas"]["AdminSystemSeriesResponse"];
export type AdminTopError = components["schemas"]["AdminTopError"];
export type AdminWorstSession = components["schemas"]["AdminWorstSession"];
export type AllowedMentionType = components["schemas"]["AllowedMentionType"];
export type AllowedMentions = components["schemas"]["AllowedMentions"];
export type ApiError = components["schemas"]["ApiError"];
export type Application = components["schemas"]["Application"];
export type Attachment = components["schemas"]["Attachment"];
export type AttachmentPurpose = components["schemas"]["AttachmentPurpose"];
export type AttachmentStatus = components["schemas"]["AttachmentStatus"];
export type AuditLogAction = components["schemas"]["AuditLogAction"];
export const AuditLogAction = {
  GUILD_UPDATE: 1,
  CHANNEL_CREATE: 10,
  CHANNEL_UPDATE: 11,
  CHANNEL_DELETE: 12,
  CHANNEL_OVERWRITE_CREATE: 13,
  CHANNEL_OVERWRITE_UPDATE: 14,
  CHANNEL_OVERWRITE_DELETE: 15,
  MEMBER_KICK: 20,
  MEMBER_BAN_ADD: 22,
  MEMBER_BAN_REMOVE: 23,
  MEMBER_UPDATE: 24,
  MEMBER_ROLE_UPDATE: 25,
  MEMBER_MOVE: 26,
  MEMBER_DISCONNECT: 27,
  ROLE_CREATE: 30,
  ROLE_UPDATE: 31,
  ROLE_DELETE: 32,
  INVITE_CREATE: 40,
  INVITE_DELETE: 42,
  MESSAGE_DELETE: 72,
  MESSAGE_BULK_DELETE: 73,
} as const satisfies Record<string, AuditLogAction>;
export type AuditLogChange = components["schemas"]["AuditLogChange"];
export type AuditLogEntry = components["schemas"]["AuditLogEntry"];
export type AuditLogPage = components["schemas"]["AuditLogPage"];
export type AuthSession = components["schemas"]["AuthSession"];
export type Ban = components["schemas"]["Ban"];
export type BetaCodeCheck = components["schemas"]["BetaCodeCheck"];
export type BetaCodeCheckRequest = components["schemas"]["BetaCodeCheckRequest"];
export type BetaCodeState = components["schemas"]["BetaCodeState"];
export type Channel = components["schemas"]["Channel"];
export type ChannelCreateDispatch = components["schemas"]["ChannelCreateDispatch"];
export type ChannelDeleteDispatch = components["schemas"]["ChannelDeleteDispatch"];
export type ChannelPosition = components["schemas"]["ChannelPosition"];
export type ChannelType = components["schemas"]["ChannelType"];
export const ChannelType = {
  GUILD_TEXT: 0,
  DM: 1,
  GUILD_VOICE: 2,
  GROUP_DM: 3,
  GUILD_CATEGORY: 4,
} as const satisfies Record<string, ChannelType>;
export type ChannelUpdateDispatch = components["schemas"]["ChannelUpdateDispatch"];
export type CheckStatus = components["schemas"]["CheckStatus"];
export type ClientErrorBatch = components["schemas"]["ClientErrorBatch"];
export type ClientErrorInput = components["schemas"]["ClientErrorInput"];
export type ClientPresenceStatus = components["schemas"]["ClientPresenceStatus"];
export type ClientStatus = components["schemas"]["ClientStatus"];
export type CompleteUploadRequest = components["schemas"]["CompleteUploadRequest"];
export type Consents = components["schemas"]["Consents"];
export type CreateApplicationRequest = components["schemas"]["CreateApplicationRequest"];
export type CreateBanRequest = components["schemas"]["CreateBanRequest"];
export type CreateChannelRequest = components["schemas"]["CreateChannelRequest"];
export type CreateDMRequest = components["schemas"]["CreateDMRequest"];
export type CreateGuildRequest = components["schemas"]["CreateGuildRequest"];
export type CreateInviteRequest = components["schemas"]["CreateInviteRequest"];
export type CreateMessageRequest = components["schemas"]["CreateMessageRequest"];
export type CreateRelationshipRequest = components["schemas"]["CreateRelationshipRequest"];
export type CreateRoleRequest = components["schemas"]["CreateRoleRequest"];
export type CreateUploadRequest = components["schemas"]["CreateUploadRequest"];
export type CurrentUser = components["schemas"]["CurrentUser"];
export type DMChannel = components["schemas"]["DMChannel"];
export type DefaultMessageNotifications = components["schemas"]["DefaultMessageNotifications"];
export const DefaultMessageNotifications = {
  ALL_MESSAGES: 0,
  ONLY_MENTIONS: 1,
} as const satisfies Record<string, DefaultMessageNotifications>;
export type DownloadUrl = components["schemas"]["DownloadUrl"];
export type Emoji = components["schemas"]["Emoji"];
export type ErrorCode = components["schemas"]["ErrorCode"];
export type ErrorEvent = components["schemas"]["ErrorEvent"];
export type ErrorGroup = components["schemas"]["ErrorGroup"];
export type ErrorGroupDetailResponse = components["schemas"]["ErrorGroupDetailResponse"];
export type ErrorGroupListResponse = components["schemas"]["ErrorGroupListResponse"];
export type ErrorGroupStatus = components["schemas"]["ErrorGroupStatus"];
export type ErrorGroupStatusUpdate = components["schemas"]["ErrorGroupStatusUpdate"];
export type ErrorSource = components["schemas"]["ErrorSource"];
export type FieldError = components["schemas"]["FieldError"];
export type ForgotPasswordRequest = components["schemas"]["ForgotPasswordRequest"];
export type GatewayClientFrame = components["schemas"]["GatewayClientFrame"];
export type GatewayCloseCode = components["schemas"]["GatewayCloseCode"];
export const GatewayCloseCode = {
  UNKNOWN_ERROR: 4000,
  UNKNOWN_OPCODE: 4001,
  DECODE_ERROR: 4002,
  NOT_AUTHENTICATED: 4003,
  AUTHENTICATION_FAILED: 4004,
  ALREADY_AUTHENTICATED: 4005,
  INVALID_SEQ: 4007,
  RATE_LIMITED: 4008,
  SESSION_TIMED_OUT: 4009,
  INVALID_API_VERSION: 4012,
} as const satisfies Record<string, GatewayCloseCode>;
export type GatewayDispatchFrame = components["schemas"]["GatewayDispatchFrame"];
export type GatewayEventName = components["schemas"]["GatewayEventName"];
export type GatewayGuild = components["schemas"]["GatewayGuild"];
export type GatewayHeartbeatAckFrame = components["schemas"]["GatewayHeartbeatAckFrame"];
export type GatewayHeartbeatFrame = components["schemas"]["GatewayHeartbeatFrame"];
export type GatewayHello = components["schemas"]["GatewayHello"];
export type GatewayHelloFrame = components["schemas"]["GatewayHelloFrame"];
export type GatewayIdentify = components["schemas"]["GatewayIdentify"];
export type GatewayIdentifyFrame = components["schemas"]["GatewayIdentifyFrame"];
export type GatewayIdentifyProperties = components["schemas"]["GatewayIdentifyProperties"];
export type GatewayInfo = components["schemas"]["GatewayInfo"];
export type GatewayInvalidSessionFrame = components["schemas"]["GatewayInvalidSessionFrame"];
export type GatewayOpcode = components["schemas"]["GatewayOpcode"];
export const GatewayOpcode = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  PRESENCE_UPDATE: 3,
  VOICE_STATE_UPDATE: 4,
  RESUME: 6,
  RECONNECT: 7,
  REQUEST_GUILD_MEMBERS: 8,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
  LAZY_REQUEST: 14,
} as const satisfies Record<string, GatewayOpcode>;
export type GatewayPresenceUpdate = components["schemas"]["GatewayPresenceUpdate"];
export type GatewayPresenceUpdateFrame = components["schemas"]["GatewayPresenceUpdateFrame"];
export type GatewayReconnectFrame = components["schemas"]["GatewayReconnectFrame"];
export type GatewayRequestGuildMembers = components["schemas"]["GatewayRequestGuildMembers"];
export type GatewayResume = components["schemas"]["GatewayResume"];
export type GatewayResumeFrame = components["schemas"]["GatewayResumeFrame"];
export type GatewayServerFrame = components["schemas"]["GatewayServerFrame"];
export type GatewayVoiceStateUpdate = components["schemas"]["GatewayVoiceStateUpdate"];
export type Guild = components["schemas"]["Guild"];
export type GuildBanAddDispatch = components["schemas"]["GuildBanAddDispatch"];
export type GuildBanEvent = components["schemas"]["GuildBanEvent"];
export type GuildBanRemoveDispatch = components["schemas"]["GuildBanRemoveDispatch"];
export type GuildCreateDispatch = components["schemas"]["GuildCreateDispatch"];
export type GuildDeleteDispatch = components["schemas"]["GuildDeleteDispatch"];
export type GuildDeleteEvent = components["schemas"]["GuildDeleteEvent"];
export type GuildMember = components["schemas"]["GuildMember"];
export type GuildMemberAddDispatch = components["schemas"]["GuildMemberAddDispatch"];
export type GuildMemberEvent = components["schemas"]["GuildMemberEvent"];
export type GuildMemberRemoveDispatch = components["schemas"]["GuildMemberRemoveDispatch"];
export type GuildMemberRemoveEvent = components["schemas"]["GuildMemberRemoveEvent"];
export type GuildMemberUpdateDispatch = components["schemas"]["GuildMemberUpdateDispatch"];
export type GuildRoleCreateDispatch = components["schemas"]["GuildRoleCreateDispatch"];
export type GuildRoleDeleteDispatch = components["schemas"]["GuildRoleDeleteDispatch"];
export type GuildRoleDeleteEvent = components["schemas"]["GuildRoleDeleteEvent"];
export type GuildRoleEvent = components["schemas"]["GuildRoleEvent"];
export type GuildRoleUpdateDispatch = components["schemas"]["GuildRoleUpdateDispatch"];
export type GuildTemplate = components["schemas"]["GuildTemplate"];
export type GuildUpdateDispatch = components["schemas"]["GuildUpdateDispatch"];
export type HealthStatus = components["schemas"]["HealthStatus"];
export type InstanceInfo = components["schemas"]["InstanceInfo"];
export type InstanceSettings = components["schemas"]["InstanceSettings"];
export type InstanceSettingsPatch = components["schemas"]["InstanceSettingsPatch"];
export type Invite = components["schemas"]["Invite"];
export type InviteAcceptResult = components["schemas"]["InviteAcceptResult"];
export type InviteChannel = components["schemas"]["InviteChannel"];
export type InviteGuild = components["schemas"]["InviteGuild"];
export type InviteWithMetadata = components["schemas"]["InviteWithMetadata"];
export type LoginRequest = components["schemas"]["LoginRequest"];
export type MediaDiagnosisCode = components["schemas"]["MediaDiagnosisCode"];
export type MediaSampleInput = components["schemas"]["MediaSampleInput"];
export type MediaSessionSummaryInput = components["schemas"]["MediaSessionSummaryInput"];
export type MediaTelemetryBatch = components["schemas"]["MediaTelemetryBatch"];
export type MediaTelemetryKind = components["schemas"]["MediaTelemetryKind"];
export type MediaTelemetryRole = components["schemas"]["MediaTelemetryRole"];
export type Message = components["schemas"]["Message"];
export type MessageAckDispatch = components["schemas"]["MessageAckDispatch"];
export type MessageAckEvent = components["schemas"]["MessageAckEvent"];
export type MessageCreateDispatch = components["schemas"]["MessageCreateDispatch"];
export type MessageCreateEvent = components["schemas"]["MessageCreateEvent"];
export type MessageDeleteDispatch = components["schemas"]["MessageDeleteDispatch"];
export type MessageDeleteEvent = components["schemas"]["MessageDeleteEvent"];
export type MessageDensity = components["schemas"]["MessageDensity"];
export type MessageReactionAddDispatch = components["schemas"]["MessageReactionAddDispatch"];
export type MessageReactionEvent = components["schemas"]["MessageReactionEvent"];
export type MessageReactionRemoveDispatch = components["schemas"]["MessageReactionRemoveDispatch"];
export type MessageReference = components["schemas"]["MessageReference"];
export type MessageType = components["schemas"]["MessageType"];
export const MessageType = {
  DEFAULT: 0,
  GUILD_MEMBER_JOIN: 7,
  REPLY: 19,
} as const satisfies Record<string, MessageType>;
export type MessageUpdateDispatch = components["schemas"]["MessageUpdateDispatch"];
export type OverwriteInput = components["schemas"]["OverwriteInput"];
export type OverwriteType = components["schemas"]["OverwriteType"];
export const OverwriteType = {
  ROLE: 0,
  MEMBER: 1,
} as const satisfies Record<string, OverwriteType>;
export type PartialMember = components["schemas"]["PartialMember"];
export type PermissionBit = components["schemas"]["PermissionBit"];
export const PermissionBit = {
  CREATE_INSTANT_INVITE: 0,
  KICK_MEMBERS: 1,
  BAN_MEMBERS: 2,
  ADMINISTRATOR: 3,
  MANAGE_CHANNELS: 4,
  MANAGE_GUILD: 5,
  ADD_REACTIONS: 6,
  VIEW_AUDIT_LOG: 7,
  PRIORITY_SPEAKER: 8,
  STREAM: 9,
  VIEW_CHANNEL: 10,
  SEND_MESSAGES: 11,
  SEND_TTS_MESSAGES: 12,
  MANAGE_MESSAGES: 13,
  EMBED_LINKS: 14,
  ATTACH_FILES: 15,
  READ_MESSAGE_HISTORY: 16,
  MENTION_EVERYONE: 17,
  USE_EXTERNAL_EMOJIS: 18,
  VIEW_GUILD_INSIGHTS: 19,
  CONNECT: 20,
  SPEAK: 21,
  MUTE_MEMBERS: 22,
  DEAFEN_MEMBERS: 23,
  MOVE_MEMBERS: 24,
  USE_VAD: 25,
  CHANGE_NICKNAME: 26,
  MANAGE_NICKNAMES: 27,
  MANAGE_ROLES: 28,
  MANAGE_WEBHOOKS: 29,
  MANAGE_GUILD_EXPRESSIONS: 30,
  USE_APPLICATION_COMMANDS: 31,
  REQUEST_TO_SPEAK: 32,
  MANAGE_EVENTS: 33,
  MANAGE_THREADS: 34,
  CREATE_PUBLIC_THREADS: 35,
  CREATE_PRIVATE_THREADS: 36,
  USE_EXTERNAL_STICKERS: 37,
  SEND_MESSAGES_IN_THREADS: 38,
  USE_EMBEDDED_ACTIVITIES: 39,
  MODERATE_MEMBERS: 40,
  VIEW_CREATOR_MONETIZATION_ANALYTICS: 41,
  USE_SOUNDBOARD: 42,
  CREATE_GUILD_EXPRESSIONS: 43,
  CREATE_EVENTS: 44,
  USE_EXTERNAL_SOUNDS: 45,
  SEND_VOICE_MESSAGES: 46,
  SEND_POLLS: 49,
  USE_EXTERNAL_APPS: 50,
  PIN_MESSAGES: 51,
  BYPASS_SLOWMODE: 52,
} as const satisfies Record<string, PermissionBit>;
export type PermissionBits = components["schemas"]["PermissionBits"];
export type PermissionOverwrite = components["schemas"]["PermissionOverwrite"];
export type Presence = components["schemas"]["Presence"];
export type PresenceStatus = components["schemas"]["PresenceStatus"];
export type PresenceUpdateDispatch = components["schemas"]["PresenceUpdateDispatch"];
export type PresenceUpdateEvent = components["schemas"]["PresenceUpdateEvent"];
export type PutOverwriteRequest = components["schemas"]["PutOverwriteRequest"];
export type Reaction = components["schemas"]["Reaction"];
export type ReadState = components["schemas"]["ReadState"];
export type ReadyDispatch = components["schemas"]["ReadyDispatch"];
export type ReadyEvent = components["schemas"]["ReadyEvent"];
export type ReadyStatus = components["schemas"]["ReadyStatus"];
export type RegisterRequest = components["schemas"]["RegisterRequest"];
export type RegistrationMode = components["schemas"]["RegistrationMode"];
export type Relationship = components["schemas"]["Relationship"];
export type RelationshipAddDispatch = components["schemas"]["RelationshipAddDispatch"];
export type RelationshipRemoveDispatch = components["schemas"]["RelationshipRemoveDispatch"];
export type RelationshipRemoveEvent = components["schemas"]["RelationshipRemoveEvent"];
export type RelationshipType = components["schemas"]["RelationshipType"];
export const RelationshipType = {
  FRIEND: 1,
  BLOCKED: 2,
  INCOMING_REQUEST: 3,
  OUTGOING_REQUEST: 4,
} as const satisfies Record<string, RelationshipType>;
export type ResetPasswordRequest = components["schemas"]["ResetPasswordRequest"];
export type ResumedDispatch = components["schemas"]["ResumedDispatch"];
export type RevokeOthersResult = components["schemas"]["RevokeOthersResult"];
export type Role = components["schemas"]["Role"];
export type RolePosition = components["schemas"]["RolePosition"];
export type SettingSource = components["schemas"]["SettingSource"];
export type SetupAdminInput = components["schemas"]["SetupAdminInput"];
export type SetupRequest = components["schemas"]["SetupRequest"];
export type SetupStatus = components["schemas"]["SetupStatus"];
export type SiteSettings = components["schemas"]["SiteSettings"];
export type SiteSettingsInput = components["schemas"]["SiteSettingsInput"];
export type SiteSettingsPatch = components["schemas"]["SiteSettingsPatch"];
export type SmtpSettings = components["schemas"]["SmtpSettings"];
export type SmtpSettingsInput = components["schemas"]["SmtpSettingsInput"];
export type SmtpSettingsPatch = components["schemas"]["SmtpSettingsPatch"];
export type SmtpTestRequest = components["schemas"]["SmtpTestRequest"];
export type SmtpTls = components["schemas"]["SmtpTls"];
export type Snowflake = components["schemas"]["Snowflake"];
export type Theme = components["schemas"]["Theme"];
export type TransferOwnershipRequest = components["schemas"]["TransferOwnershipRequest"];
export type TypingStartDispatch = components["schemas"]["TypingStartDispatch"];
export type TypingStartEvent = components["schemas"]["TypingStartEvent"];
export type UpdateApplicationRequest = components["schemas"]["UpdateApplicationRequest"];
export type UpdateChannelRequest = components["schemas"]["UpdateChannelRequest"];
export type UpdateCurrentUserRequest = components["schemas"]["UpdateCurrentUserRequest"];
export type UpdateGuildRequest = components["schemas"]["UpdateGuildRequest"];
export type UpdateMemberRequest = components["schemas"]["UpdateMemberRequest"];
export type UpdateMessageRequest = components["schemas"]["UpdateMessageRequest"];
export type UpdateMyMemberRequest = components["schemas"]["UpdateMyMemberRequest"];
export type UpdateRoleRequest = components["schemas"]["UpdateRoleRequest"];
export type UpdateUserSettingsRequest = components["schemas"]["UpdateUserSettingsRequest"];
export type UpdateVoiceStateRequest = components["schemas"]["UpdateVoiceStateRequest"];
export type UploadTicket = components["schemas"]["UploadTicket"];
export type User = components["schemas"]["User"];
export type UserSettings = components["schemas"]["UserSettings"];
export type UserSettingsUpdateDispatch = components["schemas"]["UserSettingsUpdateDispatch"];
export type UserUpdateDispatch = components["schemas"]["UserUpdateDispatch"];
export type UsernameAvailability = components["schemas"]["UsernameAvailability"];
export type VerifyEmailRequest = components["schemas"]["VerifyEmailRequest"];
export type VoiceGrants = components["schemas"]["VoiceGrants"];
export type VoiceJoinRequest = components["schemas"]["VoiceJoinRequest"];
export type VoiceJoinResponse = components["schemas"]["VoiceJoinResponse"];
export type VoiceState = components["schemas"]["VoiceState"];
export type VoiceStateUpdateDispatch = components["schemas"]["VoiceStateUpdateDispatch"];
export type VoiceTrackSource = components["schemas"]["VoiceTrackSource"];

/** İzin değerleri (`1n << bit`). API'de string taşınır: `BigInt(role.permissions) & PERMISSIONS.SEND_MESSAGES`. */
export const PERMISSIONS = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  SEND_TTS_MESSAGES: 1n << 12n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  VIEW_GUILD_INSIGHTS: 1n << 19n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_GUILD_EXPRESSIONS: 1n << 30n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  USE_EMBEDDED_ACTIVITIES: 1n << 39n,
  MODERATE_MEMBERS: 1n << 40n,
  VIEW_CREATOR_MONETIZATION_ANALYTICS: 1n << 41n,
  USE_SOUNDBOARD: 1n << 42n,
  CREATE_GUILD_EXPRESSIONS: 1n << 43n,
  CREATE_EVENTS: 1n << 44n,
  USE_EXTERNAL_SOUNDS: 1n << 45n,
  SEND_VOICE_MESSAGES: 1n << 46n,
  SEND_POLLS: 1n << 49n,
  USE_EXTERNAL_APPS: 1n << 50n,
  PIN_MESSAGES: 1n << 51n,
  BYPASS_SLOWMODE: 1n << 52n,
} as const;
export type PermissionName = keyof typeof PERMISSIONS;
