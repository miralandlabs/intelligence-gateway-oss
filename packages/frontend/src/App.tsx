import { useState, useEffect, useCallback } from "react";
import {
  Search,
  ShieldCheck,
  Globe,
  ChevronDown,
  ChevronUp,
  Activity,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  BookOpen,
} from "lucide-react";
import "./index.css";

const API_BASE = "https://intel.pr402.org";

interface ReadinessSnapshot {
  entity_key: string;
  usable: boolean | null;
  confidence: number;
  latency_ms: number | null;
  state: "healthy" | "degraded" | "down" | "unknown";
  last_verified: string | null;
  payment_model: string | null;
}

interface ServiceResult {
  entity_key: string;
  entity_type: string;
  display_name?: string;
  domain?: string;
  endpoint_url?: string;
  capabilities: string[];
  payment_model: string | null;
  is_verified: boolean;
  readiness: ReadinessSnapshot | null;
}

interface SignalResult {
  signal_key: string;
  recommendation?: string;
  score?: number;
  payload?: Record<string, unknown>;
}

interface EntitySearchResult {
  entity_key: string;
  entity_type: string;
  display_name?: string;
  domain?: string;
  endpoint_url?: string;
  is_verified: boolean;
  signals?: SignalResult[];
}

const ENTITY_TYPES = ["api", "vendor", "domain", "protocol", "other"] as const;
const AUTH_TYPES = ["none", "x402-token", "bearer", "signed"] as const;

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function ReadinessBadge({ readiness }: { readiness: ReadinessSnapshot | null }) {
  if (!readiness) {
    return <span className="badge badge-unknown">Not probed</span>;
  }
  const cls =
    readiness.state === "healthy"
      ? "badge badge-verified"
      : readiness.state === "unknown"
        ? "badge badge-unknown"
        : "badge badge-warn";
  const label =
    readiness.usable === true
      ? "Usable"
      : readiness.usable === false
        ? "Not usable"
        : readiness.state;
  return (
    <span className={cls}>
      <Activity size={14} /> {label}
      {readiness.latency_ms != null ? ` · ${readiness.latency_ms}ms` : ""}
    </span>
  );
}

export default function App() {
  const [capabilityFilter, setCapabilityFilter] = useState("");
  const [query, setQuery] = useState("");
  const [services, setServices] = useState<ServiceResult[]>([]);
  const [searchResults, setSearchResults] = useState<EntitySearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<"browse" | "search">("browse");

  const [entityKey, setEntityKey] = useState("");
  const [entityType, setEntityType] = useState("api");
  const [displayName, setDisplayName] = useState("");
  const [domain, setDomain] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [ownerKey, setOwnerKey] = useState("");
  const [requestMonitoring, setRequestMonitoring] = useState(true);
  const [paymentModel, setPaymentModel] = useState("x402");
  const [authType, setAuthType] = useState("none");
  const [capabilities, setCapabilities] = useState("");
  const [probeUrl, setProbeUrl] = useState("");
  const [monitorTier, setMonitorTier] = useState("2");
  const [isRegistering, setIsRegistering] = useState(false);
  const [regStatus, setRegStatus] = useState<{
    ok: boolean;
    message: string;
    hint?: string;
  } | null>(null);

  const debouncedQuery = useDebounce(query, 400);

  const loadServices = useCallback(async (capability?: string) => {
    setIsLoading(true);
    setMode("browse");
    try {
      const params = new URLSearchParams({ payment_model: "x402" });
      if (capability?.trim()) params.set("capability", capability.trim());
      const res = await fetch(`${API_BASE}/v1/services?${params}`);
      const json = await res.json();
      setServices(json.results ?? []);
    } catch {
      setServices([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchResults([]);
      if (!debouncedQuery) setMode("browse");
      return;
    }
    setMode("search");
    setIsLoading(true);
    fetch(`${API_BASE}/v1/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then((res) => res.json())
      .then((json) => setSearchResults(json.results ?? []))
      .catch(() => setSearchResults([]))
      .finally(() => setIsLoading(false));
  }, [debouncedQuery]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRegistering(true);
    setRegStatus(null);

    const sanitizedDomain = domain
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "")
      .trim();

    try {
      const res = await fetch(`${API_BASE}/v1/entities/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_key: entityKey.trim() || sanitizedDomain,
          entity_type: entityType,
          display_name: displayName.trim() || undefined,
          domain: sanitizedDomain || undefined,
          endpoint_url: endpointUrl.trim() || undefined,
          owner_key: ownerKey.trim() || undefined,
          request_monitoring: requestMonitoring,
          monitor_tier: Number(monitorTier),
          sds: {
            payment_model: paymentModel || undefined,
            auth_type: authType,
            capabilities: capabilities
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean),
            probe_url: probeUrl.trim() || undefined,
            probe_tier: Number(monitorTier),
          },
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setRegStatus({
          ok: true,
          message: `${json.message ?? "Registered."} Monitoring: ${json.is_monitored ? "on" : "off"}.`,
        });
        setEntityKey("");
        setDisplayName("");
        setDomain("");
        setEndpointUrl("");
        setOwnerKey("");
        setCapabilities("");
        setProbeUrl("");
        loadServices(capabilityFilter);
      } else {
        setRegStatus({
          ok: false,
          message: json.error ?? "Registration failed.",
          hint: json.hint,
        });
      }
    } catch {
      setRegStatus({ ok: false, message: "Network error. Please try again." });
    } finally {
      setIsRegistering(false);
    }
  };

  const inputStyle = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    padding: "0.75rem 1rem",
    color: "var(--text-primary)",
    fontSize: "1rem",
    width: "100%",
  } as const;

  return (
    <div className="container">
      <header className="header">
        <h1>
          <span className="gradient-text">x402</span>{" "}
          <span className="accent-text-glow">Readiness Oracle</span>
        </h1>
        <p>
          Register paid API services (SRD v1), discover by capability, and expose{" "}
          <code>/v1/services/:key/ready</code> for agents.
        </p>
      </header>

      <div className="search-wrapper">
        <div className="search-input-container" style={{ marginBottom: "0.75rem" }}>
          <Search size={20} className="search-icon" />
          <input
            className="search-input"
            type="text"
            placeholder="Search by name or domain..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {isLoading && (
            <Loader2 size={20} className="search-icon" style={{ animation: "spin 1s linear infinite" }} />
          )}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="search-input"
            style={{ ...inputStyle, flex: "1 1 200px", maxWidth: 320 }}
            placeholder="Filter capability (e.g. search)"
            value={capabilityFilter}
            onChange={(e) => setCapabilityFilter(e.target.value)}
          />
          <button
            type="button"
            onClick={() => loadServices(capabilityFilter)}
            style={{
              padding: "0.65rem 1.25rem",
              borderRadius: 9999,
              border: "1px solid var(--border-color)",
              background: "rgba(255,255,255,0.06)",
              color: "var(--text-primary)",
              cursor: "pointer",
            }}
          >
            Browse x402 services
          </button>
        </div>
      </div>

      <div className="results-grid">
        {mode === "browse" ? (
          services.length === 0 ? (
            <div className="status-message">
              <span>No monitored x402 services yet. Register one below.</span>
            </div>
          ) : (
            services.map((s) => <ServiceCard key={s.entity_key} service={s} />)
          )
        ) : searchResults.length === 0 ? (
          <div className="status-message">
            <span>No results for &quot;{query}&quot;</span>
          </div>
        ) : (
          searchResults.map((e) => <SearchResultCard key={e.entity_key} entity={e} />)
        )}
      </div>

      <section className="onboarding-card" style={{ marginBottom: "3rem" }}>
        <h2 className="gradient-text">Register a Service (SRD v1)</h2>
        <p className="onboarding-subtitle">
          Sellers self-register probe metadata. Requires a public <code>probe_url</code> (health check).
          See <a href="#srd-v1">SRD v1 spec</a> below.
        </p>

        <form
          onSubmit={handleRegister}
          style={{ maxWidth: 560, margin: "0 auto", display: "flex", flexDirection: "column", gap: "1rem" }}
        >
          <Field label="Service Key *" hint="Unique id, e.g. acme-search">
            <input required style={inputStyle} placeholder="acme-search" value={entityKey} onChange={(e) => setEntityKey(e.target.value)} />
          </Field>
          <Field label="Display Name">
            <input style={inputStyle} placeholder="Acme Search API" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Field label="Entity Type *">
            <select style={inputStyle} value={entityType} onChange={(e) => setEntityType(e.target.value)}>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Domain">
            <input style={inputStyle} placeholder="api.acme.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
          </Field>
          <Field label="Endpoint URL *" hint="API base URL">
            <input style={inputStyle} placeholder="https://api.acme.com" value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} />
          </Field>
          <Field label="Probe URL *" hint="Unauthenticated health endpoint">
            <input style={inputStyle} placeholder="https://api.acme.com/health" value={probeUrl} onChange={(e) => setProbeUrl(e.target.value)} />
          </Field>
          <Field label="Capabilities" hint="Comma-separated tags for discovery">
            <input style={inputStyle} placeholder="search, retrieval" value={capabilities} onChange={(e) => setCapabilities(e.target.value)} />
          </Field>
          <Field label="Payment Model">
            <input style={inputStyle} placeholder="x402" value={paymentModel} onChange={(e) => setPaymentModel(e.target.value)} />
          </Field>
          <Field label="Auth Type" hint="Use x402-token/bearer/signed only if probes need credentials">
            <select style={inputStyle} value={authType} onChange={(e) => setAuthType(e.target.value)}>
              {AUTH_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Monitor Tier">
            <select style={inputStyle} value={monitorTier} onChange={(e) => setMonitorTier(e.target.value)}>
              <option value="1">1 — frequent (high priority)</option>
              <option value="2">2 — standard</option>
              <option value="3">3 — low frequency</option>
            </select>
          </Field>
          <Field label="Owner Key (optional DNS verify)">
            <input style={inputStyle} placeholder="ed25519 public key" value={ownerKey} onChange={(e) => setOwnerKey(e.target.value)} />
          </Field>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
            <input type="checkbox" checked={requestMonitoring} onChange={(e) => setRequestMonitoring(e.target.checked)} />
            Enable continuous monitoring
          </label>
          <button type="submit" disabled={isRegistering} className="register-btn">
            {isRegistering ? "Registering..." : "Register Service"}
          </button>
          {regStatus && <StatusMessage {...regStatus} />}
        </form>
      </section>

      <section className="onboarding-card" id="srd-v1">
        <h2 className="gradient-text">
          <BookOpen size={24} style={{ verticalAlign: "middle", marginRight: 8 }} />
          SRD v1 Specification
        </h2>
        <p className="onboarding-subtitle">
          Service Readiness Descriptor — canonical registration format. Full doc:{" "}
          <code>intelligence-gateway-oss/docs/srd-v1.md</code>
        </p>
        <pre className="schema-block" style={{ textAlign: "left", fontSize: "0.75rem" }}>
{`POST /v1/entities/register
{
  "entity_key": "acme-search",
  "entity_type": "api",
  "request_monitoring": true,
  "endpoint_url": "https://api.acme.com",
  "sds": {
    "capabilities": ["search"],
    "payment_model": "x402",
    "auth_type": "none",
    "probe_url": "https://api.acme.com/health",
    "probe_tier": 2
  }
}

GET /v1/services/{entity_key}/ready  → usable, confidence, state`}
        </pre>
      </section>

      <footer className="footer">
        <p>
          API: <a href={`${API_BASE}/health`}>{API_BASE}</a> · SRD v1 ·{" "}
          <a href="https://ipay.sh" target="_blank" rel="noopener noreferrer">ipay.sh</a>
        </p>
      </footer>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>{label}</label>
      {hint && <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", opacity: 0.7, marginBottom: 4 }}>{hint}</div>}
      {children}
    </div>
  );
}

function StatusMessage({ ok, message, hint }: { ok: boolean; message: string; hint?: string }) {
  return (
    <div
      style={{
        padding: "0.75rem 1rem",
        borderRadius: 8,
        background: ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
        border: `1px solid ${ok ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
        color: ok ? "var(--success)" : "#ef4444",
        fontSize: "0.95rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        {ok ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
        <span>{message}</span>
      </div>
      {hint && <div style={{ marginTop: 8, fontSize: "0.85rem", fontFamily: "monospace" }}>{hint}</div>}
    </div>
  );
}

function ServiceCard({ service }: { service: ServiceResult }) {
  return (
    <article className="agent-card">
      <div className="card-header">
        <h3 className="ans-title">
          <Globe size={22} style={{ color: "var(--accent-cyan)" }} />
          {service.display_name ?? service.entity_key}
        </h3>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {service.is_verified && (
            <span className="badge badge-verified"><ShieldCheck size={14} /> Verified</span>
          )}
          <ReadinessBadge readiness={service.readiness} />
        </div>
      </div>
      {service.endpoint_url && (
        <div className="endpoint-info">
          <ExternalLink size={14} />
          <a href={service.endpoint_url} target="_blank" rel="noopener noreferrer">{service.endpoint_url}</a>
        </div>
      )}
      <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
        {service.capabilities.length > 0 ? service.capabilities.join(", ") : "no capabilities"} · {service.entity_key}
      </div>
      <div style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
        <a
          href={`${API_BASE}/v1/services/${encodeURIComponent(service.entity_key)}/ready`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent-cyan)" }}
        >
          Open /ready JSON
        </a>
      </div>
    </article>
  );
}

function SearchResultCard({ entity }: { entity: EntitySearchResult }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="agent-card">
      <div className="card-header">
        <h3 className="ans-title">{entity.display_name ?? entity.entity_key}</h3>
        {entity.is_verified && (
          <span className="badge badge-verified"><ShieldCheck size={14} /> Verified</span>
        )}
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
        {entity.entity_type} · {entity.entity_key}
      </div>
      <a
        href={`${API_BASE}/v1/services/${encodeURIComponent(entity.entity_key)}/ready`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--accent-cyan)", fontSize: "0.85rem" }}
      >
        Check /ready
      </a>
      {(entity.signals?.length ?? 0) > 0 && (
        <div className="tools-section">
          <div className="tools-toggle" onClick={() => setExpanded(!expanded)}>
            <span>{entity.signals?.length} signals</span>
            {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
          {expanded && (
            <div className="tools-list">
              {entity.signals?.map((s) => (
                <div key={s.signal_key} className="tool-item">
                  <div className="tool-name">{s.signal_key}</div>
                  <div className="tool-description">{s.recommendation ?? ""}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
