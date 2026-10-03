"use client";

import { useState } from "react";

import Logo from "@/components/ui/Logo";

import ProjectSwitcher from "./ProjectSwitcher";

import {
  Hash,
  Plus,
  Settings,
} from "@/components/ui/Icons";

import type {
  Channel,
  Member,
  Project,
} from "@/components/types";


// ==========================================
// SECTION HEADING
// ==========================================

function SectionLabel({
  children,
  onAdd,
  addLabel,
}: {
  children: React.ReactNode;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between px-3 pb-1">
      <span className="text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
        {children}
      </span>

      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          title={addLabel}
          aria-label={addLabel}
          className="-my-2 -mr-2 flex h-8 w-8 items-center justify-center rounded text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-muted)] md:my-0 md:mr-0 md:h-4 md:w-4"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}


// ==========================================
// UNREAD BADGE
// ==========================================
//
// Deliberately quiet. This sits in a list you
// scan rather than read, so the count is small
// and the weight of the name beside it is doing
// most of the work.
//

function Unread({ count }: { count: number }) {
  if (count < 1) {
    return null;
  }

  return (
    <span
      aria-label={`${count} unread`}
      className="ml-auto shrink-0 rounded-full bg-[var(--accent)] px-1.5 py-px text-[10px] leading-[15px] font-medium tabular-nums text-[var(--bg)]"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}


// ==========================================
// AVATAR
// ==========================================

function Avatar({ member }: { member: Member }) {
  const label =
    member.display_name ||
    member.username ||
    member.email ||
    "?";

  return (
    <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--bg-raised)] text-[9px] font-medium text-[var(--text-muted)]">
      {label.charAt(0).toUpperCase()}
    </span>
  );
}


// ==========================================
// SIDEBAR
// ==========================================

export default function Sidebar({
  projects,
  currentProject,
  onSelectProject,
  onCreateProject,
  onRenameProject,

  unreadChannels,
  unreadDMs,

  channels,
  currentChannel,
  onSelectChannel,
  onCreateChannel,
  onRenameChannel,
  onDeleteChannel,
  channelsNeedMigration,

  members,
  activeMemberId,
  onOpenDM,

  onOpenSettings,
}: {
  projects: Project[];
  currentProject: Project | null;
  onSelectProject: (project: Project) => void;
  onCreateProject: () => void;
  onRenameProject: (project: Project) => void;

  unreadChannels: Record<string, number>;
  unreadDMs: Record<string, number>;

  channels: Channel[];
  currentChannel: Channel | null;
  onSelectChannel: (channel: Channel) => void;
  onCreateChannel: () => void;
  onRenameChannel: (channel: Channel) => void;
  onDeleteChannel: (channel: Channel) => void;
  channelsNeedMigration: boolean;

  members: Member[];
  activeMemberId: string | null;
  onOpenDM: (member: Member) => void;

  onOpenSettings: () => void;
}) {
  // Which channel's row menu (rename / delete) is open.
  const [channelMenu, setChannelMenu] = useState<
    string | null
  >(null);
  return (
    <aside className="flex h-full w-full flex-col pb-[env(safe-area-inset-bottom)] border-r border-[var(--border)] bg-[var(--bg-panel)]">

      {/* -------------------------------- */}
      {/* BRAND                            */}
      {/* -------------------------------- */}

      <div className="flex items-center gap-2 px-4 pt-3.5">
        <Logo size={22} />

        <span className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--text)]">
          Teamski
        </span>
      </div>


      {/* -------------------------------- */}
      {/* PROJECT                          */}
      {/* -------------------------------- */}

      <ProjectSwitcher
        projects={projects}
        current={currentProject}
        onSelect={onSelectProject}
        onCreate={onCreateProject}
        onRename={onRenameProject}
      />

      <div className="mt-2 h-px bg-[var(--border)]" />


      <div className="flex-1 overflow-y-auto py-3">

        {/* ------------------------------ */}
        {/* CHANNELS                       */}
        {/* ------------------------------ */}

        <SectionLabel
          onAdd={
            currentProject
              ? onCreateChannel
              : undefined
          }
          addLabel="New channel"
        >
          Channels
        </SectionLabel>

        <div className="px-2">
          {channelsNeedMigration ? (
            <p className="px-1 py-1.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
              Run{" "}
              <code className="text-[var(--text-muted)]">
                supabase/migrations/0001_channels.sql
              </code>{" "}
              to enable channels.
            </p>
          ) : channels.length === 0 ? (
            <p className="px-1 py-1.5 text-[11px] text-[var(--text-faint)]">
              {currentProject
                ? "No channels yet."
                : "Select a project."}
            </p>
          ) : (
            channels.map((channel) => {
              const active =
                channel.id === currentChannel?.id &&
                !activeMemberId;

              // The channel you are looking at is
              // read by definition, so never
              // badge it - a count that appears
              // on the row you are reading is
              // just noise.

              const unread = active
                ? 0
                : (unreadChannels[channel.id] ?? 0);

              return (
                <div
                  key={channel.id}
                  className={`group relative flex w-full items-center gap-2 rounded-md px-2 py-[7px] transition ${
                    active
                      ? "bg-[var(--bg-hover)] text-[var(--text)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      onSelectChannel(channel)
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Hash
                      className={`h-3.5 w-3.5 shrink-0 ${
                        active
                          ? "text-[var(--accent)]"
                          : "text-[var(--text-faint)]"
                      }`}
                    />

                    <span
                      className={`min-w-0 flex-1 truncate text-[13px] ${
                        unread > 0
                          ? "font-medium text-[var(--text)]"
                          : ""
                      }`}
                    >
                      {channel.name}
                    </span>
                  </button>

                  {unread > 0 &&
                    channelMenu !== channel.id && (
                      <Unread count={unread} />
                    )}

                  {/* Rename / delete, on hover. */}
                  <button
                    type="button"
                    aria-label="Channel options"
                    onClick={() =>
                      setChannelMenu((open) =>
                        open === channel.id
                          ? null
                          : channel.id
                      )
                    }
                    className={`shrink-0 rounded px-1 text-[13px] leading-none text-[var(--text-faint)] transition hover:text-[var(--text)] ${
                      channelMenu === channel.id
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    ⋯
                  </button>

                  {channelMenu === channel.id && (
                    <>
                      {/* Click-away catcher. */}
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() =>
                          setChannelMenu(null)
                        }
                      />

                      <div data-origin="top-right" className="t-dropdown absolute top-full right-1 z-20 mt-1 w-32 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] py-1 shadow-xl">
                        <button
                          type="button"
                          onClick={() => {
                            setChannelMenu(null);
                            onRenameChannel(channel);
                          }}
                          className="block w-full px-3 py-1.5 text-left text-[12.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]"
                        >
                          Rename
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setChannelMenu(null);
                            onDeleteChannel(channel);
                          }}
                          className="block w-full px-3 py-1.5 text-left text-[12.5px] text-red-400 transition hover:bg-[var(--bg-hover)]"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>


        {/* ------------------------------ */}
        {/* DIRECT MESSAGES                */}
        {/* ------------------------------ */}

        <div className="mt-5">
          <SectionLabel>
            Direct messages
          </SectionLabel>

          <div className="px-2">
            {members.length === 0 ? (
              <p className="px-1 py-1.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
                {currentProject
                  ? "No teammates in this project yet."
                  : "Select a project."}
              </p>
            ) : (
              members.map((member) => {
                const active =
                  member.id === activeMemberId;

                const label =
                  member.display_name ||
                  member.username ||
                  member.email;

                const unread = active
                  ? 0
                  : (unreadDMs[member.id] ?? 0);

                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() =>
                      onOpenDM(member)
                    }
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-[7px] text-left transition ${
                      active
                        ? "bg-[var(--bg-hover)] text-[var(--text)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                    }`}
                  >
                    <Avatar member={member} />

                    <span
                      className={`min-w-0 flex-1 truncate text-[13px] ${
                        unread > 0
                          ? "font-medium text-[var(--text)]"
                          : ""
                      }`}
                    >
                      {label}
                    </span>

                    <Unread count={unread} />
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>


      {/* -------------------------------- */}
      {/* FOOTER                           */}
      {/* -------------------------------- */}

      <div className="border-t border-[var(--border)] p-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          <Settings className="h-3.5 w-3.5" />

          <span className="text-[12.5px]">
            Agent settings
          </span>
        </button>
      </div>
    </aside>
  );
}
