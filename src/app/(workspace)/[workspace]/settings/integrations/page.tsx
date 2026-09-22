import { requireWorkspace } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/database/supabase";
import type { ProviderType } from "@/server/providers/contracts";

interface IntegrationSlot {
  key: ProviderType;
  title: string;
  channel: string;
  description: string;
  icon: string;
}

const INTEGRATION_SLOTS: IntegrationSlot[] = [
  {
    key: "resend",
    title: "Email (Resend)",
    channel: "Email",
    description: "Transactional messaging and broadcast campaigns over dedicated sending domains.",
    icon: "✉️",
  },
  {
    key: "twilio",
    title: "SMS (Twilio)",
    channel: "SMS",
    description: "Two-way text messaging with opt-out keyword detection and delivery receipts.",
    icon: "💬",
  },
  {
    key: "whatsapp",
    title: "WhatsApp Cloud",
    channel: "WhatsApp",
    description: "Direct customer messaging within verified 24-hour customer care windows.",
    icon: "📱",
  },
  {
    key: "calendly",
    title: "Calendly",
    channel: "Meetings",
    description: "Meeting booking ingestion, invitee matching, and attendance reconciliation.",
    icon: "📅",
  },
  {
    key: "meta",
    title: "Meta Lead Ads & CAPI",
    channel: "Attribution",
    description: "Instant forms lead intake with cryptographic verification and ad attribution.",
    icon: "📊",
  },
  {
    key: "vsl",
    title: "VSL Analytics",
    channel: "Telemetry",
    description: "Client-side video playback tracking, engagement intervals, and milestone events.",
    icon: "🎥",
  },
  {
    key: "outbound",
    title: "80/20 Outbound",
    channel: "Automation",
    description: "Dedicated external outbound prospecting engine integration and synchronization.",
    icon: "⚡",
  },
];

export default async function IntegrationsSettingsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  await requireWorkspace(workspace);

  const client = await createSupabaseServerClient();
  const res = await client.rpc("list_provider_connections", { p_workspace_id: workspace });
  const rawConnections = (res.data || []) as Array<{
    id: string;
    provider: ProviderType;
    external_account_id: string;
    connection_state: string;
    health_status: string;
  }>;

  const connectionMap = new Map<string, { externalAccountId: string; connectionState: string }>();
  for (const conn of rawConnections) {
    connectionMap.set(conn.provider, {
      externalAccountId: conn.external_account_id,
      connectionState: conn.connection_state,
    });
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Integrations & Provider Connections</h1>
          <p className="text-sm text-slate-500 mt-1">
            Provider-neutral infrastructure foundation. External provider credentials and adapters are not connected.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider bg-emerald-50 text-emerald-800 px-3 py-1.5 rounded-md border border-emerald-200">
            Phase 6B Resend Email
          </span>
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700">
        <p className="font-medium text-slate-900">Email Provider Integration (Resend)</p>
        <p className="text-xs text-slate-600 mt-1">
          Resend email provider adapter, cryptographic Svix webhook verification, monotonic delivery reconciliation, and bounce/complaint suppressions are enabled.
          No provider secrets or credentials are ever displayed or exposed in UI surfaces.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {INTEGRATION_SLOTS.map((slot) => {
          const conn = connectionMap.get(slot.key);
          const state = conn ? conn.connectionState : "not_configured";
          const isNotConfigured = state === "not_configured";

          return (
            <div
              key={slot.key}
              className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <span className="text-3xl p-2 bg-slate-50 rounded-lg border border-slate-100">{slot.icon}</span>
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                      isNotConfigured
                        ? "bg-slate-100 text-slate-700 border-slate-200"
                        : state === "active"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    {isNotConfigured ? "Not configured" : state.replace("_", " ")}
                  </span>
                </div>
                <h2 className="text-base font-semibold text-slate-900">{slot.title}</h2>
                <p className="text-xs font-medium text-slate-400 mt-0.5">{slot.channel}</p>
                <p className="text-xs text-slate-600 mt-2.5 leading-relaxed">{slot.description}</p>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  {conn ? `ID: ${conn.externalAccountId}` : "Awaiting integration"}
                </span>
                <button
                  type="button"
                  disabled
                  className="text-xs font-medium text-slate-400 bg-slate-100 px-3 py-1.5 rounded-md cursor-not-allowed"
                >
                  Configure
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
