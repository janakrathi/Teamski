// ==========================================
// "THIS EMAIL ALREADY HAS AN ACCOUNT"
// ==========================================
//
// Supabase answers a sign-up for a taken address in one
// of two ways, depending on the project's settings:
//
//   an error ("User already registered") when sign-up
//   signs people straight in; or
//
//   no error at all, and a user with an empty identities
//   list, when it asks people to confirm their address
//   first - it keeps quiet so nobody can test addresses.
//
// Both mean the same thing to the person: sign in.
//

type SignUpResult = {
  data?: {
    user?: { identities?: unknown[] | null } | null;
  } | null;
  error?: { message?: string } | null;
};


export function emailAlreadyUsed(result: SignUpResult) {
  if (result.error) {
    return /already registered|already exists|already been registered|already in use/i.test(
      result.error.message ?? ""
    );
  }

  const identities = result.data?.user?.identities;

  return Array.isArray(identities) && identities.length === 0;
}
