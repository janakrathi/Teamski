// ==========================================
// SHARED TYPES
// ==========================================

export type Project = {
  id: string;
  name: string;
  created_at?: string;
};

export type Channel = {
  id: string;
  project_id: string;
  name: string;
  created_at?: string;

  // Private: only the people listed on it (and owners
  // and admins) see it. Absent before migration 0034.
  restricted?: boolean;
};

export type Member = {
  id: string;
  email: string;
  display_name?: string | null;

  // Set once somebody picks one in settings.
  username?: string | null;
  avatar_url?: string | null;
  role?: string;
};

export type DMConversation = {
  id: string;
  other_user: Member;
};
