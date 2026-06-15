import { useState, useEffect, useCallback } from "react";
import {
  Search,
  ShieldCheck,
  Globe,
  ChevronDown,
  ChevronUp,
  Terminal,
  Cpu,
  Fingerprint,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import "./index.css";

const API_BASE = "https://intel.pr402.org";

// ─── Types ───────────────────────────────────────────────────────
interface SignalResult {
  signal_key: string;
  signal_type: string;
  score?: number;
  recommendation?: string;
  payload?: Record<string, unknown>;
  computed_at?: string;
}

interface EntityResult {
  entity_key: string;
  entity_type: string;
  display_name?: string;
  domain?: string;
  endpoint_url?: string;
  is_verified: boolean;
  updated_at?: string;
  signals?: SignalResult[];
}

// ─── Utility: Debounce ──────────────────────────────────────────
function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ═══════════════════════════════════════════════════════════════
//  App
// ═══════════════════════════════════════════════════════════════
export default function App() {
  // ── Search state ──
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntityResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // ── Registration state ──
  const [entityKey, setEntityKey] = useState("");
  const [entityType, setEntityType] = useState("vendor");
  const [displayName, setDisplayName] = useState("");
  const [domain, setDomain] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [ownerKey, setOwnerKey] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [regStatus, setRegStatus] = useState<{
    ok: boolean;
    message: string;
    hint?: string;
  } | null>(null);

  const debouncedQuery = useDebounce(query, 400);

  // ── Live search ──
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(
        `${API_BASE}/v1/search?q=${encodeURIComponent(q)}`
      );
      const json = await res.json();
      setResults(json.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setIsSearching(false);
      setHasSearched(true);
    }
  }, []);

  useEffect(() => {
    doSearch(debouncedQuery);
  }, [debouncedQuery, doSearch]);

  // ── Self-service registration ──
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
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setRegStatus({ ok: true, message: json.message ?? "Entity registered successfully." });
        setEntityKey("");
        setEntityType("vendor");
        setDisplayName("");
        setDomain("");
        setEndpointUrl("");
        setOwnerKey("");
      } else {
        setRegStatus({ 
          ok: false, 
          message: json.error ?? "Registration failed.",
          hint: json.hint 
        });
      }
    } catch {
      setRegStatus({ ok: false, message: "Network error. Please try again." });
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <div className="container">
      {/* ── Hero Header ── */}
      <header className="header">
        <h1>
          <span className="gradient-text">pr402</span>{" "}
          <span className="accent-text-glow">Intelligence Gateway</span>
        </h1>
        <p>
          A continuous intelligence catalog for entities, evidence, signals,
          and paid machine-readable feeds. Start with vendor and API risk,
          then plug in new domains without rebuilding the platform.
        </p>
      </header>

      {/* ── Search Bar ── */}
      <div className="search-wrapper">
        <div className="search-input-container">
          <Search size={20} className="search-icon" />
          <input
            id="search-input"
            className="search-input"
            type="text"
            placeholder="Search entities, vendors, APIs, datasets, or feeds"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {isSearching && (
            <Loader2 size={20} className="search-icon" style={{ animation: "spin 1s linear infinite" }} />
          )}
        </div>
      </div>

      {/* ── Results ── */}
      {hasSearched && (
        <div className="results-grid">
          {results.length === 0 ? (
            <div className="status-message">
              <Search size={40} style={{ opacity: 0.3 }} />
              <span>
                No entities found for "<strong>{query}</strong>".
              </span>
              <span style={{ fontSize: "0.9rem" }}>
                Register an entity below to populate the catalog.
              </span>
            </div>
          ) : (
            results.map((entity) => (
              <EntityCard key={entity.entity_key} entity={entity} />
            ))
          )}
        </div>
      )}

      {/* ── Self-Service Registration ── */}
      <section className="onboarding-card" style={{ marginBottom: "4rem" }}>
        <h2 className="gradient-text">Register an Entity</h2>
        <p className="onboarding-subtitle">
          Submit a domain, API, vendor, dataset, or market. Domain-control
          proof is optional, but verified entities get a stronger evidence badge.
        </p>

        <form
          onSubmit={handleRegister}
          style={{ maxWidth: 560, margin: "0 auto", display: "flex", flexDirection: "column", gap: "1rem" }}
        >
          <label style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
            Entity Key
          </label>
          <input
            id="entity-key"
            className="search-input"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border-color)",
              borderRadius: 8,
              padding: "0.75rem 1rem",
              color: "var(--text-primary)",
              fontSize: "1rem",
            }}
            placeholder="stripe.com"
            value={entityKey}
            onChange={(e) => setEntityKey(e.target.value)}
            required
          />

          <label style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
            Entity Type
          </label>
          <input
            id="entity-type"
            className="search-input"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border-color)",
              borderRadius: 8,
              padding: "0.75rem 1rem",
              color: "var(--text-primary)",
              fontSize: "1rem",
            }}
            placeholder="vendor"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            required
          />

          <label style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
            Display Name
          </label>
          <input
            id="display-name"
            className="search-input"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border-color)",
              borderRadius: 8,
              padding: "0.75rem 1rem",
              color: "var(--text-primary)",
              fontSize: "1rem",
            }}
            placeholder="Stripe"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />

          <label style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
            Domain
          </label>
          <input
            id="domain"
            className="search-input"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border-color)",
              borderRadius: 8,
              padding: "0.75rem 1rem",
              color: "var(--text-primary)",
              fontSize: "1rem",
            }}
            placeholder="stripe.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />

          <label style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
            Endpoint URL
          </label>
          <input
            id="endpoint-url"
            className="search-input"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border-color)",
              borderRadius: 8,
              padding: "0.75rem 1rem",
              color: "var(--text-primary)",
              fontSize: "1rem",
            }}
            placeholder="https://api.stripe.com"
            value={endpointUrl}
            onChange={(e) => setEndpointUrl(e.target.value)}
          />

          <label style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
            Owner Key (optional DNS proof)
          </label>
          <input
            id="owner-key"
            className="search-input"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border-color)",
              borderRadius: 8,
              padding: "0.75rem 1rem",
              color: "var(--text-primary)",
              fontSize: "1rem",
            }}
            placeholder="ed25519 public key"
            value={ownerKey}
            onChange={(e) => setOwnerKey(e.target.value)}
          />

          <button
            id="register-btn"
            type="submit"
            disabled={isRegistering}
            style={{
              marginTop: "0.5rem",
              padding: "0.85rem 2rem",
              borderRadius: 9999,
              border: "none",
              background: "linear-gradient(135deg, var(--accent-purple), var(--accent-cyan))",
              color: "#fff",
              fontSize: "1.05rem",
              fontWeight: 600,
              cursor: isRegistering ? "wait" : "pointer",
              opacity: isRegistering ? 0.7 : 1,
              transition: "all 0.3s ease",
              fontFamily: "var(--font-body)",
            }}
          >
            {isRegistering ? "Registering entity..." : "Register Entity"}
          </button>

          {regStatus && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                padding: "0.75rem 1rem",
                borderRadius: 8,
                background: regStatus.ok
                  ? "rgba(16,185,129,0.1)"
                  : "rgba(239,68,68,0.1)",
                border: `1px solid ${regStatus.ok ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
                color: regStatus.ok ? "var(--success)" : "#ef4444",
                fontSize: "0.95rem",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {regStatus.ok ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                <span>{regStatus.message}</span>
              </div>
              {regStatus.hint && (
                <div
                  style={{
                    marginTop: "0.25rem",
                    padding: "0.6rem 0.85rem",
                    borderRadius: 6,
                    background: "rgba(0,0,0,0.25)",
                    border: "1px solid rgba(239,68,68,0.2)",
                    fontSize: "0.85rem",
                    color: "rgba(255,255,255,0.75)",
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all"
                  }}
                >
                  <strong>How to fix:</strong> {regStatus.hint}
                </div>
              )}
            </div>
          )}
        </form>
      </section>

      {/* ── Developer Guide ── */}
      <section className="onboarding-card">
        <h2 className="gradient-text">How It Works</h2>
        <p className="onboarding-subtitle">
          Build a reusable intelligence product without binding the framework to
          one naming protocol or market.
        </p>

        <div className="steps-container">
          {/* Step 1 */}
          <div className="step-card">
            <span className="step-num">1</span>
            <Terminal size={28} style={{ color: "var(--accent-purple)", marginBottom: "0.75rem" }} />
            <h3>Collect Evidence</h3>
            <p>
              Collector plugins observe domains, APIs, feeds, filings, markets,
              or datasets and store immutable evidence snapshots.
            </p>
            <div className="code-snippet" style={{ fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>
              DNS, HTTP health, security.txt, status pages, GitHub freshness
            </div>
          </div>

          {/* Step 2 */}
          <div className="step-card">
            <span className="step-num">2</span>
            <Cpu size={28} style={{ color: "var(--accent-cyan)", marginBottom: "0.75rem" }} />
            <h3>Compute Signals</h3>
            <p>
              Processors normalize observations into scores, recommendations,
              and packaged feeds that humans and AI agents can query.
            </p>
            <div className="code-snippet" style={{ fontSize: "0.85rem" }}>
              vendor_api_risk, api_sla, regulatory_change, market_signal
            </div>
          </div>

          {/* Step 3 */}
          <div className="step-card">
            <span className="step-num">3</span>
            <Fingerprint size={28} style={{ color: "var(--success)", marginBottom: "0.75rem" }} />
            <h3>Gate Access</h3>
            <p>
              Public profiles stay open. Historical trends, batch checks, and
              premium feeds can use JWT subscriptions or x402 receipts.
            </p>
            <pre className="schema-block" style={{ fontSize: "0.75rem", margin: "0.5rem 0 0 0", textAlign: "left", opacity: 0.9 }}>
{`{
  "entity_key": "stripe.com",
  "entity_type": "vendor",
  "domain": "stripe.com",
  "endpoint_url": "https://api.stripe.com"
}`}
            </pre>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="footer">
        <p>
          Built by{" "}
          <a href="https://miraland.io" target="_blank" rel="noopener noreferrer">
            Miraland Labs
          </a>{" "}
          · Powered by{" "}
          <a href="https://pr402.org" target="_blank" rel="noopener noreferrer">
            pr402
          </a>{" "}
          &amp;{" "}
          <a href="https://ipay.sh" target="_blank" rel="noopener noreferrer">
            ipay.sh
          </a>
        </p>
        <p style={{ marginTop: "0.5rem", opacity: 0.6 }}>
          Open source · Continuous Intelligence · HTTP 402 · MCP-ready feeds
        </p>
      </footer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Entity Card Component
// ═══════════════════════════════════════════════════════════════
function EntityCard({ entity }: { entity: EntityResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="agent-card">
      <div className="card-header">
        <h3 className="ans-title">
          <Globe size={22} style={{ color: "var(--accent-cyan)" }} />
          {entity.display_name ?? entity.entity_key}
        </h3>
        {entity.is_verified && (
          <span className="badge badge-verified">
            <ShieldCheck size={14} /> Verified
          </span>
        )}
      </div>

      <div className="endpoint-info">
        <ExternalLink size={14} />
        {entity.endpoint_url ? (
          <a href={entity.endpoint_url} target="_blank" rel="noopener noreferrer">
            {entity.endpoint_url}
          </a>
        ) : (
          <span>{entity.domain ?? entity.entity_key}</span>
        )}
      </div>

      <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
        {entity.entity_type} · {entity.entity_key}
      </div>

      {(entity.signals?.length ?? 0) > 0 && (
        <div className="tools-section">
          <div className="tools-toggle" onClick={() => setExpanded(!expanded)}>
            <span>{entity.signals?.length} Signal{entity.signals?.length !== 1 ? "s" : ""} Available</span>
            {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>

          {expanded && (
            <div className="tools-list">
              {entity.signals?.map((signal) => (
                <div key={signal.signal_key} className="tool-item">
                  <div className="tool-name">{signal.signal_key}</div>
                  <div className="tool-description">
                    {signal.recommendation ?? signal.signal_type}
                    {typeof signal.score === "number" ? ` · score ${signal.score}` : ""}
                  </div>
                  {signal.payload && (
                    <pre className="schema-block">
                      {JSON.stringify(signal.payload, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
