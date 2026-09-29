import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Palette, UserRound, Sparkles, ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import { CARD_STYLES, COLOR_THEMES, useTheme, type CardStyle, type ColorTheme, type Theme } from "@/react-app/context/ThemeContext";

interface ProfileDesignWizardProps { open: boolean; onClose: () => void; }
type Step = 1 | 2 | 3;

export default function ProfileDesignWizard({ open, onClose }: ProfileDesignWizardProps) {
  const { user, updateProfile } = useAuth();
  const { currentStation } = useStations();
  const { theme, setTheme, colorTheme, setColorTheme, cardStyle, setCardStyle, reducedMotion, setReducedMotion } = useTheme();
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(user?.name || "");
  const [username, setUsername] = useState(user?.username || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [notice, setNotice] = useState("");

  const completion = useMemo(() => {
    const checks = [Boolean(name.trim()), Boolean(username.trim()), Boolean(phone.trim()), Boolean(user?.emailVerified), Boolean(currentStation?.id), Boolean(colorTheme), Boolean(cardStyle)];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [name, username, phone, user?.emailVerified, currentStation?.id, colorTheme, cardStyle]);

  if (!open) return null;

  const saveProfile = async () => {
    setSaving(true);
    setNotice("");
    const result = await updateProfile({ name: name.trim(), username: username.trim(), phone: phone.trim() });
    setSaving(false);
    if (!result.success) { setNotice(result.error || "Could not save your profile."); return; }
    setNotice("Profile saved and synced across your signed-in devices.");
  };

  const finish = async () => {
    await saveProfile();
    try { localStorage.setItem("fuelpro_profile_design_seen_" + (user?.id || "local"), "true"); } catch {}
    setStep(1);
    onClose();
  };

  const themeMeta = COLOR_THEMES.find((t) => t.id === colorTheme) || COLOR_THEMES[0];
  const buttonClass = "px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold flex items-center gap-2";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="profile-design-title" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl max-h-[92dvh] overflow-auto rounded-3xl bg-white dark:bg-[#121212] border border-gray-200 dark:border-white/10 shadow-2xl">
        <div className="sticky top-0 z-10 bg-white/95 dark:bg-[#121212]/95 backdrop-blur border-b border-gray-200 dark:border-white/10 px-5 sm:px-7 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"><Sparkles size={14}/> Personalize FuelPro</div>
              <h2 id="profile-design-title" className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mt-1">Design your profile</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Set up your identity and workspace appearance once. Preferences sync with your account.</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500" aria-label="Close"><X size={18}/></button>
          </div>
          <div className="mt-4 flex items-center gap-2">
            {[1,2,3].map((n) => <div key={n} className="flex items-center gap-2 flex-1"><div className={"w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold " + (step >= n ? "bg-amber-500 text-white" : "bg-gray-100 dark:bg-white/10 text-gray-400")}>{step > n ? <Check size={14}/> : n}</div>{n < 3 && <div className="h-px flex-1 bg-gray-200 dark:bg-white/10"/>}</div>)}
          </div>
        </div>

        <div className="p-5 sm:p-7">
          {step === 1 && <section className="space-y-5">
            <div className="rounded-2xl p-5 bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/10">
              <div className="flex items-center gap-3"><div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center"><UserRound className="text-amber-500"/></div><div><h3 className="font-semibold text-gray-900 dark:text-white">Your professional identity</h3><p className="text-xs text-gray-500 dark:text-gray-400">These details appear in your account and activity context.</p></div></div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="text-sm text-gray-600 dark:text-gray-300">Full name<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-4 py-3 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500/30" placeholder="Your full name"/></label>
              <label className="text-sm text-gray-600 dark:text-gray-300">Username<input value={username} onChange={(e) => setUsername(e.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-4 py-3 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500/30" placeholder="Unique username"/></label>
            </div>
            <label className="text-sm text-gray-600 dark:text-gray-300 block">Phone number<input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" className="mt-1.5 w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-4 py-3 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500/30" placeholder="+254 7XX XXX XXX"/></label>
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-xs text-emerald-600 dark:text-emerald-300"><ShieldCheck size={16}/><span>Email: {user?.email || "—"} · {user?.emailVerified ? "verified" : "verification recommended"}</span></div>
          </section>}

          {step === 2 && <section className="space-y-6">
            <div><h3 className="font-semibold text-gray-900 dark:text-white">Choose your visual language</h3><p className="text-sm text-gray-500 dark:text-gray-400 mt-1">The palette and card treatment affect the workspace, while your data and permissions stay unchanged.</p></div>
            <div><div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200 mb-3"><Palette size={16}/> Color palette</div><div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{COLOR_THEMES.map((t) => <button key={t.id} onClick={() => setColorTheme(t.id as ColorTheme)} className={"p-3 rounded-xl border text-left transition-all " + (colorTheme === t.id ? "border-amber-500 ring-2 ring-amber-500/20" : "border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20")}><span className="block h-8 rounded-lg mb-2" style={{background:"linear-gradient(135deg, " + t.tintHex + ", " + t.primaryHex + ")"}}/><span className="text-[11px] font-medium text-gray-800 dark:text-gray-200 block truncate">{t.name}</span></button>)}</div></div>
            <div><div className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-3">Card style</div><div className="grid sm:grid-cols-3 gap-3">{CARD_STYLES.map((s) => <button key={s.id} onClick={() => setCardStyle(s.id as CardStyle)} className={"text-left p-4 rounded-2xl border transition-all " + (cardStyle === s.id ? "border-amber-500 ring-2 ring-amber-500/20" : "border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20")}><div className={"h-14 rounded-xl border mb-3 " + (s.id === "dark" ? "bg-slate-900 border-slate-700" : s.id === "minimal" ? "bg-transparent border-gray-300" : "bg-white dark:bg-white/10 border-gray-200 dark:border-white/10 shadow-sm")}/><div className="text-sm font-semibold text-gray-900 dark:text-white">{s.name}</div><div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{s.description}</div></button>)}</div></div>
            <div className="flex flex-col sm:flex-row gap-3">{(["system","light","dark"] as Theme[]).map((mode) => <button key={mode} onClick={() => setTheme(mode)} className={"flex-1 rounded-xl border px-4 py-3 text-sm capitalize " + (theme === mode ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300")}>{mode} mode</button>)}</div>
            <label className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 dark:border-white/10 px-4 py-3"><span><span className="block text-sm font-medium text-gray-800 dark:text-white">Reduce motion</span><span className="block text-xs text-gray-500 dark:text-gray-400">Use calmer transitions and animations.</span></span><input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.target.checked)} className="h-5 w-5 accent-amber-500"/></label>
          </section>}

          {step === 3 && <section className="space-y-5">
            <div className="rounded-2xl bg-gradient-to-br from-amber-500/15 to-indigo-500/10 border border-amber-500/20 p-5"><div className="flex items-center justify-between gap-4"><div><p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Profile readiness</p><p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{completion}%</p></div><div className="w-16 h-16 rounded-full border-4 border-amber-500/20 flex items-center justify-center"><span className="text-xs font-bold text-amber-600 dark:text-amber-300">{completion}%</span></div></div><div className="fp-profile-progress mt-4 text-amber-500"><span style={{width: completion + "%"}}/></div></div>
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-white/10 p-3"><Check size={16} className="text-emerald-500"/><div><div className="text-sm font-medium text-gray-900 dark:text-white">Identity</div><div className="text-xs text-gray-500 dark:text-gray-400">{name || "Name"} · {username || "username"}</div></div></div>
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-white/10 p-3"><Check size={16} className="text-emerald-500"/><div><div className="text-sm font-medium text-gray-900 dark:text-white">Appearance</div><div className="text-xs text-gray-500 dark:text-gray-400">{themeMeta.name} · {cardStyle}</div></div></div>
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-white/10 p-3"><ShieldCheck size={16} className={user?.emailVerified ? "text-emerald-500" : "text-amber-500"}/><div><div className="text-sm font-medium text-gray-900 dark:text-white">Account security</div><div className="text-xs text-gray-500 dark:text-gray-400">{user?.emailVerified ? "Email verified" : "Email verification recommended"}</div></div></div>
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-white/10 p-3"><Check size={16} className={currentStation?.id ? "text-emerald-500" : "text-amber-500"}/><div><div className="text-sm font-medium text-gray-900 dark:text-white">Workspace</div><div className="text-xs text-gray-500 dark:text-gray-400">{currentStation?.name || "Select or create a station"}</div></div></div>
            </div>
            {notice && <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">{notice}</div>}
          </section>}
        </div>

        <div className="sticky bottom-0 bg-white/95 dark:bg-[#121212]/95 backdrop-blur border-t border-gray-200 dark:border-white/10 px-5 sm:px-7 py-4 flex items-center justify-between gap-3">
          <button onClick={() => (step === 1 ? onClose() : setStep((step - 1) as Step))} className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2"><ChevronLeft size={16}/>{step === 1 ? "Cancel" : "Back"}</button>
          {step < 3 ? <button onClick={() => { if (step === 1) void saveProfile(); setStep((step + 1) as Step); }} className={buttonClass}>{step === 1 ? "Save & continue" : "Continue"}<ChevronRight size={16}/></button> : <button onClick={() => void finish()} disabled={saving} className={buttonClass + " disabled:opacity-60"}><Check size={16}/>{saving ? "Saving..." : "Finish setup"}</button>}
        </div>
      </div>
    </div>
  );
}
