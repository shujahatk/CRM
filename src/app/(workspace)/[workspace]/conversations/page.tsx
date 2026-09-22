import { requireWorkspace } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/database/supabase";
import { ConversationsInbox } from "./inbox-client";
import type {
  ConversationSummary,
  InboundMessageReview,
  MessageTemplate,
} from "@/modules/conversations/types";

export default async function ConversationsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  await requireWorkspace(workspace);

  const client = await createSupabaseServerClient();

  const [convRes, reviewsRes, templatesRes, leadsRes] = await Promise.all([
    client.rpc("list_conversations", { p_workspace: workspace }),
    client.rpc("list_inbound_reviews", { p_workspace: workspace }),
    client.rpc("list_message_templates", { p_workspace: workspace }),
    client.rpc("list_leads", { p_workspace: workspace, p_limit: 100 }),
  ]);

  const conversations: ConversationSummary[] = convRes.data || [];
  const reviews: InboundMessageReview[] = reviewsRes.data || [];
  const templates: MessageTemplate[] = templatesRes.data || [];
  const leads: Array<{ id: string; display_name: string }> = leadsRes.data || [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Conversations & Omnichannel Inbox</h1>
          <p className="text-xs text-slate-500 mt-1">
            Deterministic threading across Email, SMS, and WhatsApp with internal providerless lifecycle.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-indigo-50 text-indigo-700 font-medium px-2.5 py-1 rounded-full border border-indigo-200">
            Phase 5 Internal Core
          </span>
          {reviews.length > 0 && (
            <span className="text-xs bg-amber-50 text-amber-800 font-medium px-2.5 py-1 rounded-full border border-amber-200 animate-pulse">
              {reviews.length} Inbound Review{reviews.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      <ConversationsInbox
        workspace={workspace}
        initialConversations={conversations}
        initialReviews={reviews}
        templates={templates}
        leads={leads}
      />
    </div>
  );
}
