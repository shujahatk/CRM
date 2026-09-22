"use client";

import { useState } from "react";
import {
  Send,
  AlertTriangle,
  Search,
  User,
} from "lucide-react";
import type {
  ConversationSummary,
  InboundMessageReview,
  MessageDetail,
  MessageTemplate,
} from "@/modules/conversations/types";
import {
  getConversationMessages,
  sendOutboundMessage,
  resolveInboundReview,
} from "@/modules/conversations/commands";

interface InboxClientProps {
  workspace: string;
  initialConversations: ConversationSummary[];
  initialReviews: InboundMessageReview[];
  templates?: MessageTemplate[];
  leads: Array<{ id: string; display_name: string }>;
}

export function ConversationsInbox({
  workspace,
  initialConversations,
  initialReviews,
  leads,
}: InboxClientProps) {
  const [conversations] = useState<ConversationSummary[]>(initialConversations);
  const [reviews, setReviews] = useState<InboundMessageReview[]>(initialReviews);
  const [selectedChannel, setSelectedChannel] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedConvId, setSelectedConvId] = useState<string | null>(
    initialConversations[0]?.id || null
  );

  const [messages, setMessages] = useState<MessageDetail[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [composerBody, setComposerBody] = useState("");
  const [composerSubject, setComposerSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"inbox" | "reviews">("inbox");
  const [selectedLeadForReview, setSelectedLeadForReview] = useState<Record<string, string>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Load messages when conversation selected
  const selectConversation = async (convId: string) => {
    setSelectedConvId(convId);
    setLoadingMessages(true);
    setFeedback(null);
    const res = await getConversationMessages(workspace, convId);
    setLoadingMessages(false);
    if (res.messages) {
      setMessages(res.messages);
    }
  };

  const currentConv = conversations.find((c) => c.id === selectedConvId);

  const filteredConversations = conversations.filter((c) => {
    if (selectedChannel !== "all" && c.channel !== selectedChannel) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        c.lead_name.toLowerCase().includes(q) ||
        c.destination.toLowerCase().includes(q) ||
        (c.last_message_snippet && c.last_message_snippet.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentConv || !composerBody.trim()) return;

    setSending(true);
    setFeedback(null);

    const res = await sendOutboundMessage({
      workspace,
      leadId: currentConv.lead_id,
      channel: currentConv.channel,
      recipientAddress: currentConv.destination,
      subject: currentConv.channel === "email" ? composerSubject : null,
      textBody: composerBody,
    });

    setSending(false);

    if (res.error) {
      setFeedback(`Error: ${res.error}`);
    } else {
      setComposerBody("");
      setComposerSubject("");
      // Refresh messages
      selectConversation(currentConv.id);
    }
  };

  const handleResolveReview = async (reviewId: string) => {
    const leadId = selectedLeadForReview[reviewId];
    if (!leadId) return;

    setResolvingId(reviewId);
    const res = await resolveInboundReview({
      workspace,
      reviewId,
      leadId,
      resolutionNotes: "Resolved from Conversations Inbox review queue",
    });
    setResolvingId(null);

    if (res.message_id) {
      setReviews((prev) => prev.filter((r) => r.id !== reviewId));
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
      {/* Top Bar Tabs */}
      <div className="flex border-b border-slate-200 bg-slate-50/70 px-4 py-2 justify-between items-center">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("inbox")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === "inbox"
                ? "bg-white shadow-xs text-indigo-700 border border-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Inbox & Threads ({conversations.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("reviews")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
              activeTab === "reviews"
                ? "bg-white shadow-xs text-amber-800 border border-slate-200"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            Unresolved Inbound Reviews ({reviews.length})
          </button>
        </div>
      </div>

      {activeTab === "reviews" ? (
        <div className="p-6 space-y-4">
          <div className="max-w-xl">
            <h2 className="text-base font-bold text-slate-900">Inbound Identity Reviews</h2>
            <p className="text-xs text-slate-500 mt-1">
              Inbound messages that matched 0 leads or multiple conflicting identities. Preserve complete
              audit trails without losing incoming messages.
            </p>
          </div>

          {reviews.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400">
              No inbound messages currently require manual identity review.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {reviews.map((rev) => (
                <div key={rev.id} className="p-4 rounded-xl border border-amber-200 bg-amber-50/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                      {rev.resolution_reason}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {new Date(rev.occurred_at).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="text-xs space-y-1">
                    <p className="text-slate-700">
                      <strong>From:</strong> {rev.sender_address} ({rev.channel})
                    </p>
                    <p className="text-slate-700">
                      <strong>To:</strong> {rev.recipient_address}
                    </p>
                    {rev.subject && (
                      <p className="text-slate-800 font-medium">
                        <strong>Subject:</strong> {rev.subject}
                      </p>
                    )}
                    <p className="text-slate-600 italic bg-white/80 p-2 rounded border border-amber-100">
                      &ldquo;{rev.text_body}&rdquo;
                    </p>
                  </div>

                  <div className="pt-2 border-t border-amber-200/60 flex items-center gap-2">
                    <select
                      value={selectedLeadForReview[rev.id] || ""}
                      onChange={(e) =>
                        setSelectedLeadForReview({ ...selectedLeadForReview, [rev.id]: e.target.value })
                      }
                      className="text-xs px-2.5 py-1.5 border border-slate-300 rounded-lg flex-1 bg-white"
                    >
                      <option value="">Select Lead to Attach...</option>
                      {leads.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.display_name}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      disabled={!selectedLeadForReview[rev.id] || resolvingId === rev.id}
                      onClick={() => handleResolveReview(rev.id)}
                      className="px-3 py-1.5 bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition"
                    >
                      {resolvingId === rev.id ? "Resolving..." : "Resolve"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* 3-Pane Layout */
        <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] min-h-[680px]">
          {/* Left Pane: Thread List */}
          <div className="border-r border-slate-200 p-4 space-y-3">
            {/* Channel Filters */}
            <div className="flex gap-1">
              {["all", "email", "sms", "whatsapp"].map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setSelectedChannel(ch)}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold capitalize transition ${
                    selectedChannel === ch
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search leads or messages..."
                className="w-full text-xs pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>

            {/* List */}
            <div className="space-y-1.5 max-h-[580px] overflow-y-auto">
              {filteredConversations.length === 0 ? (
                <p className="text-center py-8 text-xs text-slate-400">No conversations found.</p>
              ) : (
                filteredConversations.map((c) => {
                  const isSelected = c.id === selectedConvId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectConversation(c.id)}
                      className={`w-full text-left p-3 rounded-xl border transition ${
                        isSelected
                          ? "bg-indigo-50/70 border-indigo-200 text-slate-900 shadow-2xs"
                          : "border-slate-100 hover:bg-slate-50 text-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-xs truncate">{c.lead_name}</span>
                        <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                          {new Date(c.last_message_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500 truncate">
                        <span className="capitalize font-medium text-slate-600">{c.channel}</span>
                        <span>&bull;</span>
                        <span className="truncate">{c.destination}</span>
                      </div>

                      {c.last_message_snippet && (
                        <p className="mt-1.5 text-[11px] text-slate-500 line-clamp-1 italic">
                          &ldquo;{c.last_message_snippet}&rdquo;
                        </p>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Middle/Right Pane: Active Thread & Composer */}
          <div className="flex flex-col h-full bg-slate-50/30">
            {currentConv ? (
              <>
                {/* Conversation Header */}
                <div className="p-4 border-b border-slate-200 bg-white flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <User className="w-4 h-4 text-indigo-600" />
                      {currentConv.lead_name}
                      {currentConv.lead_company && (
                        <span className="text-xs text-slate-400 font-normal">
                          ({currentConv.lead_company})
                        </span>
                      )}
                    </h2>
                    <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
                      {currentConv.channel.toUpperCase()} &bull; {currentConv.destination}
                    </p>
                  </div>

                  <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                    Thread ID: {currentConv.id.slice(0, 8)}
                  </span>
                </div>

                {/* Message Stream */}
                <div className="flex-1 p-6 space-y-4 overflow-y-auto max-h-[460px]">
                  {loadingMessages ? (
                    <div className="p-8 text-center text-xs text-slate-400">Loading conversation history...</div>
                  ) : messages.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400">
                      No messages recorded in this conversation yet.
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isOutbound = m.direction === "outbound";
                      return (
                        <div
                          key={m.id}
                          className={`flex flex-col ${isOutbound ? "items-end" : "items-start"}`}
                        >
                          <div
                            className={`max-w-lg rounded-2xl p-4 text-xs space-y-1.5 shadow-2xs ${
                              isOutbound
                                ? "bg-indigo-600 text-white rounded-br-xs"
                                : "bg-white text-slate-800 border border-slate-200 rounded-bl-xs"
                            }`}
                          >
                            {m.subject && (
                              <div className={`font-semibold pb-1 border-b ${isOutbound ? "border-indigo-400" : "border-slate-100"}`}>
                                {m.subject}
                              </div>
                            )}
                            <p className="whitespace-pre-wrap">{m.text_body}</p>

                            <div
                              className={`flex items-center gap-2 pt-1 text-[10px] font-mono ${
                                isOutbound ? "text-indigo-200" : "text-slate-400"
                              }`}
                            >
                              <span>{new Date(m.created_at).toLocaleTimeString()}</span>
                              <span>&bull;</span>
                              <span className="uppercase">{m.status}</span>
                              {m.dispatch_status === "awaiting_provider" && (
                                <span className="bg-indigo-700 text-indigo-100 px-1.5 py-0.2 rounded text-[9px]">
                                  awaiting_provider
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Composer */}
                <div className="p-4 bg-white border-t border-slate-200">
                  <form onSubmit={handleSend} className="space-y-3">
                    {currentConv.channel === "email" && (
                      <input
                        type="text"
                        value={composerSubject}
                        onChange={(e) => setComposerSubject(e.target.value)}
                        placeholder="Subject..."
                        className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    )}

                    <div className="relative">
                      <textarea
                        value={composerBody}
                        onChange={(e) => setComposerBody(e.target.value)}
                        required
                        rows={3}
                        placeholder={`Reply via ${currentConv.channel}...`}
                        className="w-full text-xs p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    {feedback && (
                      <p className="text-xs text-rose-600 font-medium">{feedback}</p>
                    )}

                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-slate-400">
                        Terminates at <code className="bg-slate-100 px-1 rounded">awaiting_provider</code>
                      </span>

                      <button
                        type="submit"
                        disabled={sending || !composerBody.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-sm transition"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {sending ? "Sending..." : "Send Message"}
                      </button>
                    </div>
                  </form>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
                Select a conversation thread on the left.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
