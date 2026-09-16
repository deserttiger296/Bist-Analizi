import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Login sayfası veya public API'ler dışındaki her şeyi koru
  if (
    pathname.startsWith('/_next') || 
    pathname.startsWith('/api') || 
    pathname === '/login' ||
    pathname.includes('.') // public dosyalar (favicon vb)
  ) {
    return NextResponse.next();
  }

  // Cookie kontrolü
  const authCookie = request.cookies.get('__session');
  
  if (!authCookie || authCookie.value !== 'admin_active_session') {
    // Cookie yoksa veya yanlışsa login'e yönlendir
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Tüm sayfalarda çalışacak
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
