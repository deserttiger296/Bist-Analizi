"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";

export function PrivacyClient() {
  const [lang, setLang] = useState<"tr" | "en">("tr");

  const trSection = (
    <article
      id="privacy-tr"
      lang="tr"
      className={`rounded-2xl border p-6 sm:p-10 transition-all duration-200 ${
        lang === "tr"
          ? "bg-slate-900/80 border-cyan-500/40 shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
          : "bg-slate-900/40 border-slate-800/80 opacity-90"
      }`}
    >
      <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-400 bg-cyan-950/60 border border-cyan-500/30 px-3 py-1 rounded-full mb-4">
        <span>TR · Türkçe</span>
      </div>
      <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-2">
        Gizlilik Politikası – BIST Analizi
      </h1>
      <p className="text-xs sm:text-sm text-slate-400 mb-6 font-medium">
        Son güncelleme: 15 Kasım 2026
      </p>

      <p className="text-sm sm:text-base text-slate-200 leading-relaxed mb-6">
        BIST Analizi (&quot;Uygulama&quot;, &quot;biz&quot;), Borsa İstanbul (BIST) hisseleri için teknik analiz ve sinyal tarama hizmeti sunan bir web uygulamasıdır ve{" "}
        <a
          href="https://bist-analizi.vercel.app"
          className="text-cyan-400 hover:text-cyan-300 underline underline-offset-4"
        >
          https://bist-analizi.vercel.app
        </a>{" "}
        adresinde yayındadır. Bu politika, hangi verileri işlediğimizi ve nedenini açıklar.
      </p>

      <div className="space-y-6 text-sm sm:text-base text-slate-300 leading-relaxed">
        <section>
          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">
            1. Topladığımız veriler
          </h2>
          <p>
            Google ile giriş yaptığınızda yalnızca temel Google profil bilgilerinizi alırız: ad, e-posta adresi ve profil fotoğrafı. Gmail, Drive, Takvim veya kişiler gibi başka hiçbir Google kullanıcı verisini istemeyiz ve bunlara erişmeyiz. Uygulamada izleme listesi veya ayar oluşturursanız, bir sonraki girişinizde kullanılabilmesi için bunları saklarız.
          </p>
        </section>

        <section>
          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">
            2. Verileri nasıl kullanıyoruz
          </h2>
          <p>
            Bu verileri yalnızca (a) kimliğinizi doğrulamak ve oturumunuzu açık tutmak, (b) Uygulamayı kişiselleştirmek (tercihlerinizi ve izleme listelerinizi kaydetmek) ve (c) gerekirse hizmetle ilgili sizinle iletişime geçmek için kullanırız. Verilerinizi reklam amacıyla kullanmayız ve reklam profili oluşturmayız.
          </p>
        </section>

        <section>
          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">
            3. Paylaşım
          </h2>
          <p>
            Kişisel verilerinizi satmayız, kiralamayız ve takas etmeyiz. Verilerinizi, yalnızca hizmetin çalışması için gerektiği ölçüde Uygulamayı bizim adımıza barındıran altyapı sağlayıcıları (ör. Vercel ve veritabanı veya kimlik doğrulama sağlayıcımız) dışında üçüncü taraflarla paylaşmayız. Yasal zorunluluk halinde paylaşım yapılabilir.
          </p>
        </section>

        <section>
          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">
            4. Google API Hizmetleri Kullanıcı Verileri Politikası
          </h2>
          <p>
            Uygulamanın Google API&apos;lerinden alınan bilgileri kullanımı ve aktarımı, Sınırlı Kullanım şartları dahil Google API Hizmetleri Kullanıcı Verileri Politikası&apos;na uygundur. Google&apos;dan alınan veriler yalnızca yukarıda açıklanan kullanıcıya dönük özellikleri sunmak ve geliştirmek için kullanılır. Hizmeti sunmak veya yasalara uymak için gerekli olması dışında başkalarına aktarılmaz, reklam için kullanılmaz ve güvenlik amaçları, yasal zorunluluk veya sizin izniniz dışında insanlar tarafından okunmaz.
          </p>
        </section>

        <section>
          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">
            5. Çerezler
          </h2>
          <p>
            Oturumunuzu açık tutmak için yalnızca zorunlu oturum çerezleri kullanırız. Reklam veya siteler arası takip çerezleri kullanmayız.
          </p>
        </section>

        <section>
          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">
            6. Saklama ve silme
          </h2>
          <p>
            Verilerinizi hesabınız aktif olduğu sürece saklarız. Hesabınızın ve ilgili tüm verilerin silinmesini istediğiniz zaman{" "}
            <a
              href="mailto:ogungunes99@gmail.com"
              className="text-cyan-400 hover:text-cyan-300 underline underline-offset-4"
            >
              ogungunes99@gmail.com
            </a>{" "}
            adresine e-posta göndererek talep edebilirsiniz; talebi 30 gün içinde işleriz. Uygulamanın erişimini ayrıca istediğiniz zaman{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 underline underline-offset-4"
            >
              https://myaccount.google.com/permissions
            </a>{" "}
            adresinden kaldırabilirsiniz.
          </p>
        </section>

        <section>
          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">
            7. Güvenlik
          </h2>
          <p>
            Verilerinizi korumak için sektör standardı önlemler (aktarım sırasında HTTPS şifrelemesi, erişim kontrolleri) kullanırız. Hiçbir iletim veya saklama yöntemi tamamen güvenli değildir, ancak bilgilerinizi korumak için çalışırız.
          </p>
        </section>

        <section>
          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">
            8. Yatırım tavsiyesi değildir
          </h2>
          <p>
            Uygulama yalnızca bilgilendirme amaçlı teknik analiz sunar. Yatırım danışmanlığı değildir.
          </p>
        </section>

        <section>
          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">
            9. Çocuklar
          </h2>
          <p>
            Uygulama 18 yaşın altındaki çocuklara yönelik değildir ve onların verilerini bilerek toplamayız.
          </p>
        </section>

        <section>
          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">
            10. Değişiklikler
          </h2>
          <p>
            Bu politikayı güncelleyebiliriz. Güncelleme yapıldığında &quot;Son güncelleme&quot; tarihi değişir.
          </p>
        </section>

        <section>
          <h2 className="text-lg sm:text-xl font-bold text-white mb-2">
            11. İletişim
          </h2>
          <p>
            Ogün Güneş –{" "}
            <a
              href="mailto:ogungunes99@gmail.com"
              className="text-cyan-400 hover:text-cyan-300 underline underline-offset-4"
            >
              ogungunes99@gmail.com
            </a>
          </p>
        </section>
      </div>
    </article>
  );

  const enSection = (
    <article
      id="privacy-en"
      lang="en"
      className={`rounded-2xl border p-6 sm:p-10 transition-all duration-200 ${
        lang === "en"
          ? "bg-slate-900/80 border-cyan-500/40 shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
          : "bg-slate-900/40 border-slate-800/80 opacity-90"
      }`}
    >
      <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-400 bg-cyan-950/60 border border-cyan-500/30 px-3 py-1 rounded-full mb-4">
        <span>EN · English</span>
      </div>
      <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-2">
        Privacy Policy – BIST Analizi
      </h2>
      <p className="text-xs sm:text-sm text-slate-400 mb-6 font-medium">
        Last updated: 15 November 2026
      </p>

      <p className="text-sm sm:text-base text-slate-200 leading-relaxed mb-6">
        BIST Analizi (&quot;the App&quot;, &quot;we&quot;) is a web application that provides technical analysis and signal scanning for Borsa Istanbul (BIST) stocks. It is available at{" "}
        <a
          href="https://bist-analizi.vercel.app"
          className="text-cyan-400 hover:text-cyan-300 underline underline-offset-4"
        >
          https://bist-analizi.vercel.app
        </a>
        . This policy explains what data we handle and why.
      </p>

      <div className="space-y-6 text-sm sm:text-base text-slate-300 leading-relaxed">
        <section>
          <h3 className="text-lg sm:text-xl font-bold text-white mb-2">
            1. Data we collect
          </h3>
          <p>
            When you sign in with Google, we receive only your basic Google profile information: your name, email address and profile picture. We do not request or access any other Google user data (such as Gmail, Drive, Calendar or contacts). If you create watchlists or settings in the App, we store them so they are available the next time you sign in.
          </p>
        </section>

        <section>
          <h3 className="text-lg sm:text-xl font-bold text-white mb-2">
            2. How we use your data
          </h3>
          <p>
            We use this data only to (a) authenticate you and keep you signed in, (b) personalize the App, such as saving your preferences and watchlists, and (c) contact you about the service if necessary. We do not use your data for advertising and do not build advertising profiles.
          </p>
        </section>

        <section>
          <h3 className="text-lg sm:text-xl font-bold text-white mb-2">
            3. Sharing
          </h3>
          <p>
            We do not sell, rent or trade your personal data. We do not share it with third parties, except with infrastructure providers that host the App on our behalf (for example Vercel and our database or authentication provider), only as needed to run the service, or when required by law.
          </p>
        </section>

        <section>
          <h3 className="text-lg sm:text-xl font-bold text-white mb-2">
            4. Google API Services User Data Policy
          </h3>
          <p>
            The App&apos;s use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. Data obtained from Google is used only to provide and improve the user-facing features described above. It is not transferred to others except as necessary to provide the service or to comply with law, it is not used for advertising, and humans do not read it except with your consent, for security purposes, or to comply with law.
          </p>
        </section>

        <section>
          <h3 className="text-lg sm:text-xl font-bold text-white mb-2">
            5. Cookies
          </h3>
          <p>
            We use only essential session cookies to keep you signed in. We do not use advertising or cross-site tracking cookies.
          </p>
        </section>

        <section>
          <h3 className="text-lg sm:text-xl font-bold text-white mb-2">
            6. Retention and deletion
          </h3>
          <p>
            We keep your data as long as your account is active. You can request deletion of your account and all associated data at any time by emailing{" "}
            <a
              href="mailto:ogungunes99@gmail.com"
              className="text-cyan-400 hover:text-cyan-300 underline underline-offset-4"
            >
              ogungunes99@gmail.com
            </a>
            . We will process the request within 30 days. You can also revoke the App&apos;s access at any time at{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 underline underline-offset-4"
            >
              https://myaccount.google.com/permissions
            </a>
            .
          </p>
        </section>

        <section>
          <h3 className="text-lg sm:text-xl font-bold text-white mb-2">
            7. Security
          </h3>
          <p>
            We use industry-standard measures (HTTPS encryption in transit, access controls) to protect your data. No method of transmission or storage is completely secure, but we work to protect your information.
          </p>
        </section>

        <section>
          <h3 className="text-lg sm:text-xl font-bold text-white mb-2">
            8. Not financial advice
          </h3>
          <p>
            The App provides technical analysis for informational purposes only. It is not investment advice.
          </p>
        </section>

        <section>
          <h3 className="text-lg sm:text-xl font-bold text-white mb-2">
            9. Children
          </h3>
          <p>
            The App is not intended for children under 18, and we do not knowingly collect their data.
          </p>
        </section>

        <section>
          <h3 className="text-lg sm:text-xl font-bold text-white mb-2">
            10. Changes
          </h3>
          <p>
            We may update this policy. The &quot;Last updated&quot; date will change when we do.
          </p>
        </section>

        <section>
          <h3 className="text-lg sm:text-xl font-bold text-white mb-2">
            11. Contact
          </h3>
          <p>
            Ogün Güneş –{" "}
            <a
              href="mailto:ogungunes99@gmail.com"
              className="text-cyan-400 hover:text-cyan-300 underline underline-offset-4"
            >
              ogungunes99@gmail.com
            </a>
          </p>
        </section>
      </div>
    </article>
  );

  return (
    <div className="h-screen overflow-y-auto bg-[#060913] text-slate-100 flex flex-col justify-between selection:bg-cyan-500/20 selection:text-cyan-400">
      {/* Header */}
      <header className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-900 border border-cyan-500/30">
            <Image
              src="/static/rsi-mark.svg"
              width={26}
              height={26}
              alt="BIST Analizi Logo"
              unoptimized
            />
          </div>
          <div>
            <div className="text-base font-bold tracking-tight text-white group-hover:text-cyan-400 transition-colors">
              BIST Analizi
            </div>
            <div className="text-[11px] font-medium text-slate-400">
              TEKNİK ANALİZ & SİNYAL PLATFORMU
            </div>
          </div>
        </Link>

        {/* Language Toggle (TR / EN) */}
        <div className="flex items-center gap-3">
          <div
            role="group"
            aria-label="Dil seçimi / Language toggle"
            className="inline-flex items-center rounded-xl bg-slate-900/90 border border-slate-800 p-1"
          >
            <button
              type="button"
              onClick={() => setLang("tr")}
              aria-pressed={lang === "tr"}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                lang === "tr"
                  ? "bg-cyan-500 text-slate-950 shadow-sm"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              TR (Türkçe)
            </button>
            <button
              type="button"
              onClick={() => setLang("en")}
              aria-pressed={lang === "en"}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                lang === "en"
                  ? "bg-cyan-500 text-slate-950 shadow-sm"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              EN (English)
            </button>
          </div>

          <Link
            href="/login"
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors"
          >
            Giriş / Sign In
          </Link>
        </div>
      </header>

      {/* Main Content: Both versions rendered on the same URL, ordered by selected language (Default: TR) */}
      <main className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-10">
        {lang === "tr" ? (
          <>
            {trSection}
            {enSection}
          </>
        ) : (
          <>
            {enSection}
            {trSection}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
        <div>© 2026 BIST Analizi · Tüm hakları saklıdır.</div>
        <div className="flex items-center gap-4">
          <Link
            href="/privacy"
            className="text-cyan-400 hover:text-cyan-300 underline underline-offset-4 font-medium"
          >
            Privacy Policy / Gizlilik Politikası
          </Link>
          <span>•</span>
          <Link href="/login" className="hover:text-slate-200 transition-colors">
            Ana Sayfa / Home
          </Link>
        </div>
      </footer>
    </div>
  );
}
