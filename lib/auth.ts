import type { NextAuthOptions, Session } from 'next-auth';
import { getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async signIn({ user }) {
      return user.email === process.env.ALLOWED_USER_EMAIL;
    },
    async session({ session }) {
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export function getSession() {
  return getServerSession(authOptions);
}

export async function requireUser(): Promise<Session & { user: { email: string } }> {
  const session = await getSession();
  const email = session?.user?.email;
  if (!email || email !== process.env.ALLOWED_USER_EMAIL) {
    throw new Error('UNAUTHORIZED');
  }
  return session as Session & { user: { email: string } };
}