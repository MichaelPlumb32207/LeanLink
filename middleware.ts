import { withAuth } from 'next-auth/middleware';

export default withAuth({
  pages: { signIn: '/login' },
});

export const config = {
  matcher: ['/dashboard/:path*', '/api/uploads/:path*', '/api/results/:path*', '/api/export/:path*'],
};