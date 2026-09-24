import { useEffect, useMemo, useRef, useState } from "react";
import {
  Globe,
  FileText,
  Users,
  MessageSquareQuote,
  HelpCircle,
  Star,
  Briefcase,
  Plus,
  Search,
  Trash2,
  Pencil,
  Link2,
  Rocket,
} from "lucide-react";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import MiniSiteManager from "@/react-app/components/MiniSiteManager";
import { useSubTabDeepLink } from "@/react-app/hooks/useSubTabDeepLink";

const CLOUD_KEY = "web_studio_content";
const STORAGE_KEY = "fuelpro_web_studio_v2";

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  author: string;
  category: string;
  status: "draft" | "published";
  publishedAt: string;
  imageUrl: string;
  createdAt: string;
  stationId: string;
}

interface TeamMember {
  id: string;
  name: string;
  role: string;
  bio: string;
  photoUrl: string;
  order: number;
  createdAt: string;
  stationId: string;
}

interface Testimonial {
  id: string;
  author: string;
  company: string;
  quote: string;
  rating: number;
  createdAt: string;
  stationId: string;
}

interface FaqItem {
  id: string;
  question: string;
  answer: string;
  order: number;
  createdAt: string;
  stationId: string;
}

interface PortfolioItem {
  id: string;
  projectName: string;
  category: string;
  description: string;
  imageUrl: string;
  url: string;
  createdAt: string;
  stationId: string;
}

interface JobPosting {
  id: string;
  title: string;
  department: string;
  location: string;
  type: string;
  description: string;
  status: "open" | "closed";
  createdAt: string;
  stationId: string;
}

interface StudioSiteConfig {
  id: string;
  siteName: string;
  tagline: string;
  logoUrl: string;
  primaryColor: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  createdAt: string;
  stationId: string;
}

interface WebStudioData {
  site?: StudioSiteConfig;
  blog: BlogPost[];
  team: TeamMember[];
  testimonials: Testimonial[];
  faqs: FaqItem[];
  portfolio: PortfolioItem[];
  jobs: JobPosting[];
}

const EMPTY_DATA: WebStudioData = {
  blog: [],
  team: [],
  testimonials: [],
  faqs: [],
  portfolio: [],
  jobs: [],
};

function normalizeBlog(p: Partial<BlogPost> | null | undefined): BlogPost {
  const id =
    p?.id || `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: p?.title ?? "",
    slug: p?.slug ?? "",
    excerpt: p?.excerpt ?? "",
    body: p?.body ?? "",
    author: p?.author ?? "",
    category: p?.category ?? "General",
    status: p?.status === "published" ? "published" : "draft",
    publishedAt: p?.publishedAt ?? "",
    imageUrl: p?.imageUrl ?? "",
    createdAt: p?.createdAt ?? new Date().toISOString(),
    stationId: p?.stationId ?? "default",
  };
}
function normalizeTeam(t: Partial<TeamMember> | null | undefined): TeamMember {
  const id =
    t?.id || `tm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: t?.name ?? "",
    role: t?.role ?? "",
    bio: t?.bio ?? "",
    photoUrl: t?.photoUrl ?? "",
    order: typeof t?.order === "number" ? t.order : 0,
    createdAt: t?.createdAt ?? new Date().toISOString(),
    stationId: t?.stationId ?? "default",
  };
}
function normalizeTestimonial(
  x: Partial<Testimonial> | null | undefined,
): Testimonial {
  const id =
    x?.id || `tst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    author: x?.author ?? "",
    company: x?.company ?? "",
    quote: x?.quote ?? "",
    rating:
      typeof x?.rating === "number" ? Math.max(1, Math.min(5, x.rating)) : 5,
    createdAt: x?.createdAt ?? new Date().toISOString(),
    stationId: x?.stationId ?? "default",
  };
}
function normalizeFaq(f: Partial<FaqItem> | null | undefined): FaqItem {
  const id =
    f?.id || `faq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    question: f?.question ?? "",
    answer: f?.answer ?? "",
    order: typeof f?.order === "number" ? f.order : 0,
    createdAt: f?.createdAt ?? new Date().toISOString(),
    stationId: f?.stationId ?? "default",
  };
}
function normalizePortfolio(
  p: Partial<PortfolioItem> | null | undefined,
): PortfolioItem {
  const id =
    p?.id || `pf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    projectName: p?.projectName ?? "",
    category: p?.category ?? "",
    description: p?.description ?? "",
    imageUrl: p?.imageUrl ?? "",
    url: p?.url ?? "",
    createdAt: p?.createdAt ?? new Date().toISOString(),
    stationId: p?.stationId ?? "default",
  };
}
function normalizeJob(j: Partial<JobPosting> | null | undefined): JobPosting {
  const id =
    j?.id || `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: j?.title ?? "",
    department: j?.department ?? "",
    location: j?.location ?? "",
    type: j?.type ?? "Full-time",
    description: j?.description ?? "",
    status: j?.status === "closed" ? "closed" : "open",
    createdAt: j?.createdAt ?? new Date().toISOString(),
    stationId: j?.stationId ?? "default",
  };
}
function normalizeSite(
  s: Partial<StudioSiteConfig> | null | undefined,
): StudioSiteConfig {
  const id = s?.id || `site_${Date.now()}`;
  return {
    id,
    siteName: s?.siteName ?? "",
    tagline: s?.tagline ?? "",
    logoUrl: s?.logoUrl ?? "",
    primaryColor: s?.primaryColor ?? "#c5a059",
    contactEmail: s?.contactEmail ?? "",
    contactPhone: s?.contactPhone ?? "",
    address: s?.address ?? "",
    createdAt: s?.createdAt ?? new Date().toISOString(),
    stationId: s?.stationId ?? "default",
  };
}

function normalizeData(raw: unknown): WebStudioData {
  const d = (
    raw && typeof raw === "object" ? raw : {}
  ) as Partial<WebStudioData>;
  return {
    site: d.site ? normalizeSite(d.site) : undefined,
    blog: Array.isArray(d.blog)
      ? d.blog.map((x) => normalizeBlog(x as Partial<BlogPost>))
      : [],
    team: Array.isArray(d.team)
      ? d.team.map((x) => normalizeTeam(x as Partial<TeamMember>))
      : [],
    testimonials: Array.isArray(d.testimonials)
      ? d.testimonials.map((x) =>
          normalizeTestimonial(x as Partial<Testimonial>),
        )
      : [],
    faqs: Array.isArray(d.faqs)
      ? d.faqs.map((x) => normalizeFaq(x as Partial<FaqItem>))
      : [],
    portfolio: Array.isArray(d.portfolio)
      ? d.portfolio.map((x) => normalizePortfolio(x as Partial<PortfolioItem>))
      : [],
    jobs: Array.isArray(d.jobs)
      ? d.jobs.map((x) => normalizeJob(x as Partial<JobPosting>))
      : [],
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

export default function WebStudio() {
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;

  const [data, setData] = useState<WebStudioData>(() => {
    const raw = cloudStorageService.getCached<Partial<WebStudioData>>(
      CLOUD_KEY,
      stationId,
    );
    if (raw) return normalizeData(raw);
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) return normalizeData(JSON.parse(s));
    } catch {}
    return { ...EMPTY_DATA };
  });

  const [section, setSection] = useState<
    | "site"
    | "mini"
    | "blog"
    | "team"
    | "testimonials"
    | "faqs"
    | "portfolio"
    | "jobs"
  >("site");

  // Deep-link support: the Mini Site manager can be opened directly from
  // Quick Search / the AI assistant / Station Manager via the sub-tab bus.
  useSubTabDeepLink("webstudio", (subTab) => {
    if (subTab === "mini" || subTab === "site" || subTab === "blog") {
      setSection(subTab);
    }
  });
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "warning";
  } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<{ kind: string; id: string | null }>({
    kind: "blog",
    id: null,
  });

  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const localModifiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const flagLocalModified = () => {
    localModifiedRef.current = true;
    if (localModifiedTimer.current) clearTimeout(localModifiedTimer.current);
    localModifiedTimer.current = setTimeout(() => {
      localModifiedRef.current = false;
    }, 3000);
  };

  useEffect(() => {
    let cancelled = false;
    cloudLoadCompleteRef.current = false;
    (async () => {
      try {
        const raw = await cloudStorageService.get<Partial<WebStudioData>>(
          CLOUD_KEY,
          stationId,
        );
        if (cancelled) return;
        if (!localModifiedRef.current && raw) setData(normalizeData(raw));
      } catch {}
      if (!cancelled) {
        cloudLoadCompleteRef.current = true;
        if (localModifiedRef.current) {
          cloudStorageService
            .set(CLOUD_KEY, dataRef.current, stationId)
            .catch(() => {});
        }
      }
    })();
    const unsub = cloudStorageService.subscribe<Partial<WebStudioData>>(
      CLOUD_KEY,
      stationId,
      (val) => {
        if (!localModifiedRef.current && val) setData(normalizeData(val));
      },
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [user?.id, stationId]);

  useEffect(() => {
    if (!cloudLoadCompleteRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
    cloudStorageService
      .set(CLOUD_KEY, data, stationId)
      .then(() => {
        localModifiedRef.current = false;
      })
      .catch(() => {});
  }, [data, stationId]);

  const toast = (message: string, type: "success" | "warning" = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const patchData = (patch: Partial<WebStudioData>) => {
    flagLocalModified();
    setData((prev) => ({ ...prev, ...patch }));
  };

  const [form, setForm] = useState<Record<string, string>>({});

  const openNew = (kind: string) => {
    setEditing({ kind, id: null });
    setForm({});
    setShowModal(true);
  };
  const openEdit = (kind: string, item: object) => {
    const f: Record<string, string> = {};
    for (const [k, v] of Object.entries(item)) {
      if (typeof v === "string") f[k] = v;
      else if (typeof v === "number") f[k] = String(v);
    }
    setEditing({ kind, id: String((item as { id?: string }).id || "") });
    setForm(f);
    setShowModal(true);
  };

  const saveItem = () => {
    const kind = editing.kind;
    const base = {
      createdAt: new Date().toISOString(),
      stationId: stationId || "default",
    };
    if (kind === "site") {
      patchData({
        site: normalizeSite({
          ...data.site,
          ...form,
          ...base,
          id: data.site?.id,
        }),
      });
      toast("Site configuration saved");
    } else if (kind === "blog") {
      const existing = editing.id
        ? data.blog.find((b) => b.id === editing.id)
        : undefined;
      const post = normalizeBlog({
        ...existing,
        ...form,
        ...base,
        id: editing.id || undefined,
        slug: form.slug || slugify(form.title || ""),
        status: (form.status as BlogPost["status"]) || "draft",
      });
      patchData({
        blog: editing.id
          ? data.blog.map((b) => (b.id === editing.id ? post : b))
          : [post, ...data.blog],
      });
      toast(editing.id ? "Post updated" : "Post created");
    } else if (kind === "team") {
      const item = normalizeTeam({
        ...form,
        ...base,
        id: editing.id || undefined,
        order: Number(form.order) || 0,
      });
      patchData({
        team: editing.id
          ? data.team.map((t) => (t.id === editing.id ? item : t))
          : [item, ...data.team].sort((a, b) => a.order - b.order),
      });
      toast(editing.id ? "Member updated" : "Member added");
    } else if (kind === "testimonials") {
      const item = normalizeTestimonial({
        ...form,
        ...base,
        id: editing.id || undefined,
        rating: Number(form.rating) || 5,
      });
      patchData({
        testimonials: editing.id
          ? data.testimonials.map((t) => (t.id === editing.id ? item : t))
          : [item, ...data.testimonials],
      });
      toast(editing.id ? "Testimonial updated" : "Testimonial added");
    } else if (kind === "faqs") {
      const item = normalizeFaq({
        ...form,
        ...base,
        id: editing.id || undefined,
        order: Number(form.order) || 0,
      });
      patchData({
        faqs: editing.id
          ? data.faqs.map((f) => (f.id === editing.id ? item : f))
          : [...data.faqs, item].sort((a, b) => a.order - b.order),
      });
      toast(editing.id ? "FAQ updated" : "FAQ added");
    } else if (kind === "portfolio") {
      const item = normalizePortfolio({
        ...form,
        ...base,
        id: editing.id || undefined,
      });
      patchData({
        portfolio: editing.id
          ? data.portfolio.map((p) => (p.id === editing.id ? item : p))
          : [item, ...data.portfolio],
      });
      toast(editing.id ? "Project updated" : "Project added");
    } else if (kind === "jobs") {
      const item = normalizeJob({
        ...form,
        ...base,
        id: editing.id || undefined,
      });
      patchData({
        jobs: editing.id
          ? data.jobs.map((j) => (j.id === editing.id ? item : j))
          : [item, ...data.jobs],
      });
      toast(editing.id ? "Job updated" : "Job posted");
    }
    setShowModal(false);
  };

  const removeItem = (kind: string, id: string) => {
    flagLocalModified();
    const maps: Record<string, keyof WebStudioData> = {
      blog: "blog",
      team: "team",
      testimonials: "testimonials",
      faqs: "faqs",
      portfolio: "portfolio",
      jobs: "jobs",
    };
    const key = maps[kind];
    if (!key) return;
    setData((prev) => {
      const arr = prev[key] as Array<{ id: string }>;
      return { ...prev, [key]: arr.filter((x) => x.id !== id) };
    });
    toast("Removed");
  };

  const togglePublish = (id: string) => {
    flagLocalModified();
    setData((prev) => ({
      ...prev,
      blog: prev.blog.map((b) =>
        b.id === id
          ? {
              ...b,
              status: b.status === "published" ? "draft" : "published",
              publishedAt: b.publishedAt || new Date().toISOString(),
            }
          : b,
      ),
    }));
  };
  const toggleJob = (id: string) => {
    flagLocalModified();
    setData((prev) => ({
      ...prev,
      jobs: prev.jobs.map((j) =>
        j.id === id
          ? { ...j, status: j.status === "open" ? "closed" : "open" }
          : j,
      ),
    }));
  };

  const filteredBlog = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return data.blog.filter(
      (b) =>
        !q ||
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q),
    );
  }, [data.blog, searchTerm]);

  const sectionList = [
    { id: "mini" as const, label: "Mini Site", icon: Rocket },
    { id: "site" as const, label: "Site", icon: Globe },
    { id: "blog" as const, label: "Blog", icon: FileText },
    { id: "team" as const, label: "Team", icon: Users },
    {
      id: "testimonials" as const,
      label: "Testimonials",
      icon: MessageSquareQuote,
    },
    { id: "faqs" as const, label: "FAQs", icon: HelpCircle },
    { id: "portfolio" as const, label: "Portfolio", icon: Briefcase },
    { id: "jobs" as const, label: "Careers", icon: Star },
  ];

  return (
    <div className="w-full">
      {notification && (
        <div
          className={`mb-3 px-4 py-2.5 rounded-lg text-sm font-medium ${notification.type === "success" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300"}`}
        >
          {notification.message}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Globe size={20} className="text-amber-500" /> Web Studio
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Run your public website content from the workspace — blog, team,
            testimonials, FAQs, portfolio, careers
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {sectionList.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${section === s.id ? "bg-amber-500 text-gray-900 dark:text-black" : "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10"}`}
            >
              <s.icon size={14} /> {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={`Search ${section}...`}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
        </div>
        {section !== "site" && section !== "mini" && (
          <button
            onClick={() => openNew(section)}
            className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-lg text-sm font-medium flex items-center gap-1.5"
          >
            <Plus size={16} /> Add
          </button>
        )}
      </div>

      {section === "mini" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-5">
          <MiniSiteManager stationIdOverride={stationId} />
        </div>
      )}

      {section === "site" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">
            Site Configuration
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                Site Name
              </label>
              <input
                value={data.site?.siteName || ""}
                onChange={(e) => setForm({ ...form, siteName: e.target.value })}
                placeholder="FuelPro Station"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                Tagline
              </label>
              <input
                value={data.site?.tagline || ""}
                onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                placeholder="Your fuel station tagline"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                Contact Email
              </label>
              <input
                value={data.site?.contactEmail || ""}
                onChange={(e) =>
                  setForm({ ...form, contactEmail: e.target.value })
                }
                placeholder="hello@station.com"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                Contact Phone
              </label>
              <input
                value={data.site?.contactPhone || ""}
                onChange={(e) =>
                  setForm({ ...form, contactPhone: e.target.value })
                }
                placeholder="+254..."
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                Address
              </label>
              <input
                value={data.site?.address || ""}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Moi Avenue, Nairobi"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                Primary Color
              </label>
              <input
                type="color"
                value={data.site?.primaryColor || "#c5a059"}
                onChange={(e) =>
                  setForm({ ...form, primaryColor: e.target.value })
                }
                className="w-full h-10 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-700"
              />
            </div>
          </div>
          <button
            onClick={() => {
              patchData({
                site: normalizeSite({
                  ...data.site,
                  ...form,
                  id: data.site?.id,
                }),
              });
              toast("Site configuration saved");
            }}
            className="mt-4 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-lg text-sm font-medium"
          >
            Save Site
          </button>
        </div>
      )}

      {section === "blog" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {filteredBlog.length === 0 ? (
            <div className="p-14 text-center text-gray-500 dark:text-gray-400">
              <FileText size={40} className="mx-auto mb-3 opacity-40" /> No blog
              posts yet — write your first post.
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {filteredBlog.map((post) => (
                <div
                  key={post.id}
                  className="flex items-center justify-between p-4 gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 dark:text-white truncate">
                      {post.title}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {post.author} · {post.category} · slug: /
                      {post.slug || "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => togglePublish(post.id)}
                      className={`text-[10px] px-2 py-1 rounded-full font-medium ${post.status === "published" ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}
                    >
                      {post.status === "published" ? "Published" : "Draft"}
                    </button>
                    <button
                      onClick={() => openEdit("blog", post)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => removeItem("blog", post.id)}
                      className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-500 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {section === "team" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {data.team.length === 0 ? (
            <div className="p-14 text-center text-gray-500 dark:text-gray-400">
              <Users size={40} className="mx-auto mb-3 opacity-40" /> No team
              members yet.
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.team.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between p-4 gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 dark:text-white">
                      {m.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {m.role} · {m.bio || "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openEdit("team", m)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => removeItem("team", m.id)}
                      className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-500 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(section === "testimonials" ||
        section === "faqs" ||
        section === "portfolio" ||
        section === "jobs") && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {section === "testimonials" && data.testimonials.length === 0 && (
              <div className="p-14 text-center text-gray-500 dark:text-gray-400">
                <MessageSquareQuote
                  size={40}
                  className="mx-auto mb-3 opacity-40"
                />{" "}
                No testimonials yet.
              </div>
            )}
            {section === "testimonials" &&
              data.testimonials.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between p-4 gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 dark:text-white">
                      {t.author}{" "}
                      <span className="text-xs text-gray-400">
                        {"★".repeat(t.rating)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t.company} — "{t.quote}"
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openEdit("testimonials", t)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => removeItem("testimonials", t.id)}
                      className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-500 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            {section === "faqs" && data.faqs.length === 0 && (
              <div className="p-14 text-center text-gray-500 dark:text-gray-400">
                <HelpCircle size={40} className="mx-auto mb-3 opacity-40" /> No
                FAQs yet.
              </div>
            )}
            {section === "faqs" &&
              data.faqs.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between p-4 gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 dark:text-white">
                      {f.question}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {f.answer}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openEdit("faqs", f)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => removeItem("faqs", f.id)}
                      className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-500 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            {section === "portfolio" && data.portfolio.length === 0 && (
              <div className="p-14 text-center text-gray-500 dark:text-gray-400">
                <Briefcase size={40} className="mx-auto mb-3 opacity-40" /> No
                portfolio items yet.
              </div>
            )}
            {section === "portfolio" &&
              data.portfolio.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-4 gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 dark:text-white">
                      {p.projectName}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {p.category} — {p.description}
                    </div>
                    {p.url && (
                      <a
                        className="text-xs text-amber-500 hover:underline flex items-center gap-1"
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Link2 size={10} /> {p.url}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => openEdit("portfolio", p)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => removeItem("portfolio", p.id)}
                      className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-500 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            {section === "jobs" && data.jobs.length === 0 && (
              <div className="p-14 text-center text-gray-500 dark:text-gray-400">
                <Star size={40} className="mx-auto mb-3 opacity-40" /> No job
                postings yet.
              </div>
            )}
            {section === "jobs" &&
              data.jobs.map((j) => (
                <div
                  key={j.id}
                  className="flex items-center justify-between p-4 gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 dark:text-white">
                      {j.title}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {j.department} · {j.location} · {j.type}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => toggleJob(j.id)}
                      className={`text-[10px] px-2 py-1 rounded-full font-medium ${j.status === "open" ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400"}`}
                    >
                      {j.status === "open" ? "Open" : "Closed"}
                    </button>
                    <button
                      onClick={() => openEdit("jobs", j)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => removeItem("jobs", j.id)}
                      className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-500 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowModal(false)}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl p-5">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {editing.id ? "Edit" : "Add"}{" "}
              {editing.kind === "blog"
                ? "Post"
                : editing.kind === "team"
                  ? "Team Member"
                  : editing.kind === "testimonials"
                    ? "Testimonial"
                    : editing.kind === "faqs"
                      ? "FAQ"
                      : editing.kind === "portfolio"
                        ? "Portfolio Item"
                        : editing.kind === "jobs"
                          ? "Job Posting"
                          : "Item"}
            </h3>
            <div className="space-y-3">
              {editing.kind === "blog" && (
                <>
                  <input
                    value={form.title || ""}
                    onChange={(e) =>
                      setForm({ ...form, title: e.target.value })
                    }
                    placeholder="Title"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <input
                    value={form.author || ""}
                    onChange={(e) =>
                      setForm({ ...form, author: e.target.value })
                    }
                    placeholder="Author"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <input
                    value={form.category || ""}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value })
                    }
                    placeholder="Category"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <textarea
                    value={form.excerpt || ""}
                    onChange={(e) =>
                      setForm({ ...form, excerpt: e.target.value })
                    }
                    placeholder="Excerpt"
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <textarea
                    value={form.body || ""}
                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                    placeholder="Body (markdown-style text)"
                    rows={5}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <select
                    value={form.status || "draft"}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                  </select>
                </>
              )}
              {editing.kind === "team" && (
                <>
                  <input
                    value={form.name || ""}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Name"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <input
                    value={form.role || ""}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                    placeholder="Role"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <textarea
                    value={form.bio || ""}
                    onChange={(e) => setForm({ ...form, bio: e.target.value })}
                    placeholder="Short bio"
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <input
                    value={form.photoUrl || ""}
                    onChange={(e) =>
                      setForm({ ...form, photoUrl: e.target.value })
                    }
                    placeholder="Photo URL (optional)"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <input
                    value={form.order || "0"}
                    onChange={(e) =>
                      setForm({ ...form, order: e.target.value })
                    }
                    placeholder="Display order"
                    type="number"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </>
              )}
              {editing.kind === "testimonials" && (
                <>
                  <input
                    value={form.author || ""}
                    onChange={(e) =>
                      setForm({ ...form, author: e.target.value })
                    }
                    placeholder="Author"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <input
                    value={form.company || ""}
                    onChange={(e) =>
                      setForm({ ...form, company: e.target.value })
                    }
                    placeholder="Company"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <textarea
                    value={form.quote || ""}
                    onChange={(e) =>
                      setForm({ ...form, quote: e.target.value })
                    }
                    placeholder="Quote"
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <input
                    value={form.rating || "5"}
                    onChange={(e) =>
                      setForm({ ...form, rating: e.target.value })
                    }
                    type="number"
                    min={1}
                    max={5}
                    placeholder="Rating 1-5"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </>
              )}
              {editing.kind === "faqs" && (
                <>
                  <input
                    value={form.question || ""}
                    onChange={(e) =>
                      setForm({ ...form, question: e.target.value })
                    }
                    placeholder="Question"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <textarea
                    value={form.answer || ""}
                    onChange={(e) =>
                      setForm({ ...form, answer: e.target.value })
                    }
                    placeholder="Answer"
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <input
                    value={form.order || "0"}
                    onChange={(e) =>
                      setForm({ ...form, order: e.target.value })
                    }
                    type="number"
                    placeholder="Order"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </>
              )}
              {editing.kind === "portfolio" && (
                <>
                  <input
                    value={form.projectName || ""}
                    onChange={(e) =>
                      setForm({ ...form, projectName: e.target.value })
                    }
                    placeholder="Project name"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <input
                    value={form.category || ""}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value })
                    }
                    placeholder="Category"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <textarea
                    value={form.description || ""}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    placeholder="Description"
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <input
                    value={form.url || ""}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    placeholder="External URL (optional)"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </>
              )}
              {editing.kind === "jobs" && (
                <>
                  <input
                    value={form.title || ""}
                    onChange={(e) =>
                      setForm({ ...form, title: e.target.value })
                    }
                    placeholder="Job title"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <input
                    value={form.department || ""}
                    onChange={(e) =>
                      setForm({ ...form, department: e.target.value })
                    }
                    placeholder="Department"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <input
                    value={form.location || ""}
                    onChange={(e) =>
                      setForm({ ...form, location: e.target.value })
                    }
                    placeholder="Location"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <input
                    value={form.type || "Full-time"}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    placeholder="Type (Full-time, Part-time...)"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <textarea
                    value={form.description || ""}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    placeholder="Job description"
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </>
              )}
              <button
                onClick={saveItem}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-gray-900 dark:text-white rounded-xl font-medium transition-all"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
