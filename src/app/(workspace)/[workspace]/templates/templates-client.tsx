"use client";

import { useState } from "react";
import {
  FileText,
  Plus,
  Mail,
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  Send,
  Eye,
} from "lucide-react";
import type { MessageTemplate, ChannelType } from "@/modules/conversations/types";
import {
  createMessageTemplate,
  publishMessageTemplateVersion,
  listMessageTemplates,
} from "@/modules/templates/commands";
import { extractTemplateVariables, ALLOWED_TEMPLATE_VARIABLES } from "@/modules/templates/parser";

interface TemplatesClientProps {
  workspace: string;
  initialTemplates: MessageTemplate[];
}

export function TemplatesClient({
  workspace,
  initialTemplates,
}: TemplatesClientProps) {
  const [templates, setTemplates] = useState<MessageTemplate[]>(initialTemplates);
  const [selectedChannel, setSelectedChannel] = useState<ChannelType | "all">("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplate | null>(null);

  // Create Template form
  const [createName, setCreateName] = useState("");
  const [createChannel, setCreateChannel] = useState<ChannelType>("email");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Publish Version form
  const [versionSubject, setVersionSubject] = useState("");
  const [versionBody, setVersionBody] = useState("");
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);

  const refreshTemplates = async () => {
    const res = await listMessageTemplates(workspace);
    if (res.templates) {
      setTemplates(res.templates);
      if (selectedTemplate) {
        const updated = res.templates.find((t) => t.id === selectedTemplate.id);
        if (updated) setSelectedTemplate(updated);
      }
    }
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;

    setCreateLoading(true);
    setCreateError(null);

    const res = await createMessageTemplate({
      workspace,
      name: createName.trim(),
      channel: createChannel,
    });

    setCreateLoading(false);

    if (res.error) {
      setCreateError(res.error);
    } else {
      setShowCreateModal(false);
      setCreateName("");
      refreshTemplates();
    }
  };

  const openVersionModal = (template: MessageTemplate) => {
    setSelectedTemplate(template);
    setVersionSubject(template.active_subject || "");
    setVersionBody(template.active_body || "");
    setVersionError(null);
  };

  const handlePublishVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate || !versionBody.trim()) return;

    setVersionLoading(true);
    setVersionError(null);

    const res = await publishMessageTemplateVersion({
      workspace,
      templateId: selectedTemplate.id,
      subject: selectedTemplate.channel === "email" ? versionSubject : null,
      body: versionBody,
    });

    setVersionLoading(false);

    if (res.error) {
      setVersionError(res.error);
    } else {
      setSelectedTemplate(null);
      refreshTemplates();
    }
  };

  // Variable validation feedback
  const detectedVars = extractTemplateVariables(versionBody + " " + versionSubject);
  const invalidVars = detectedVars.filter(
    (v) => !(ALLOWED_TEMPLATE_VARIABLES as readonly string[]).includes(v.name)
  );

  const filteredTemplates = templates.filter((t) =>
    selectedChannel === "all" ? true : t.channel === selectedChannel
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200">
        <div className="flex items-center gap-2">
          {(["all", "email", "sms", "whatsapp"] as const).map((ch) => (
            <button
              key={ch}
              onClick={() => setSelectedChannel(ch)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg capitalize transition ${
                selectedChannel === ch
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {ch}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-[#116c58] hover:bg-[#0e5646] text-white text-xs font-semibold px-3.5 py-2 rounded-xl transition shadow-sm"
        >
          <Plus size={16} /> New Template
        </button>
      </div>

      {filteredTemplates.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <FileText className="mx-auto h-12 w-12 text-slate-300" />
          <h3 className="mt-2 text-sm font-semibold text-slate-900">No message templates</h3>
          <p className="mt-1 text-xs text-slate-500">
            Create email, SMS, or WhatsApp templates with variable validation.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((template) => (
            <div
              key={template.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-sm transition flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {template.channel === "email" ? (
                      <Mail size={16} className="text-blue-500" />
                    ) : (
                      <MessageSquare
                        size={16}
                        className={
                          template.channel === "whatsapp"
                            ? "text-emerald-500"
                            : "text-amber-500"
                        }
                      />
                    )}
                    <span className="text-xs font-mono uppercase font-bold text-slate-600">
                      {template.channel}
                    </span>
                  </div>
                  {template.active_version ? (
                    <span className="text-[11px] font-mono font-medium bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-200">
                      v{template.active_version}
                    </span>
                  ) : (
                    <span className="text-[11px] font-mono font-medium bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                      Draft (No Version)
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="font-semibold text-slate-900 text-sm">{template.name}</h3>
                  {template.active_subject && (
                    <p className="text-xs text-slate-600 mt-1 font-medium truncate">
                      Subject: {template.active_subject}
                    </p>
                  )}
                </div>

                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 min-h-[64px]">
                  {template.active_body ? (
                    <p className="text-xs text-slate-700 line-clamp-3 font-sans whitespace-pre-wrap">
                      {template.active_body}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400 italic">No published body yet.</p>
                  )}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[10px] text-slate-400 font-mono">
                  {template.updated_at ? new Date(template.updated_at).toLocaleDateString() : "Draft"}
                </span>
                <button
                  onClick={() => openVersionModal(template)}
                  className="flex items-center gap-1.5 text-xs font-medium text-[#116c58] hover:text-[#0e5646] hover:underline"
                >
                  <Send size={13} /> {template.active_version ? "Publish New Version" : "Publish Version"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Template Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900">Create Message Template</h2>
            <form onSubmit={handleCreateTemplate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Template Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Inbound Demo Confirmation"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#116c58]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Channel</label>
                <select
                  value={createChannel}
                  onChange={(e) => setCreateChannel(e.target.value as ChannelType)}
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#116c58]"
                >
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </div>

              {createError && (
                <div className="flex items-center gap-2 text-xs text-rose-600 bg-rose-50 p-2.5 rounded-lg border border-rose-200">
                  <AlertCircle size={15} />
                  <span>{createError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="text-xs font-medium px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="text-xs font-semibold px-4 py-2 bg-[#116c58] text-white rounded-lg hover:bg-[#0e5646] disabled:opacity-50"
                >
                  {createLoading ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Publish Version Modal */}
      {selectedTemplate && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-900">
                  Publish Template Version: {selectedTemplate.name}
                </h2>
                <span className="text-xs font-mono uppercase bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-semibold">
                  {selectedTemplate.channel}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Current active version: {selectedTemplate.active_version ? `v${selectedTemplate.active_version}` : "None"}
              </p>
            </div>

            <form onSubmit={handlePublishVersion} className="space-y-4">
              {selectedTemplate.channel === "email" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Subject Line
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Hi {{first_name}}, let's connect!"
                    value={versionSubject}
                    onChange={(e) => setVersionSubject(e.target.value)}
                    className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#116c58]"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Message Body
                </label>
                <textarea
                  rows={6}
                  required
                  placeholder={
                    selectedTemplate.channel === "email"
                      ? "Hi {{first_name}},\n\nThanks for reaching out from {{company:optional}}.\n\nBest,\n{{workspace_name}}"
                      : "Hi {{first_name}}, thanks for your interest. Book here: {{meeting_url}}"
                  }
                  value={versionBody}
                  onChange={(e) => setVersionBody(e.target.value)}
                  className="w-full text-xs font-mono px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#116c58]"
                />
              </div>

              {/* Variable allowlist reference */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-2">
                <span className="text-[11px] font-semibold text-slate-700 flex items-center gap-1.5">
                  <Eye size={13} /> Allowed Variables
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from(ALLOWED_TEMPLATE_VARIABLES).map((v) => (
                    <span
                      key={v}
                      className="text-[10px] font-mono bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-600"
                    >
                      {`{{${v}}}`}
                    </span>
                  ))}
                  <span className="text-[10px] font-mono bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-500">
                    {"{{variable:optional}}"}
                  </span>
                </div>
              </div>

              {invalidVars.length > 0 && (
                <div className="flex items-start gap-2 text-xs text-rose-600 bg-rose-50 p-3 rounded-lg border border-rose-200">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Unknown variable(s) detected:</span>{" "}
                    {invalidVars.map((v) => `{{${v.name}}}`).join(", ")}. Publishing will be rejected
                    by authoritative validation.
                  </div>
                </div>
              )}

              {versionError && (
                <div className="flex items-center gap-2 text-xs text-rose-600 bg-rose-50 p-2.5 rounded-lg border border-rose-200">
                  <AlertCircle size={15} />
                  <span>{versionError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedTemplate(null)}
                  className="text-xs font-medium px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={versionLoading || invalidVars.length > 0}
                  className="text-xs font-semibold px-4 py-2 bg-[#116c58] text-white rounded-lg hover:bg-[#0e5646] disabled:opacity-50 flex items-center gap-1.5"
                >
                  <CheckCircle2 size={14} />
                  {versionLoading ? "Publishing..." : "Publish Immutable Version"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
