"use client";

import { useState } from "react";
import { Send, Mail, MessageSquare, AlertCircle, CheckCircle2 } from "lucide-react";
import { sendOutboundMessage } from "@/modules/conversations/commands";
import type { ChannelType } from "@/modules/conversations/types";

interface LeadMessagingControlProps {
  workspace: string;
  leadId: string;
  identities: Array<{
    id: string;
    kind: "email" | "phone" | "provider";
    normalized_value: string;
    is_primary: boolean;
  }>;
}

export function LeadMessagingControl({
  workspace,
  leadId,
  identities,
}: LeadMessagingControlProps) {
  const emailIdentities = identities.filter((i) => i.kind === "email");
  const phoneIdentities = identities.filter((i) => i.kind === "phone");

  const [channel, setChannel] = useState<ChannelType>(
    emailIdentities.length > 0 ? "email" : "sms"
  );
  const [recipient, setRecipient] = useState(
    channel === "email"
      ? emailIdentities[0]?.normalized_value || ""
      : phoneIdentities[0]?.normalized_value || ""
  );
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleChannelChange = (newChannel: ChannelType) => {
    setChannel(newChannel);
    if (newChannel === "email") {
      setRecipient(emailIdentities[0]?.normalized_value || "");
    } else {
      setRecipient(phoneIdentities[0]?.normalized_value || "");
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;

    setLoading(true);
    setStatusMsg(null);

    const res = await sendOutboundMessage({
      workspace,
      leadId,
      channel,
      recipientAddress: recipient,
      subject: channel === "email" ? subject : null,
      textBody: body,
    });

    setLoading(false);

    if (res.error) {
      setStatusMsg({ type: "error", text: res.error });
    } else {
      setStatusMsg({
        type: "success",
        text: "Message queued successfully (awaiting_provider).",
      });
      setBody("");
      setSubject("");
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-indigo-600" />
          Send Message
        </h3>
        <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-medium">
          Providerless Mode
        </span>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => handleChannelChange("email")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
            channel === "email"
              ? "bg-indigo-50 border-indigo-200 text-indigo-700"
              : "border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          <Mail className="w-3.5 h-3.5" /> Email
        </button>
        <button
          type="button"
          onClick={() => handleChannelChange("sms")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
            channel === "sms"
              ? "bg-indigo-50 border-indigo-200 text-indigo-700"
              : "border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" /> SMS
        </button>
        <button
          type="button"
          onClick={() => handleChannelChange("whatsapp")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
            channel === "whatsapp"
              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : "border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" /> WhatsApp
        </button>
      </div>

      <form onSubmit={handleSend} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Recipient Destination</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            required
            className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder={channel === "email" ? "lead@example.com" : "+12025550100"}
          />
        </div>

        {channel === "email" && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Email subject..."
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Message Body</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={3}
            className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Type your message..."
          />
        </div>

        {statusMsg && (
          <div
            className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
              statusMsg.type === "success"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-rose-50 text-rose-700 border border-rose-200"
            }`}
          >
            {statusMsg.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusMsg.text}</span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={loading || !body.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-sm transition"
          >
            <Send className="w-3.5 h-3.5" />
            {loading ? "Queueing..." : "Send Outbound"}
          </button>
        </div>
      </form>
    </div>
  );
}
