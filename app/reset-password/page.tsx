import type { Metadata } from "next";

import ResetPasswordForm from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};


// ==========================================
// CHOOSING A NEW PASSWORD
// ==========================================
//
// Reached from the link in the reset email. That
// link goes through /auth/callback first, which
// signs the person in, so by the time they are
// here there is a session to change the password
// on. Without one the proxy sends them to /login,
// like any other page that needs signing in.
//

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
