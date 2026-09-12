import { useState, useEffect } from "react";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import {
  getMpesaConfig,
  saveMpesaConfig,
  getKopokopoConfig,
  saveKopokopoConfig,
  getPayheroConfig,
  savePayheroConfig,
  DEFAULT_MPESA_CONFIG,
  DEFAULT_KOPOKOPO_CONFIG,
  DEFAULT_PAYHERO_CONFIG,
  type MpesaIntegrationConfig,
  type KopokopoIntegrationConfig,
  type PayheroIntegrationConfig,
} from "@/react-app/lib/mpesa-integration-service";
import {
  payheroListChannels,
  payheroWalletBalance,
} from "@/react-app/lib/integrations-client";
import {
  Smartphone,
  Building2,
  Eye,
  EyeOff,
  Save,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  Zap,
} from "lucide-react";
import { isKenyaStation } from "@/react-app/lib/currency";

type View = "catalog" | "mpesa" | "kopokopo" | "payhero";

export default function IntegrationsSettings() {
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const isKenya = isKenyaStation();

  const [view, setView] = useState<View>("catalog");
  const [mpesaConnected, setMpesaConnected] = useState(false);
  const [kopoConnected, setKopoConnected] = useState(false);
  const [payheroConnected, setPayheroConnected] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const m = await getMpesaConfig(stationId);
      setMpesaConnected(m.enabled && !!m.consumerKey);
      const k = await getKopokopoConfig(stationId);
      setKopoConnected(k.enabled && !!k.clientId);
      const p = await getPayheroConfig(stationId);
      setPayheroConnected(p.enabled && !!p.apiUsername);
    })();
  }, [user, stationId]);

  if (view === "mpesa") {
    return (
      <MpesaSetup
        onBack={() => setView("catalog")}
        stationId={stationId}
        isKenya={isKenya}
      />
    );
  }
  if (view === "kopokopo") {
    return (
      <KopokopoSetup
        onBack={() => setView("catalog")}
        stationId={stationId}
        isKenya={isKenya}
      />
    );
  }
  if (view === "payhero") {
    return (
      <PayheroSetup
        onBack={() => setView("catalog")}
        stationId={stationId}
        isKenya={isKenya}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Integrations
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Connect your business with payment processors, shipping providers, and
          other services.
        </p>
      </div>

      {/* Available Integrations */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wide">
          Available Integrations
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isKenya ? (
            <>
              {/* M-PESA */}
              <IntegrationCard
                icon={
                  <Smartphone className="text-green-600 dark:text-green-400" />
                }
                iconBg="bg-green-100 dark:bg-green-900/30"
                name="M-PESA"
                category="Payment"
                description="Accept mobile money payments from customers using Safaricom M-PESA. Supports STK Push for instant payment requests, C2B payments, and real-time transaction verification."
                connected={mpesaConnected}
                onSetup={() => setView("mpesa")}
              />
              {/* Kopo Kopo */}
              <IntegrationCard
                icon={
                  <Building2 className="text-blue-600 dark:text-blue-400" />
                }
                iconBg="bg-blue-100 dark:bg-blue-900/30"
                name="Kopo Kopo"
                category="Payment"
                description="Accept mobile money payments via Kopo Kopo. Supports M-PESA STK Push through your Kopo Kopo till, with real-time payment notifications via webhooks."
                connected={kopoConnected}
                onSetup={() => setView("kopokopo")}
              />
              {/* PayHero Kenya */}
              <IntegrationCard
                icon={
                  <Smartphone className="text-violet-600 dark:text-violet-400" />
                }
                iconBg="bg-violet-100 dark:bg-violet-900/30"
                name="PayHero Kenya"
                category="Payment"
                description="Accept M-PESA payments via PayHero Kenya (payherokenya.com). STK Push through your PayHero channel (till/paybill), payment status queries, and callback notifications."
                connected={payheroConnected}
                onSetup={() => setView("payhero")}
              />
            </>
          ) : (
            <div className="md:col-span-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-2xl p-6 flex items-start gap-3">
              <AlertTriangle
                size={22}
                className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
              />
              <div>
                <h4 className="font-semibold text-amber-800 dark:text-amber-300">
                  M-PESA is available in Kenya only
                </h4>
                <p className="text-sm text-amber-700 dark:text-amber-400/80 mt-1">
                  Safaricom M-PESA, Kopo Kopo and PayHero Kenya integrations are
                  Kenya-specific mobile money payment methods. They are not
                  available for the detected station country. Switch your
                  station to Kenya to configure these integrations.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Integration Card
// ---------------------------------------------------------------------------

function IntegrationCard({
  icon,
  iconBg,
  name,
  category,
  description,
  connected,
  onSetup,
}: {
  icon: React.ReactNode;
  iconBg: string;
  name: string;
  category: string;
  description: string;
  connected: boolean;
  onSetup: () => void;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 flex flex-col">
      <div className="flex items-start gap-3 mb-3">
        <div
          className={`w-12 h-12 ${iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-lg font-bold text-gray-900 dark:text-white">
              {name}
            </h4>
            {connected && (
              <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full font-medium flex items-center gap-0.5">
                <CheckCircle2 size={10} /> Connected
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 uppercase tracking-wide">
            {category}
          </p>
        </div>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 flex-1">
        {description}
      </p>
      <button
        onClick={onSetup}
        className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
          connected
            ? "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            : "bg-green-600 hover:bg-green-700 text-white"
        }`}
        title="Next"
        aria-label="Next"
      >
        {connected ? "Configure" : "Setup"}
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// M-PESA Setup Form
// ---------------------------------------------------------------------------

function MpesaSetup({
  onBack,
  stationId,
  isKenya,
}: {
  onBack: () => void;
  stationId: string | undefined;
  isKenya: boolean;
}) {
  const [config, setConfig] =
    useState<MpesaIntegrationConfig>(DEFAULT_MPESA_CONFIG);
  const [showSecret, setShowSecret] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [showInitPass, setShowInitPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const c = await getMpesaConfig(stationId);
      setConfig(c);
      setLoaded(true);
    })();
  }, [stationId]);

  const update = (patch: Partial<MpesaIntegrationConfig>) =>
    setConfig((prev) => ({ ...prev, ...patch }));

  const handleSave = async () => {
    setError("");
    if (!config.consumerKey.trim() || !config.consumerSecret.trim()) {
      setError("Consumer Key and Consumer Secret are required.");
      return;
    }
    if (!config.shortcode.trim()) {
      setError("Business Shortcode is required.");
      return;
    }
    setSaving(true);
    try {
      await saveMpesaConfig(config, stationId);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded)
    return <div className="py-8 text-center text-gray-400">Loading…</div>;

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
      >
        <ChevronLeft size={16} /> Integrations
      </button>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
          <Smartphone
            className="text-green-600 dark:text-green-400"
            size={24}
          />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            M-PESA Integration
          </h2>
          <p className="text-xs text-gray-400 uppercase tracking-wide">
            Safaricom Daraja API
          </p>
        </div>
      </div>

      {!isKenya && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-xl p-6 flex items-start gap-3">
          <AlertTriangle
            size={22}
            className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
          />
          <div>
            <h3 className="font-semibold text-amber-800 dark:text-amber-300">
              M-PESA is available in Kenya only
            </h3>
            <p className="text-sm text-amber-700 dark:text-amber-400/80 mt-1">
              Safaricom M-PESA is a Kenya-specific payment method and cannot be
              configured for the detected station country. Switch your station
              to Kenya to configure M-PESA.
            </p>
          </div>
        </div>
      )}

      {isKenya && (
        <>
          <Section
            title="Integration Details"
            subtitle="Basic information about this integration"
          >
            <Field label="Integration Name" required>
              <input
                type="text"
                value={config.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="M-PESA"
                className={inputCls}
              />
            </Field>
            <Field
              label="Type"
              required
              hint="Choose between Buy Goods or Paybill integration"
            >
              <select
                value={config.type}
                onChange={(e) =>
                  update({ type: e.target.value as "buy_goods" | "paybill" })
                }
                className={inputCls}
              >
                <option value="buy_goods">Buy Goods (Till Number)</option>
                <option value="paybill">Paybill</option>
              </select>
            </Field>
          </Section>

          {/* API Credentials */}
          <Section
            title="API Credentials"
            subtitle="Your M-PESA API credentials from Safaricom Daraja"
          >
            <Field label="Consumer Key" required>
              <input
                type={showSecret ? "text" : "password"}
                value={config.consumerKey}
                onChange={(e) => update({ consumerKey: e.target.value })}
                placeholder="Enter your Consumer Key"
                className={inputCls}
              />
            </Field>
            <Field label="Consumer Secret" required>
              <div className="relative">
                <input
                  type={showSecret ? "text" : "password"}
                  value={config.consumerSecret}
                  onChange={(e) => update({ consumerSecret: e.target.value })}
                  placeholder="Enter your Consumer Secret"
                  className={inputCls + " pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            <Field
              label="Passkey"
              required
              hint="Used for STK Push transactions"
            >
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={config.passkey}
                  onChange={(e) => update({ passkey: e.target.value })}
                  placeholder="Enter your Passkey"
                  className={inputCls + " pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            <Field
              label="Initiator Name"
              required
              hint="Username for initiating transactions"
            >
              <input
                type="text"
                value={config.initiatorName}
                onChange={(e) => update({ initiatorName: e.target.value })}
                placeholder="Enter Initiator Name"
                className={inputCls}
              />
            </Field>
            <Field
              label="Initiator Password"
              required
              hint="Password for the initiator"
            >
              <div className="relative">
                <input
                  type={showInitPass ? "text" : "password"}
                  value={config.initiatorPassword}
                  onChange={(e) =>
                    update({ initiatorPassword: e.target.value })
                  }
                  placeholder="Enter Initiator Password"
                  className={inputCls + " pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowInitPass(!showInitPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showInitPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            <Field label="Business Shortcode" required>
              <input
                type="text"
                value={config.shortcode}
                onChange={(e) => update({ shortcode: e.target.value })}
                placeholder="Enter your Business Shortcode"
                className={inputCls}
              />
            </Field>
            <Field
              label="Account Reference"
              required
              hint="Alpha-numeric identifier displayed to customers in STK Pin prompt. Maximum 12 characters."
            >
              <input
                type="text"
                maxLength={12}
                value={config.accountReference}
                onChange={(e) => update({ accountReference: e.target.value })}
                placeholder="Enter Account Reference"
                className={inputCls}
              />
            </Field>
          </Section>

          {/* Configuration */}
          <Section title="Configuration" subtitle="Integration settings">
            <Field
              label="Environment"
              required
              hint="Use sandbox for testing, production for live transactions"
            >
              <select
                value={config.environment}
                onChange={(e) =>
                  update({
                    environment: e.target.value as "sandbox" | "production",
                  })
                }
                className={inputCls}
              >
                <option value="sandbox">Sandbox (Testing)</option>
                <option value="production">Production (Live)</option>
              </select>
            </Field>
            <Field
              label="Status"
              hint="When enabled, M-PESA will be available for processing payments"
            >
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => update({ enabled: e.target.checked })}
                  className="w-5 h-5 rounded text-green-600 focus:ring-green-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Enable this integration
                </span>
              </label>
            </Field>
          </Section>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle size={16} /> {error}
            </div>
          )}
          {saved && (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 size={16} /> Integration saved successfully!
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            {saving ? (
              <>
                <Zap size={18} className="animate-pulse" /> Saving…
              </>
            ) : (
              <>
                <Save size={18} /> Save Integration
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kopo Kopo Setup Form
// ---------------------------------------------------------------------------

function KopokopoSetup({
  onBack,
  stationId,
  isKenya,
}: {
  onBack: () => void;
  stationId: string | undefined;
  isKenya: boolean;
}) {
  const [config, setConfig] = useState<KopokopoIntegrationConfig>(
    DEFAULT_KOPOKOPO_CONFIG,
  );
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const c = await getKopokopoConfig(stationId);
      setConfig(c);
      setLoaded(true);
    })();
  }, [stationId]);

  const update = (patch: Partial<KopokopoIntegrationConfig>) =>
    setConfig((prev) => ({ ...prev, ...patch }));

  const handleSave = async () => {
    setError("");
    if (!config.clientId.trim() || !config.clientSecret.trim()) {
      setError("Client ID and Client Secret are required.");
      return;
    }
    if (!config.tillNumber.trim()) {
      setError("Till Number is required.");
      return;
    }
    setSaving(true);
    try {
      await saveKopokopoConfig(config, stationId);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded)
    return <div className="py-8 text-center text-gray-400">Loading…</div>;

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
      >
        <ChevronLeft size={16} /> Integrations
      </button>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
          <Building2 className="text-blue-600 dark:text-blue-400" size={24} />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Kopo Kopo Integration
          </h2>
          <p className="text-xs text-gray-400 uppercase tracking-wide">
            Payment Gateway
          </p>
        </div>
      </div>

      {!isKenya && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-xl p-6 flex items-start gap-3">
          <AlertTriangle
            size={22}
            className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
          />
          <div>
            <h3 className="font-semibold text-amber-800 dark:text-amber-300">
              Kopo Kopo is available in Kenya only
            </h3>
            <p className="text-sm text-amber-700 dark:text-amber-400/80 mt-1">
              Kopo Kopo is a Kenya-specific mobile money payment method and
              cannot be configured for the detected station country. Switch your
              station to Kenya to configure Kopo Kopo.
            </p>
          </div>
        </div>
      )}

      {isKenya && (
        <>
          {/* Integration Details */}
          <Section
            title="Integration Details"
            subtitle="Basic information about this integration"
          >
            <Field label="Integration Name" required>
              <input
                type="text"
                value={config.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Kopo Kopo"
                className={inputCls}
              />
            </Field>
          </Section>

          {/* API Credentials */}
          <Section
            title="API Credentials"
            subtitle="Your OAuth application credentials from the Kopo Kopo developer portal"
          >
            <Field label="Client ID" required>
              <input
                type="text"
                value={config.clientId}
                onChange={(e) => update({ clientId: e.target.value })}
                placeholder="Enter your Client ID"
                className={inputCls}
              />
            </Field>
            <Field label="Client Secret" required>
              <div className="relative">
                <input
                  type={showClientSecret ? "text" : "password"}
                  value={config.clientSecret}
                  onChange={(e) => update({ clientSecret: e.target.value })}
                  placeholder="Enter your Client Secret"
                  className={inputCls + " pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowClientSecret(!showClientSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showClientSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            <Field
              label="Till Number"
              required
              hint="Your Kopo Kopo till number (e.g. K000000 or 000000)"
            >
              <input
                type="text"
                value={config.tillNumber}
                onChange={(e) => update({ tillNumber: e.target.value })}
                placeholder="K000000"
                className={inputCls}
              />
            </Field>
            <Field
              label="API Key"
              required
              hint="Used to verify the HMAC signature on incoming webhook notifications"
            >
              <div className="relative">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={config.apiKey}
                  onChange={(e) => update({ apiKey: e.target.value })}
                  placeholder="Enter your API Key"
                  className={inputCls + " pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
          </Section>

          {/* Configuration */}
          <Section title="Configuration" subtitle="Integration settings">
            <Field
              label="Environment"
              required
              hint="Use sandbox for testing, production for live transactions"
            >
              <select
                value={config.environment}
                onChange={(e) =>
                  update({
                    environment: e.target.value as "sandbox" | "production",
                  })
                }
                className={inputCls}
              >
                <option value="sandbox">Sandbox (Testing)</option>
                <option value="production">Production (Live)</option>
              </select>
            </Field>
            <Field
              label="Transaction Search Window"
              required
              hint="How far back cashiers can search for transactions"
            >
              <select
                value={config.searchWindowHours}
                onChange={(e) =>
                  update({ searchWindowHours: parseInt(e.target.value) })
                }
                className={inputCls}
              >
                <option value={6}>Last 6 hours</option>
                <option value={12}>Last 12 hours</option>
                <option value={24}>Last 24 hours</option>
                <option value={48}>Last 48 hours</option>
                <option value={72}>Last 3 days</option>
                <option value={168}>Last 7 days</option>
              </select>
            </Field>
            <Field
              label="Status"
              hint="When enabled, Kopo Kopo will be available for processing payments"
            >
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => update({ enabled: e.target.checked })}
                  className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Enable this integration
                </span>
              </label>
            </Field>
          </Section>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle size={16} /> {error}
            </div>
          )}
          {saved && (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 size={16} /> Integration saved successfully!
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            {saving ? (
              <>
                <Zap size={18} className="animate-pulse" /> Saving…
              </>
            ) : (
              <>
                <Save size={18} /> Save Integration
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PayHero Kenya Setup Form
// ---------------------------------------------------------------------------

function PayheroSetup({
  onBack,
  stationId,
  isKenya,
}: {
  onBack: () => void;
  stationId: string | undefined;
  isKenya: boolean;
}) {
  const [config, setConfig] = useState<PayheroIntegrationConfig>(
    DEFAULT_PAYHERO_CONFIG,
  );
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetchingChannels, setFetchingChannels] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    lines: string[];
  } | null>(null);

  const handleFetchChannels = async () => {
    setError("");
    setTestResult(null);
    if (!config.apiUsername.trim() || !config.apiPassword.trim()) {
      setError("Enter your API Username and API Password first.");
      return;
    }
    setFetchingChannels(true);
    try {
      const res = await payheroListChannels({
        apiUsername: config.apiUsername.trim(),
        apiPassword: config.apiPassword.trim(),
      });
      if (!res.success) {
        setError(res.error || "Could not fetch PayHero channels.");
        return;
      }
      const channels = (res.channels || []) as Array<{
        id: number;
        is_active?: boolean;
        description?: string;
        short_code?: string;
        transaction_type?: string;
      }>;
      if (channels.length === 0) {
        setError(
          "Connected, but no payment channels found on this PayHero account. Create one in the PayHero dashboard first.",
        );
        return;
      }
      const active = channels.find((c) => c.is_active) || channels[0];
      update({ channelId: String(active.id) });
      setTestResult({
        ok: true,
        lines: channels.map(
          (c) =>
            `Channel ${c.id}: ${c.description || c.transaction_type || "M-PESA"}` +
            (c.short_code ? ` (${c.short_code})` : "") +
            (c.is_active ? "" : " — inactive"),
        ),
      });
    } finally {
      setFetchingChannels(false);
    }
  };

  const handleTestConnection = async () => {
    setError("");
    setTestResult(null);
    if (!config.apiUsername.trim() || !config.apiPassword.trim()) {
      setError("Enter your API Username and API Password first.");
      return;
    }
    setTesting(true);
    try {
      const creds = {
        apiUsername: config.apiUsername.trim(),
        apiPassword: config.apiPassword.trim(),
      };
      const [walletRes, channelsRes] = await Promise.all([
        payheroWalletBalance(creds),
        payheroListChannels(creds),
      ]);
      if (!walletRes.success && !channelsRes.success) {
        setTestResult({
          ok: false,
          lines: [
            walletRes.error ||
              channelsRes.error ||
              "Connection failed — check your credentials.",
          ],
        });
        return;
      }
      const lines: string[] = ["Connected to PayHero successfully."];
      if (walletRes.success) {
        const w = (walletRes.wallet || {}) as {
          id?: number;
          available_balance?: number;
          currency?: string;
          wallet_status?: string;
          account_id?: number;
        };
        lines.push(
          `Wallet #${w.account_id ?? w.id ?? ""}: ` +
            `${w.currency || "KES"} ${Number(w.available_balance ?? 0).toLocaleString()} available` +
            (w.wallet_status ? ` (status: ${w.wallet_status})` : ""),
        );
      }
      const channels = (channelsRes.channels || []) as Array<{
        id: number;
        is_active?: boolean;
        description?: string;
      }>;
      if (channelsRes.success) {
        lines.push(
          channels.length > 0
            ? `${channels.length} payment channel(s): ${channels
                .map((c) => `#${c.id}${c.is_active ? "" : " (inactive)"}`)
                .join(", ")}`
            : "No payment channels on this account yet — create one in the PayHero dashboard.",
        );
      }
      setTestResult({ ok: true, lines });
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    (async () => {
      const c = await getPayheroConfig(stationId);
      setConfig(c);
      setLoaded(true);
    })();
  }, [stationId]);

  const update = (patch: Partial<PayheroIntegrationConfig>) =>
    setConfig((prev) => ({ ...prev, ...patch }));

  const handleSave = async () => {
    setError("");
    if (!config.apiUsername.trim() || !config.apiPassword.trim()) {
      setError("API Username and API Password are required.");
      return;
    }
    if (!config.channelId.trim() || isNaN(Number(config.channelId))) {
      setError(
        "Channel ID must be a valid number (from your PayHero dashboard).",
      );
      return;
    }
    setSaving(true);
    try {
      await savePayheroConfig(config, stationId);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded)
    return <div className="py-8 text-center text-gray-400">Loading…</div>;

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
      >
        <ChevronLeft size={16} /> Integrations
      </button>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-violet-100 dark:bg-violet-900/30 rounded-xl flex items-center justify-center">
          <Smartphone
            className="text-violet-600 dark:text-violet-400"
            size={24}
          />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            PayHero Kenya Integration
          </h2>
          <p className="text-xs text-gray-400 uppercase tracking-wide">
            Payment Gateway (payherokenya.com)
          </p>
        </div>
      </div>

      {!isKenya && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-xl p-6 flex items-start gap-3">
          <AlertTriangle
            size={22}
            className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
          />
          <div>
            <h3 className="font-semibold text-amber-800 dark:text-amber-300">
              PayHero is available in Kenya only
            </h3>
            <p className="text-sm text-amber-700 dark:text-amber-400/80 mt-1">
              PayHero Kenya processes M-PESA mobile money payments and cannot be
              configured for the detected station country. Switch your station
              to Kenya to configure PayHero.
            </p>
          </div>
        </div>
      )}

      {isKenya && (
        <>
          {/* Integration Details */}
          <Section
            title="Integration Details"
            subtitle="Basic information about this integration"
          >
            <Field label="Integration Name" required>
              <input
                type="text"
                value={config.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="PayHero"
                className={inputCls}
              />
            </Field>
          </Section>

          {/* API Credentials */}
          <Section
            title="API Credentials"
            subtitle="Your Basic-auth credentials + channel ID from the PayHero dashboard (backend.payhero.co.ke)"
          >
            <Field label="API Username" required>
              <input
                type="text"
                value={config.apiUsername}
                onChange={(e) => update({ apiUsername: e.target.value })}
                placeholder="Enter your PayHero API Username"
                className={inputCls}
              />
            </Field>
            <Field label="API Password" required>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={config.apiPassword}
                  onChange={(e) => update({ apiPassword: e.target.value })}
                  placeholder="Enter your PayHero API Password"
                  className={inputCls + " pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            <Field
              label="Channel ID"
              required
              hint="Your PayHero payment channel ID (numeric) — created in the PayHero dashboard under Payment Channels, or fetch it automatically"
            >
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={config.channelId}
                  onChange={(e) => update({ channelId: e.target.value })}
                  placeholder="e.g. 5313"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={handleFetchChannels}
                  disabled={fetchingChannels}
                  className="shrink-0 px-3 py-2 bg-violet-100 dark:bg-violet-900/30 hover:bg-violet-200 dark:hover:bg-violet-900/50 text-violet-700 dark:text-violet-300 text-xs font-medium rounded-lg flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                >
                  <Zap
                    size={14}
                    className={fetchingChannels ? "animate-pulse" : ""}
                  />
                  {fetchingChannels ? "Fetching…" : "Fetch from PayHero"}
                </button>
              </div>
            </Field>
            <Field
              label="Account Reference"
              hint="Shown to customers on the M-PESA prompt. Max 12 characters. Defaults to the station name."
            >
              <input
                type="text"
                maxLength={12}
                value={config.accountReference}
                onChange={(e) => update({ accountReference: e.target.value })}
                placeholder="e.g. FUELPRO"
                className={inputCls}
              />
            </Field>
          </Section>

          {/* Configuration */}
          <Section title="Configuration" subtitle="Integration settings">
            <Field
              label="Status"
              hint="When enabled, PayHero STK Push is available for payment collection"
            >
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => update({ enabled: e.target.checked })}
                  className="w-5 h-5 rounded text-violet-600 focus:ring-violet-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Enable this integration
                </span>
              </label>
            </Field>
          </Section>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle size={16} /> {error}
            </div>
          )}
          {saved && (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 size={16} /> Integration saved successfully!
            </div>
          )}
          {testResult && (
            <div
              className={`rounded-xl border p-4 text-sm space-y-1 ${
                testResult.ok
                  ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700/40 text-green-800 dark:text-green-300"
                  : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/40 text-red-800 dark:text-red-300"
              }`}
            >
              {testResult.lines.map((line, i) => (
                <p key={i} className="flex items-start gap-2">
                  {testResult.ok ? (
                    <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  )}
                  <span>{line}</span>
                </p>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleTestConnection}
              disabled={testing || saving}
              className="flex-1 py-3 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 font-medium rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
            >
              {testing ? (
                <>
                  <Zap size={18} className="animate-pulse" /> Testing…
                </>
              ) : (
                <>
                  <CheckCircle2 size={18} /> Test Connection
                </>
              )}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || testing}
              className="flex-1 py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              {saving ? (
                <>
                  <Zap size={18} className="animate-pulse" /> Saving…
                </>
              ) : (
                <>
                  <Save size={18} /> Save Integration
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

const inputCls =
  "w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500 outline-none";

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{hint}</p>
      )}
    </div>
  );
}
