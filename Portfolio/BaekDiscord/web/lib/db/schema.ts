import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// M1 tables only (design: docs/designs/devhub.md → 데이터 모델).
// 금지: 점수·랭킹·리더보드·스트릭 테이블/컬럼.

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  handle: text("handle").notNull(),
  avatar: text("avatar"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const identities = pgTable(
  "identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["github", "discord", "solvedac"] }).notNull(),
    externalId: text("external_id").notNull(),
    githubLogin: text("github_login"),
    tokenRef: text("token_ref"),
  },
  (t) => [uniqueIndex("identities_provider_external_idx").on(t.provider, t.externalId)],
);

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  discordWebhookUrlEnc: text("discord_webhook_url_enc").notNull(),
  showCommitTitles: boolean("show_commit_titles").notNull().default(false),
  webhookInvalid: boolean("webhook_invalid").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["lead", "member"] }).notNull().default("member"),
    status: text("status", { enum: ["active", "pending"] }).notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("team_members_pk").on(t.teamId, t.userId)],
);

export const installations = pgTable("installations", {
  id: text("id").primaryKey(),
  teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
  githubInstallationId: integer("github_installation_id").notNull().unique(),
  installedByUserId: text("installed_by_user_id").references(() => users.id),
  active: boolean("active").notNull().default(true),
});

export const teamRepos = pgTable(
  "team_repos",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    repoFullName: text("repo_full_name").notNull(),
    installationId: text("installation_id").references(() => installations.id, { onDelete: "cascade" }),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("team_repos_pk").on(t.teamId, t.repoFullName)],
);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activityEvents = pgTable(
  "activity_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    githubLogin: text("github_login"),
    sourceKind: text("source_kind", { enum: ["github", "editor", "solvedac"] }).notNull(),
    sourceId: text("source_id"),
    type: text("type", {
      enum: ["commit", "pr_opened", "pr_merged", "pr_closed", "release", "editor_session"],
    }).notNull(),
    tsReceived: timestamp("ts_received", { withTimezone: true }).notNull(),
    tsAuthored: timestamp("ts_authored", { withTimezone: true }),
    repo: text("repo"),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
    dedupKey: text("dedup_key").notNull().unique(),
    needsBackfill: boolean("needs_backfill").notNull().default(false),
  },
  (t) => [index("activity_events_repo_received_idx").on(t.repo, t.tsReceived)],
);

export const digests = pgTable(
  "digests",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD (KST digest day)
    status: text("status", { enum: ["draft", "published", "skipped", "failed"] }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    discordMessageId: text("discord_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("digests_team_date_idx").on(t.teamId, t.date)],
);

export const digestMembers = pgTable(
  "digest_members",
  {
    digestId: text("digest_id")
      .notNull()
      .references(() => digests.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    optedOut: boolean("opted_out").notNull().default(false),
    blockedNote: text("blocked_note"),
  },
  (t) => [uniqueIndex("digest_members_pk").on(t.digestId, t.userId)],
);

export const digestItems = pgTable(
  "digest_items",
  {
    digestId: text("digest_id")
      .notNull()
      .references(() => digests.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => activityEvents.id, { onDelete: "cascade" }),
    included: boolean("included").notNull().default(true),
  },
  (t) => [uniqueIndex("digest_items_pk").on(t.digestId, t.eventId)],
);

export const invites = pgTable("invites", {
  token: text("token").primaryKey(),
  teamId: text("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  createdBy: text("created_by").references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type ActivityEvent = typeof activityEvents.$inferSelect;
export type Digest = typeof digests.$inferSelect;
export type DigestMember = typeof digestMembers.$inferSelect;
export type DigestItem = typeof digestItems.$inferSelect;
export type Invite = typeof invites.$inferSelect;
