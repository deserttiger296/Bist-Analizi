/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface LoginLogItem {
  id: string;
  googleSub: string | null;
  email: string;
  name: string | null;
  picture: string | null;
  status: "ALLOWED" | "BLOCKED" | "ERROR";
  blockReason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface BannedUserItem {
  email: string;
  googleSub: string | null;
  reason: string | null;
  bannedBy: string | null;
  bannedAt: string;
  expiresAt: string | null;
  active: boolean;
  source: "postgres" | "file" | "env";
}

interface StorageInfo {
  mode: "postgres" | "file_fallback";
  persistent: boolean;
  envBanCount: number;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return "Ortam Değişkeni";
  return d.toLocaleString("tr-TR", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

export function SecurityAdminClient({ adminEmail }: { adminEmail: string }) {
  const [logs, setLogs] = useState<LoginLogItem[]>([]);
  const [bans, setBans] = useState<BannedUserItem[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ALLOWED" | "BLOCKED">("ALL");
  const [search, setSearch] = useState("");
  const [banEmail, setBanEmail] = useState("");
  const [banReason, setBanReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: "200", status: statusFilter });
      if (search.trim()) qs.set("q", search.trim());
      const [logsRes, bansRes] = await Promise.all([
        fetch(`/api/admin/auth/logs?${qs.toString()}`, { cache: "no-store" }),
        fetch("/api/admin/auth/bans", { cache: "no-store" }),
      ]);
      const logsJson = await logsRes.json();
      const bansJson = await bansRes.json();
      if (logsJson.ok) {
        setLogs(logsJson.logs || []);
        setStorage(logsJson.storage || null);
      }
      if (bansJson.ok) {
        setBans(bansJson.bans || []);
      }
    } catch {
      setFeedback({ type: "err", text: "Veriler yüklenirken hata oluştu." });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const bannedSet = useMemo(() => new Set(bans.map((b) => b.email.toLowerCase())), [bans]);

  const stats = useMemo(() => {
    let allowed = 0;
    let blocked = 0;
    for (const item of logs) {
      if (item.status === "ALLOWED") allowed++;
      else if (item.status === "BLOCKED") blocked++;
    }
    return { total: logs.length, allowed, blocked, activeBans: bans.length };
  }, [logs, bans]);

  async function handleBan(email: string, reason?: string, googleSub?: string | null) {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/auth/bans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: cleanEmail,
          googleSub: googleSub || null,
          reason: (reason || "").trim() || "Yönetici tarafından erişim kısıtlandı.",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFeedback({ type: "err", text: data.error || "Yasaklama başarısız." });
      } else {
        setFeedback({ type: "ok", text: `${cleanEmail} hesabı için giriş yasağı eklendi.` });
        setBanEmail("");
        setBanReason("");
        await loadData();
      }
    } catch {
      setFeedback({ type: "err", text: "Sunucu hatası oluştu." });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnban(email: string) {
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/auth/bans?email=${encodeURIComponent(email)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFeedback({ type: "err", text: data.error || "Yasak kaldırılamadı." });
      } else if (data.envLocked) {
        setFeedback({ type: "err", text: data.message });
      } else {
        setFeedback({ type: "ok", text: `${email} hesabının giriş yasağı kaldırıldı.` });
      }
      await loadData();
    } catch {
      setFeedback({ type: "err", text: "Sunucu hatası oluştu." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#060913] text-slate-100 px-4 sm:px-8 py-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-cyan-400">
              BIST Quantum · Yönetici Güvenlik Merkezi
            </div>
            <h1 className="text-2xl font-extrabold text-white mt-1">
              Google Giriş Logları &amp; Giriş Yasağı Yönetimi
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Aktif Yönetici: <span className="font-mono text-slate-200">{adminEmail}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={loadData}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors"
            >
              {loading ? "Yenileniyor..." : "Yenile"}
            </button>
            <Link
              href="/index.html"
              className="px-3.5 py-2 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-xs font-semibold text-cyan-300 transition-colors"
            >
              ← Terminale Dön
            </Link>
          </div>
        </header>

        {/* Storage banner */}
        {storage && (
          <div
            className={`px-4 py-3 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 ${
              storage.mode === "postgres"
                ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
                : "bg-amber-950/40 border-amber-500/30 text-amber-200"
            }`}
          >
            <div>
              <strong>Depolama Modu:</strong>{" "}
              {storage.mode === "postgres"
                ? "PostgreSQL (Kalıcı)"
                : storage.persistent
                  ? "Yerel Dosya (.cache) + BANNED_EMAILS Env"
                  : "Geçici Serverless Bellek (/tmp) — Kalıcı log ve ban için Vercel'de DATABASE_URL (PostgreSQL) veya BANNED_EMAILS tanımlayın."}
            </div>
            <div className="font-mono text-[11px] opacity-80">
              Env Ban Sayısı: {storage.envBanCount}
            </div>
          </div>
        )}

        {/* Feedback alert */}
        {feedback && (
          <div
            className={`px-4 py-3 rounded-xl border text-xs font-medium ${
              feedback.type === "ok"
                ? "bg-emerald-950/50 border-emerald-500/40 text-emerald-300"
                : "bg-rose-950/50 border-rose-500/40 text-rose-300"
            }`}
          >
            {feedback.text}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Listelenen Giriş</div>
            <div className="text-2xl font-bold text-white mt-1">{stats.total}</div>
          </div>
          <div className="bg-slate-900/70 border border-emerald-500/20 rounded-xl p-4">
            <div className="text-[11px] uppercase tracking-wider text-emerald-400">İzin Verilen</div>
            <div className="text-2xl font-bold text-emerald-300 mt-1">{stats.allowed}</div>
          </div>
          <div className="bg-slate-900/70 border border-rose-500/20 rounded-xl p-4">
            <div className="text-[11px] uppercase tracking-wider text-rose-400">Engellenen Deneme</div>
            <div className="text-2xl font-bold text-rose-300 mt-1">{stats.blocked}</div>
          </div>
          <div className="bg-slate-900/70 border border-amber-500/20 rounded-xl p-4">
            <div className="text-[11px] uppercase tracking-wider text-amber-400">Aktif Yasaklı Hesap</div>
            <div className="text-2xl font-bold text-amber-300 mt-1">{stats.activeBans}</div>
          </div>
        </div>

        {/* Manual Ban Form + Active Bans */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <section className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-white mb-1">Yeni Giriş Yasağı Ekle</h2>
            <p className="text-xs text-slate-400 mb-4">
              Yasaklanan Google hesabı anında oturum dışı bırakılır ve tekrar giriş yapamaz.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleBan(banEmail, banReason);
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Google E-posta Adresi
                </label>
                <input
                  type="email"
                  required
                  value={banEmail}
                  onChange={(e) => setBanEmail(e.target.value)}
                  placeholder="ornek@gmail.com"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-400"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Yasaklama Sebebi (Opsiyonel)
                </label>
                <input
                  type="text"
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  placeholder="Örn: Yetkisiz erişim denemesi"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-400"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !banEmail.trim()}
                className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold transition-colors"
              >
                Giriş Yasağı Uygula
              </button>
            </form>
          </section>

          <section className="lg:col-span-2 bg-slate-900/70 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-white">Yasaklı Google Hesapları ({bans.length})</h2>
            </div>
            {bans.length === 0 ? (
              <div className="text-xs text-slate-500 py-8 text-center">
                Şu anda aktif giriş yasağı bulunan hesap yok.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2 pr-3">E-posta</th>
                      <th className="py-2 pr-3">Sebep</th>
                      <th className="py-2 pr-3">Kaynak</th>
                      <th className="py-2 pr-3">Tarih</th>
                      <th className="py-2 text-right">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {bans.map((b) => (
                      <tr key={b.email} className="hover:bg-slate-800/30">
                        <td className="py-2.5 pr-3 font-mono text-rose-300">{b.email}</td>
                        <td className="py-2.5 pr-3 text-slate-300">{b.reason || "—"}</td>
                        <td className="py-2.5 pr-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                            {b.source}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-slate-400 whitespace-nowrap">
                          {formatDate(b.bannedAt)}
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            onClick={() => handleUnban(b.email)}
                            disabled={submitting || b.source === "env"}
                            title={
                              b.source === "env"
                                ? "BANNED_EMAILS ortam değişkeninden kaldırılmalıdır"
                                : "Giriş yasağını kaldır"
                            }
                            className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 disabled:opacity-40 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold transition-colors"
                          >
                            {b.source === "env" ? "Env Kilitli" : "Yasağı Kaldır"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Login Logs Table */}
        <section className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h2 className="text-sm font-bold text-white">Google Giriş Logları</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "ALL" | "ALLOWED" | "BLOCKED")}
                className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-200"
              >
                <option value="ALL">Tümü</option>
                <option value="ALLOWED">İzin Verilen</option>
                <option value="BLOCKED">Engellenen</option>
              </select>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="E-posta veya isim ara..."
                className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-cyan-400"
              />
            </div>
          </div>

          {logs.length === 0 ? (
            <div className="text-xs text-slate-500 py-10 text-center">
              Henüz kayıtlı Google giriş logu bulunmuyor.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 pr-3">Tarih</th>
                    <th className="py-2 pr-3">Kullanıcı</th>
                    <th className="py-2 pr-3">Durum</th>
                    <th className="py-2 pr-3">IP Adresi</th>
                    <th className="py-2 pr-3">Tarayıcı / Not</th>
                    <th className="py-2 text-right">Hızlı İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {logs.map((log) => {
                    const isSelf = log.email.toLowerCase() === adminEmail.toLowerCase();
                    const alreadyBanned = bannedSet.has(log.email.toLowerCase());
                    return (
                      <tr key={log.id} className="hover:bg-slate-800/30">
                        <td className="py-2.5 pr-3 text-slate-400 whitespace-nowrap">
                          {formatDate(log.createdAt)}
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2">
                            {log.picture ? (
                              <img
                                src={log.picture}
                                alt=""
                                className="w-6 h-6 rounded-full border border-slate-700"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-cyan-300">
                                {(log.name || log.email).charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <div className="font-semibold text-slate-100">{log.name || "—"}</div>
                              <div className="font-mono text-[11px] text-slate-400">{log.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              log.status === "ALLOWED"
                                ? "bg-emerald-950/70 border-emerald-500/40 text-emerald-300"
                                : "bg-rose-950/70 border-rose-500/40 text-rose-300"
                            }`}
                          >
                            {log.status === "ALLOWED" ? "İZİN VERİLDİ" : "ENGELLENDİ"}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-slate-300 whitespace-nowrap">
                          {log.ipAddress || "unknown"}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-400 max-w-xs truncate" title={log.blockReason || log.userAgent || ""}>
                          {log.blockReason ? (
                            <span className="text-rose-300">{log.blockReason}</span>
                          ) : (
                            log.userAgent || "—"
                          )}
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          {isSelf ? (
                            <span className="text-[11px] text-slate-500">Yönetici</span>
                          ) : alreadyBanned ? (
                            <button
                              onClick={() => handleUnban(log.email)}
                              disabled={submitting}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold"
                            >
                              Yasağı Kaldır
                            </button>
                          ) : (
                            <button
                              onClick={() => handleBan(log.email, "Giriş logundan yasaklandı", log.googleSub)}
                              disabled={submitting}
                              className="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 text-[11px] font-semibold"
                            >
                              Yasakla
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
