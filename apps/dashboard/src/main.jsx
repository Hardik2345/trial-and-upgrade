import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  CalendarDays,
  Download,
  KeyRound,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Store,
  Trash2,
  Users
} from "lucide-react";
import { io } from "socket.io-client";
import { apiFetch, downloadCsv, getAccessToken, login, logout, setAccessToken } from "./lib/api";
import "./styles/app.css";

const eventTabs = [
  { key: "entered", label: "Entered", totalLabel: "Total Entered" },
  { key: "otp_sent", label: "OTP Sent", totalLabel: "Total OTP Sent" },
  { key: "otp_verified", label: "Verified OTP", totalLabel: "Total Verified OTP" },
  { key: "played", label: "Spun Wheel", totalLabel: "Total Spun Wheel" },
  { key: "funnel", label: "Funnel" }
];

function today(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function slugify(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function parseTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatTags(tags) {
  return (tags || []).join(", ");
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const result = await login(email, password);
      onLoggedIn(result.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-mark">SW</div>
        <h1>Admin Login</h1>
        <Field label="Email"><input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required /></Field>
        <Field label="Password"><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required /></Field>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit">Login</button>
      </form>
    </main>
  );
}

function Dashboard({ user, onLogout }) {
  const [view, setView] = useState("analytics");
  const [stores, setStores] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [users, setUsers] = useState([]);
  const [storeId, setStoreId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function loadStores(nextStoreId) {
    const data = await apiFetch("/api/admin/stores");
    const nextStores = data.stores || [];
    setStores(nextStores);
    const preferred = nextStoreId || (storeId && nextStores.some((store) => store._id === storeId) ? storeId : nextStores[0]?._id || "");
    setStoreId(preferred);
    return preferred;
  }

  async function loadCampaigns(nextStoreId = storeId, nextCampaignId) {
    if (!nextStoreId) {
      setCampaigns([]);
      setCampaignId("");
      return "";
    }
    const data = await apiFetch(`/api/admin/campaigns?storeId=${nextStoreId}`);
    const nextCampaigns = data.campaigns || [];
    setCampaigns(nextCampaigns);
    const preferred = nextCampaignId || (campaignId && nextCampaigns.some((campaign) => campaign._id === campaignId) ? campaignId : nextCampaigns[0]?._id || "");
    setCampaignId(preferred);
    return preferred;
  }

  async function loadUsers(nextStoreId = storeId) {
    if (user.role !== "super_admin") return;
    const path = nextStoreId ? `/api/admin/users?storeId=${nextStoreId}` : "/api/admin/users";
    const data = await apiFetch(path);
    setUsers(data.users || []);
  }

  async function reloadAll(nextStoreId, nextCampaignId) {
    const resolvedStoreId = await loadStores(nextStoreId);
    await loadCampaigns(resolvedStoreId, nextCampaignId);
    await loadUsers(resolvedStoreId);
  }

  useEffect(() => {
    reloadAll().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    loadCampaigns().catch((err) => setError(err.message));
    loadUsers().catch((err) => setError(err.message));
  }, [storeId]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function handleLogout() {
    await logout();
    onLogout();
  }

  function showNotice(message) {
    setNotice(message);
    setError("");
  }

  const selectedStore = stores.find((store) => store._id === storeId);
  const selectedCampaign = campaigns.find((campaign) => campaign._id === campaignId);

  return (
    <main className="app-frame">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">SW</div>
          <div>
            <strong>Spin Campaigns</strong>
            <span>{user.role === "super_admin" ? "Super admin" : "Store admin"}</span>
          </div>
        </div>
        <nav>
          <button className={view === "analytics" ? "active" : ""} onClick={() => setView("analytics")}><Activity size={18} /> Analytics</button>
          {user.role === "super_admin" ? <button className={view === "stores" ? "active" : ""} onClick={() => setView("stores")}><Store size={18} /> Stores</button> : null}
        </nav>
        <button className="logout-button" onClick={handleLogout}><LogOut size={18} /> Logout</button>
      </aside>

      <section className="workspace">
        <header className="page-header">
          <div>
            <p>{view === "stores" ? "Tenant operations" : "Campaign analytics"}</p>
            <h1>{view === "stores" ? "Store Management" : "Admin Funnel Dashboard"}</h1>
          </div>
          <div className="header-meta">
            <span>{selectedStore?.name || "No store selected"}</span>
            <strong>{selectedCampaign?.name || "No campaign selected"}</strong>
          </div>
        </header>

        {notice ? <div className="notice toast" role="status">{notice}</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}

        {view === "stores" && user.role === "super_admin" ? (
          <StoresView
            stores={stores}
            campaigns={campaigns}
            users={users}
            storeId={storeId}
            setStoreId={setStoreId}
            reloadAll={reloadAll}
            loadCampaigns={loadCampaigns}
            loadUsers={loadUsers}
            showNotice={showNotice}
            setError={setError}
          />
        ) : (
          <AnalyticsView
            user={user}
            stores={stores}
            campaigns={campaigns}
            storeId={storeId}
            campaignId={campaignId}
            setStoreId={setStoreId}
            setCampaignId={setCampaignId}
            setError={setError}
          />
        )}
      </section>
    </main>
  );
}

function AnalyticsView({ user, stores, campaigns, storeId, campaignId, setStoreId, setCampaignId, setError }) {
  const [startDate, setStartDate] = useState(today(-7));
  const [endDate, setEndDate] = useState(today());
  const [mobile, setMobile] = useState("");
  const [activeTab, setActiveTab] = useState("funnel");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [pagination, setPagination] = useState(null);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [loading, setLoading] = useState(false);

  const selectedCampaign = campaigns.find((campaign) => campaign._id === campaignId);
  const playTab = selectedCampaign?.playEventLabel || "Spun Wheel";
  const tabs = eventTabs.map((tab) => (tab.key === "played" ? { ...tab, label: playTab, totalLabel: `Total ${playTab}` } : tab));
  const query = useMemo(() => {
    const params = new URLSearchParams({ storeId, campaignId, startDate, endDate });
    if (mobile) params.set("mobile", mobile);
    return params;
  }, [storeId, campaignId, startDate, endDate, mobile]);

  async function refresh() {
    if (!storeId || !campaignId) {
      setDashboardStats(null);
      setRows([]);
      setTotal(0);
      setPagination(null);
      return;
    }
    setLoading(true);
    try {
      const stats = await apiFetch(`/api/admin/dashboard-stats?${query.toString()}`);
      setDashboardStats(stats);
      if (activeTab !== "funnel") {
        const tabQuery = new URLSearchParams(query);
        tabQuery.set("eventType", activeTab);
        tabQuery.set("page", String(page));
        tabQuery.set("limit", String(limit));
        const data = await apiFetch(`/api/admin/funnel-stats?${tabQuery.toString()}`);
        const nextPagination = data.pagination || { total: data.total || 0, page: data.page || page, limit: data.limit || limit, totalPages: Math.max(1, Math.ceil((data.total || 0) / (data.limit || limit))) };
        setRows(data.rows || []);
        setTotal(data.total || 0);
        setPagination(nextPagination);
        if (page > nextPagination.totalPages) setPage(nextPagination.totalPages);
      } else {
        setRows([]);
        setTotal(0);
        setPagination(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [query, activeTab, page, limit]);

  useEffect(() => {
    setPage(1);
  }, [query, activeTab, limit]);

  useEffect(() => {
    if (!storeId || !campaignId || !getAccessToken()) return;
    const socket = io(import.meta.env.VITE_API_BASE_URL || "http://localhost:4000", {
      auth: { token: getAccessToken(), storeIds: [storeId] }
    });
    socket.on("funnelEventUpdate", (event) => {
      if (event.storeId === storeId && event.campaignId === campaignId) refresh();
    });
    return () => socket.disconnect();
  }, [storeId, campaignId, query, activeTab]);

  function exportCsv() {
    if (activeTab === "funnel" || !campaignId) return;
    const exportQuery = new URLSearchParams(query);
    exportQuery.set("eventType", activeTab);
    downloadCsv(`/api/admin/funnel-export?${exportQuery.toString()}`, `${activeTab}-funnel.csv`).catch((err) => setError(err.message));
  }

  const counts = dashboardStats?.counts || {};

  return (
    <>
      <section className="control-panel">
        <div className="selector-grid">
          {user.role === "super_admin" ? (
            <Field label="Store">
              <select value={storeId} onChange={(event) => setStoreId(event.target.value)}>
                <option value="">Select store</option>
                {stores.map((store) => <option key={store._id} value={store._id}>{store.name}</option>)}
              </select>
            </Field>
          ) : null}
          <Field label="Campaign">
            <select value={campaignId} onChange={(event) => setCampaignId(event.target.value)} disabled={!campaigns.length}>
              <option value="">{campaigns.length ? "Select campaign" : "No campaign yet"}</option>
              {campaigns.map((campaign) => <option key={campaign._id} value={campaign._id}>{campaign.name}</option>)}
            </select>
          </Field>
          <DateField label="Start Date" value={startDate} onChange={setStartDate} />
          <DateField label="End Date" value={endDate} onChange={setEndDate} />
          <Field label="Search Mobile" className="search-field">
            <span className="input-icon"><Search size={18} /><input value={mobile} onChange={(event) => setMobile(event.target.value)} placeholder="Enter mobile number" /></span>
          </Field>
        </div>
        <div className="action-row">
          <button className="primary-button" onClick={refresh} disabled={loading || !campaignId}><RefreshCw size={18} /> Refresh</button>
          <button className="export-button" onClick={exportCsv} disabled={activeTab === "funnel" || !campaignId}><Download size={18} /> Export CSV</button>
        </div>
      </section>

      <section className="metric-strip">
        <Metric label="Entered" value={counts.entered || 0} tone="blue" />
        <Metric label="OTP Sent" value={counts.otp_sent || 0} tone="indigo" />
        <Metric label="OTP Verified" value={counts.otp_verified || 0} tone="violet" />
        <Metric label={playTab} value={counts.played || 0} tone="green" />
      </section>

      <div className="tabs">
        {tabs.map((tab) => <button key={tab.key} className={activeTab === tab.key ? "active" : ""} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>)}
      </div>

      {!stores.length ? (
        <EmptyState title="Create your first store" text="Open Stores to add a Shopify tenant before viewing funnel data." />
      ) : !campaigns.length ? (
        <EmptyState title="Create your first campaign" text="Open Stores to add a spin-the-wheel campaign for this store." />
      ) : activeTab === "funnel" ? (
        <FunnelView stats={dashboardStats} playLabel={playTab} />
      ) : (
        <TableView
          total={total}
          rows={rows}
          tab={tabs.find((tab) => tab.key === activeTab)}
          pagination={pagination}
          limit={limit}
          setLimit={setLimit}
          setPage={setPage}
          loading={loading}
        />
      )}
    </>
  );
}

function StoresView({ stores, campaigns, users, storeId, setStoreId, reloadAll, loadCampaigns, loadUsers, showNotice, setError }) {
  const [activeDetailTab, setActiveDetailTab] = useState("settings");
  const selectedStore = stores.find((store) => store._id === storeId);

  return (
    <div className="management-grid">
      <section className="store-list-panel">
        <div className="panel-title split">
          <h2>Stores</h2>
          <span>{stores.length} active</span>
        </div>
        <StoreCreatePanel onCreated={(store) => reloadAll(store._id).then(() => showNotice(`Store created: ${store.name}`)).catch((err) => setError(err.message))} />
        <div className="store-list">
          {stores.map((store) => (
            <button key={store._id} className={store._id === storeId ? "store-row active" : "store-row"} onClick={() => setStoreId(store._id)}>
              <strong>{store.name}</strong>
              <span>{store.shopifyDomain}</span>
              <small>{store.campaignCount || 0} campaigns · {store.userCount || 0} users</small>
            </button>
          ))}
          {!stores.length ? <EmptyState title="No stores yet" text="Create a store to begin setup." /> : null}
        </div>
      </section>

      <section className="store-detail-panel">
        {selectedStore ? (
          <>
            <div className="store-detail-header">
              <div>
                <span className={selectedStore.enabled ? "status-pill active" : "status-pill"}>{selectedStore.enabled ? "Enabled" : "Disabled"}</span>
                <h2>{selectedStore.name}</h2>
                <p>{selectedStore.slug} · {selectedStore.shopifyDomain}</p>
              </div>
            </div>
            <div className="tabs sub-tabs">
              {["settings", "campaigns", "users", "danger"].map((tab) => (
                <button key={tab} className={activeDetailTab === tab ? "active" : ""} onClick={() => setActiveDetailTab(tab)}>
                  {tab === "danger" ? "Danger Zone" : tab[0].toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
            {activeDetailTab === "settings" ? <StoreSettings store={selectedStore} onSaved={() => reloadAll(selectedStore._id)} showNotice={showNotice} setError={setError} /> : null}
            {activeDetailTab === "campaigns" ? <CampaignManager store={selectedStore} campaigns={campaigns} loadCampaigns={loadCampaigns} showNotice={showNotice} setError={setError} /> : null}
            {activeDetailTab === "users" ? <UserManager store={selectedStore} stores={stores} users={users} loadUsers={loadUsers} showNotice={showNotice} setError={setError} /> : null}
            {activeDetailTab === "danger" ? <DangerZone store={selectedStore} reloadAll={reloadAll} showNotice={showNotice} setError={setError} /> : null}
          </>
        ) : (
          <EmptyState title="Select a store" text="Choose a store from the list or create a new one." />
        )}
      </section>
    </div>
  );
}

function StoreCreatePanel({ onCreated }) {
  const [form, setForm] = useState({ name: "", slug: "", shopifyDomain: "", shopifyAccessToken: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value, ...(field === "name" && !current.slug ? { slug: slugify(value) } : {}) }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { store } = await apiFetch("/api/admin/stores", {
        method: "POST",
        body: JSON.stringify({ ...form, slug: form.slug || slugify(form.name) })
      });
      setForm({ name: "", slug: "", shopifyDomain: "", shopifyAccessToken: "" });
      onCreated(store);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <Field label="Store Name"><input value={form.name} onChange={(event) => update("name", event.target.value)} required /></Field>
      <Field label="Store Slug"><input value={form.slug} onChange={(event) => update("slug", slugify(event.target.value))} required /></Field>
      <Field label="Shopify Domain"><input value={form.shopifyDomain} onChange={(event) => update("shopifyDomain", event.target.value)} placeholder="store.myshopify.com" required /></Field>
      <Field label="Admin Token"><input value={form.shopifyAccessToken} onChange={(event) => update("shopifyAccessToken", event.target.value)} type="password" /></Field>
      {error ? <p className="error">{error}</p> : null}
      <button className="mini-button" disabled={saving}><Plus size={16} /> Create Store</button>
    </form>
  );
}

function StoreSettings({ store, onSaved, showNotice, setError }) {
  const [base, setBase] = useState({});
  const [shopify, setShopify] = useState({});
  const [sms, setSms] = useState({});
  const [flits, setFlits] = useState({});

  useEffect(() => {
    setBase({ name: store.name, slug: store.slug, enabled: store.enabled, game_enabled: store.game_enabled !== false });
    setShopify({ shopifyDomain: store.shopifyDomain, shopifyAccessToken: "" });
    setSms({ ...(store.smsConfig || {}), password: "" });
    setFlits({
      customActionUrl: store.flitsConfig?.customActionUrl || "",
      apiKey: "",
      creditLookupUrl: store.flitsConfig?.creditLookupUrl || "",
      creditLookupUserId: store.flitsConfig?.creditLookupUserId || "",
      integrationAppName: store.flitsConfig?.integrationAppName || "",
      flitsEligibleTags: formatTags(store.flitsConfig?.flitsEligibleTags || []),
      creditLookupToken: ""
    });
  }, [store?._id]);

  async function patch(payload, label) {
    try {
      await apiFetch(`/api/admin/stores/${store._id}`, { method: "PATCH", body: JSON.stringify(payload) });
      showNotice(`${label} saved`);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="settings-stack">
      <section className="settings-card">
        <h3><Settings size={18} /> General</h3>
        <div className="compact-grid">
          <Field label="Store Name"><input value={base.name || ""} onChange={(event) => setBase({ ...base, name: event.target.value })} /></Field>
          <Field label="Store Slug"><input value={base.slug || ""} onChange={(event) => setBase({ ...base, slug: slugify(event.target.value) })} /></Field>
          <label className="checkbox-field"><input type="checkbox" checked={Boolean(base.enabled)} onChange={(event) => setBase({ ...base, enabled: event.target.checked })} /> Enabled</label>
          <label className="checkbox-field"><input type="checkbox" checked={Boolean(base.game_enabled)} onChange={(event) => setBase({ ...base, game_enabled: event.target.checked })} /> Game enabled</label>
        </div>
        <button className="mini-button" onClick={() => patch(base, "General settings")}>Save General</button>
      </section>
      <section className="settings-card">
        <h3><KeyRound size={18} /> Shopify</h3>
        <div className="compact-grid">
          <Field label="Shopify Domain"><input value={shopify.shopifyDomain || ""} onChange={(event) => setShopify({ ...shopify, shopifyDomain: event.target.value })} /></Field>
          <Field label="Admin Token"><input value={shopify.shopifyAccessToken || ""} onChange={(event) => setShopify({ ...shopify, shopifyAccessToken: event.target.value })} type="password" placeholder={store.secrets?.shopifyAccessToken ? "Saved - hidden" : ""} /></Field>
        </div>
        <button className="mini-button" onClick={() => patch(shopify, "Shopify settings")}>Save Shopify</button>
      </section>
      <section className="settings-card">
        <h3><Shield size={18} /> SMS</h3>
        <div className="compact-grid">
          <Field label="User"><input value={sms.user || ""} onChange={(event) => setSms({ ...sms, user: event.target.value })} /></Field>
          <Field label="Password"><input value={sms.password || ""} onChange={(event) => setSms({ ...sms, password: event.target.value })} type="password" placeholder={store.secrets?.smsPassword ? "Saved - hidden" : ""} /></Field>
          <Field label="Sender ID"><input value={sms.senderId || ""} onChange={(event) => setSms({ ...sms, senderId: event.target.value })} /></Field>
          <Field label="Route"><input value={sms.route || ""} onChange={(event) => setSms({ ...sms, route: event.target.value })} /></Field>
          <Field label="DLT Template ID"><input value={sms.dltTemplateId || ""} onChange={(event) => setSms({ ...sms, dltTemplateId: event.target.value })} /></Field>
          <Field label="PEID"><input value={sms.peid || ""} onChange={(event) => setSms({ ...sms, peid: event.target.value })} /></Field>
          <Field label="Message Template">
            <textarea
              rows={3}
              value={sms.messageTemplate || ""}
              onChange={(event) => setSms({ ...sms, messageTemplate: event.target.value })}
            />
          </Field>
        </div>
        <button className="mini-button" onClick={() => patch({ smsConfig: sms }, "SMS settings")}>Save SMS</button>
      </section>
      <section className="settings-card">
        <h3><KeyRound size={18} /> Flits</h3>
        <div className="compact-grid">
          <Field label="Custom Action URL"><input value={flits.customActionUrl || ""} onChange={(event) => setFlits({ ...flits, customActionUrl: event.target.value })} /></Field>
          <Field label="API Key"><input value={flits.apiKey || ""} onChange={(event) => setFlits({ ...flits, apiKey: event.target.value })} type="password" placeholder={store.secrets?.flitsApiKey ? "Saved - hidden" : ""} /></Field>
          <Field label="Credit Lookup URL"><input value={flits.creditLookupUrl || ""} onChange={(event) => setFlits({ ...flits, creditLookupUrl: event.target.value })} /></Field>
          <Field label="Integration App Name"><input value={flits.integrationAppName || ""} onChange={(event) => setFlits({ ...flits, integrationAppName: event.target.value })} /></Field>
          <Field label="User ID"><input value={flits.creditLookupUserId || ""} onChange={(event) => setFlits({ ...flits, creditLookupUserId: event.target.value })} /></Field>
          <Field label="Flits Eligible Tags"><input value={flits.flitsEligibleTags || ""} onChange={(event) => setFlits({ ...flits, flitsEligibleTags: event.target.value })} placeholder="gold, flits-user" /></Field>
          <Field label="Token"><input value={flits.creditLookupToken || ""} onChange={(event) => setFlits({ ...flits, creditLookupToken: event.target.value })} type="password" placeholder={store.secrets?.flitsCreditToken ? "Saved - hidden" : ""} /></Field>
        </div>
        <button className="mini-button" onClick={() => patch({ flitsConfig: { ...flits, flitsEligibleTags: parseTags(flits.flitsEligibleTags) } }, "Flits settings")}>Save Flits</button>
      </section>
    </div>
  );
}

function CampaignManager({ store, campaigns, loadCampaigns, showNotice, setError }) {
  return (
    <div className="settings-stack">
      <CampaignCreatePanel storeId={store._id} onCreated={(campaign) => loadCampaigns(store._id, campaign._id).then(() => showNotice(`Campaign created: ${campaign.name}`)).catch((err) => setError(err.message))} />
      <section className="settings-card">
        <h3><Activity size={18} /> Campaign Rules</h3>
        <div className="campaign-list">
          {campaigns.map((campaign) => (
            <CampaignRuleEditor
              key={campaign._id}
              campaign={campaign}
              onSaved={() => loadCampaigns(store._id, campaign._id).then(() => showNotice("Campaign rules saved")).catch((err) => setError(err.message))}
              onDeleted={() => apiFetch(`/api/admin/campaigns/${campaign._id}`, { method: "DELETE" }).then(() => loadCampaigns(store._id)).then(() => showNotice("Campaign deleted")).catch((err) => setError(err.message))}
            />
          ))}
          {campaigns.length ? null : <p className="muted-text">No campaigns yet.</p>}
        </div>
      </section>
    </div>
  );
}

function CampaignCreatePanel({ storeId, onCreated }) {
  const [form, setForm] = useState({ name: "", slug: "", playEventLabel: "Spun Wheel", rewardValue: "399", eligibilityTags: "played" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value, ...(field === "name" && !current.slug ? { slug: slugify(value) } : {}) }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const rewardValue = Number(form.rewardValue || 0);
    try {
      const { campaign } = await apiFetch("/api/admin/campaigns", {
        method: "POST",
        body: JSON.stringify({
          tenantStoreId: storeId,
          name: form.name,
          slug: form.slug || slugify(form.name),
          mechanicType: "spin_the_wheel",
          playEventLabel: form.playEventLabel,
          rewards: [{ key: `wallet_${rewardValue}`, label: `Wallet Credit ${rewardValue}`, value: rewardValue, weight: 1 }],
          eligibilityTags: parseTags(form.eligibilityTags),
          postPlayTags: ["played"],
          flitsCredit: { enabled: true, value: rewardValue, commentText: `Rewarding the user ${rewardValue} in wallet` }
        })
      });
      setForm({ name: "", slug: "", playEventLabel: "Spun Wheel", rewardValue: "399", eligibilityTags: "played" });
      onCreated(campaign);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="settings-card" onSubmit={submit}>
      <h3><Activity size={18} /> Create Campaign</h3>
      <div className="compact-grid">
        <Field label="Campaign Name"><input value={form.name} onChange={(event) => update("name", event.target.value)} required /></Field>
        <Field label="Campaign Slug"><input value={form.slug} onChange={(event) => update("slug", slugify(event.target.value))} required /></Field>
        <Field label="Play Label"><input value={form.playEventLabel} onChange={(event) => update("playEventLabel", event.target.value)} required /></Field>
        <Field label="Wallet Value"><input value={form.rewardValue} onChange={(event) => update("rewardValue", event.target.value)} type="number" min="0" required /></Field>
        <Field label="Eligibility Tags"><input value={form.eligibilityTags} onChange={(event) => update("eligibilityTags", event.target.value)} placeholder="played, credited" /></Field>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <button className="mini-button" disabled={saving}><Plus size={16} /> Create Campaign</button>
    </form>
  );
}

function campaignWalletValue(campaign) {
  return String(campaign.rewards?.[0]?.value ?? campaign.flitsCredit?.value ?? 399);
}

function campaignWalletComment(campaign, rewardValue) {
  const existingComment = campaign.flitsCredit?.commentText || "";
  if (!existingComment || /^Rewarding the user \d+ in wallet$/.test(existingComment)) {
    return `Rewarding the user ${rewardValue} in wallet`;
  }
  return existingComment;
}

function CampaignRuleEditor({ campaign, onSaved, onDeleted }) {
  const [eligibilityTags, setEligibilityTags] = useState(formatTags(campaign.eligibilityTags));
  const [walletValue, setWalletValue] = useState(campaignWalletValue(campaign));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setEligibilityTags(formatTags(campaign.eligibilityTags));
    setWalletValue(campaignWalletValue(campaign));
    setError("");
  }, [campaign._id, campaign.eligibilityTags, campaign.rewards, campaign.flitsCredit]);

  async function save() {
    setSaving(true);
    setError("");
    const rewardValue = Number(walletValue || 0);
    try {
      await apiFetch(`/api/admin/campaigns/${campaign._id}`, {
        method: "PATCH",
        body: JSON.stringify({
          eligibilityTags: parseTags(eligibilityTags),
          rewards: [{ key: `wallet_${rewardValue}`, label: `Wallet Credit ${rewardValue}`, value: rewardValue, weight: 1 }],
          flitsCredit: {
            ...(campaign.flitsCredit || {}),
            enabled: campaign.flitsCredit?.enabled !== false,
            value: rewardValue,
            commentText: campaignWalletComment(campaign, rewardValue)
          }
        })
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="campaign-rule">
      <div className="campaign-rule-title">
        <div>
          <strong>{campaign.name}</strong>
          <span>{campaign.slug} · {campaign.enabled ? "Enabled" : "Disabled"}</span>
        </div>
        <button className="ghost-danger" onClick={onDeleted}>Delete</button>
      </div>
      <Field label="Wallet Value">
        <input value={walletValue} onChange={(event) => setWalletValue(event.target.value)} type="number" min="0" required />
      </Field>
      <Field label="Eligibility Tags">
        <input value={eligibilityTags} onChange={(event) => setEligibilityTags(event.target.value)} placeholder="played, credited" />
      </Field>
      <div className="campaign-rule-actions">
        <button className="mini-button" onClick={save} disabled={saving}>Save Rules</button>
        <span>Wallet {Number(walletValue || 0)} · {parseTags(eligibilityTags).length} tags</span>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </article>
  );
}

function UserManager({ store, stores, users, loadUsers, showNotice, setError }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", tenantStoreIds: [store._id] });
  useEffect(() => setForm((current) => ({ ...current, tenantStoreIds: [store._id] })), [store._id]);

  async function submit(event) {
    event.preventDefault();
    try {
      const { user } = await apiFetch("/api/admin/users", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", email: "", password: "", tenantStoreIds: [store._id] });
      await loadUsers(store._id);
      showNotice(`User created: ${user.email}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="settings-stack">
      <form className="settings-card" onSubmit={submit}>
        <h3><Users size={18} /> Create Store Admin</h3>
        <div className="compact-grid">
          <Field label="Name"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></Field>
          <Field label="Email"><input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} type="email" required /></Field>
          <Field label="Temporary Password"><input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} type="password" required /></Field>
          <Field label="Assigned Store"><select value={form.tenantStoreIds[0] || ""} onChange={(event) => setForm({ ...form, tenantStoreIds: [event.target.value] })}>{stores.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></Field>
        </div>
        <button className="mini-button"><Plus size={16} /> Create User</button>
      </form>
      <DataList
        headers={["Name", "Email", "Status", "Action"]}
        rows={users.map((item) => [
          item.name,
          item.email,
          item.active ? "Active" : "Inactive",
          <button className="ghost-danger" disabled={!item.active} onClick={() => apiFetch(`/api/admin/users/${item._id}/deactivate`, { method: "POST" }).then(() => loadUsers(store._id)).then(() => showNotice("User deactivated")).catch((err) => setError(err.message))}>Deactivate</button>
        ])}
      />
    </div>
  );
}

function DangerZone({ store, reloadAll, showNotice, setError }) {
  const [confirm, setConfirm] = useState("");
  async function deleteStore() {
    if (confirm !== store.slug) return;
    try {
      await apiFetch(`/api/admin/stores/${store._id}`, { method: "DELETE" });
      setConfirm("");
      await reloadAll();
      showNotice(`Store deleted: ${store.name}`);
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <section className="danger-card">
      <h3><Trash2 size={18} /> Delete Store</h3>
      <p>This disables the store, hides all campaigns, removes store-admin assignments, and keeps historical funnel data for audit.</p>
      <Field label={`Type "${store.slug}" to confirm`}><input value={confirm} onChange={(event) => setConfirm(event.target.value)} /></Field>
      <button className="danger-button" disabled={confirm !== store.slug} onClick={deleteStore}><Trash2 size={16} /> Delete Store</button>
    </section>
  );
}

function DataList({ headers, rows }) {
  return (
    <div className="data-panel">
      <div className="table-wrap">
        <table>
          <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}
            {!rows.length ? <tr><td className="empty" colSpan={headers.length}>No records found</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children, className = "" }) {
  return <label className={className}>{label}{children}</label>;
}

function DateField({ label, value, onChange }) {
  return (
    <Field label={label} className="date-field">
      <span>
        <input type="date" value={value} onChange={(event) => onChange(event.target.value)} />
        <CalendarDays size={18} />
      </span>
    </Field>
  );
}

function Metric({ label, value, tone }) {
  return <article className={`metric metric-${tone}`}><span>{label}</span><strong>{value}</strong></article>;
}

function TableView({ total, rows, tab, pagination, limit, setLimit, setPage, loading }) {
  const page = pagination?.page || 1;
  const totalPages = pagination?.totalPages || 1;
  const start = total ? ((page - 1) * limit) + 1 : 0;
  const end = total ? Math.min(total, start + rows.length - 1) : 0;

  return (
    <section className="data-panel">
      <div className="panel-title"><h2>{tab?.totalLabel}: {total}</h2></div>
      <DataList headers={["#", "Name", "Mobile", "Timestamp"]} rows={rows.map((row) => [row.index, row.name, row.mobile, formatDateTime(row.timestamp)])} />
      <div className="pagination-bar">
        <span>{total ? `${start}-${end} of ${total}` : "0 records"}</span>
        <label>
          Rows
          <select value={limit} onChange={(event) => setLimit(Number(event.target.value))} disabled={loading}>
            {[10, 25, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <div className="pagination-actions">
          <button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={loading || page <= 1}>Previous</button>
          <strong>Page {page} of {totalPages}</strong>
          <button onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={loading || page >= totalPages}>Next</button>
        </div>
      </div>
    </section>
  );
}

function FunnelView({ stats, playLabel }) {
  const counts = stats?.counts || {};
  const stages = [["Entered", counts.entered || 0], ["OTP Sent", counts.otp_sent || 0], ["OTP Verified", counts.otp_verified || 0], [playLabel, counts.played || 0]];
  const max = Math.max(...stages.map((stage) => stage[1]), 1);
  const rates = stats?.conversionRates || {};
  return (
    <section className="funnel-section">
      <div className="conversion-panel">
        <h2>Conversion Rates</h2>
        <div>
          <Rate label="Entered -> OTP Sent" value={rates.enteredToOtpSent} />
          <Rate label="OTP Sent -> OTP Verified" value={rates.otpSentToOtpVerified} />
          <Rate label={`OTP Verified -> ${playLabel}`} value={rates.otpVerifiedToPlayed} />
        </div>
      </div>
      <div className="chart-panel">
        <h2>Funnel Analytics</h2>
        <div className="bar-chart">
          {stages.map(([label, count], index) => (
            <div className="bar-group" key={label}>
              <div className={`bar bar-${index}`} style={{ height: `${Math.max(8, (count / max) * 280)}px` }} />
              <span>{label}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Rate({ label, value = 0 }) {
  return <div className="rate"><span>{label}</span><strong>{value.toFixed(1)}%</strong></div>;
}

function EmptyState({ title, text }) {
  return <section className="empty-state"><h2>{title}</h2><p>{text}</p></section>;
}

function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    apiFetch("/api/auth/refresh", { method: "POST" })
      .then((data) => {
        setAccessToken(data.accessToken);
        setUser(data.user);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  if (!ready) return <div className="loading">Loading...</div>;
  if (!user) return <LoginScreen onLoggedIn={setUser} />;
  return <Dashboard user={user} onLogout={() => setUser(null)} />;
}

createRoot(document.getElementById("root")).render(<App />);
