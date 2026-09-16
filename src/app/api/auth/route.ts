import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, password } = body;
    
    if (!id || !password) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const safeId = id.trim().toLowerCase();
    const safePw = password.trim().toLowerCase();
    
    if (safeId === "admin" && (safePw === "yeşil" || safePw === "yesil")) {
      const cookieStore = await cookies();
      
      // Server-side cookie (Çok daha güvenli ve Safari/Mobile uyumlu)
      // Firebase Hosting SADECE '__session' isimli çerezlere izin verir!
      cookieStore.set('__session', 'admin_active_session', {
        path: '/',
        maxAge: 86400, // 1 gün
        sameSite: 'lax',
        secure: true, // Her zaman HTTPS varsayıyoruz (Firebase Hosting)
        httpOnly: true // JavaScript'ten erişilemez (Ekstra Güvenlik)
      });

      return NextResponse.json({ success: true });
    }
    
    return NextResponse.json({ success: false, message: 'Geçersiz kimlik veya parola!' }, { status: 401 });
  } catch (error) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
