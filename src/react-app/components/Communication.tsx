import { useState, useEffect, useRef } from "react";
import {
  Users,
  Send,
  MessageSquare,
  Mail,
  Phone,
  Search,
  Plus,
  Edit,
  Trash2,
  Clock,
  CheckCircle,
  XCircle,
  User,
  MessageCircleMore,
  Archive,
  Star,
  Download,
  Settings as SettingsIcon,
  MessageSquareWarning,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import ComplaintsPanel from "@/react-app/components/ComplaintsPanel";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { resolveCurrencySymbol } from "@/react-app/lib/currency";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  company: string;
  tags: string[];
  balance: number;
  lastContact: string;
  notes: string;
  starred: boolean;
}

interface Message {
  id: string;
  contactId: string;
  type: "sms" | "email" | "call";
  content: string;
  subject?: string;
  status: "sent" | "delivered" | "failed" | "pending";
  timestamp: string;
  sentBy: string;
}

interface MessageTemplate {
  id: string;
  name: string;
  type: "sms" | "email";
  subject?: string;
  content: string;
  category: string;
}

/**
 * Normalize a contact from cloud/localStorage so it always has every field
 * the UI expects. Cloud data may be partial (from older app versions, API
 * imports, or cross-device sync where the record was created with a subset of
 * fields). Without this, rendering crashes with
 * "Cannot read properties of undefined (reading 'map')" etc.
 */
function normalizeContact(c: Partial<Contact> | null | undefined): Contact {
  const id =
    c?.id || `ct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: c?.name ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    company: c?.company ?? "",
    tags: Array.isArray(c?.tags) ? c.tags : [],
    balance: typeof c?.balance === "number" ? c.balance : 0,
    lastContact: c?.lastContact ?? "",
    notes: c?.notes ?? "",
    starred: typeof c?.starred === "boolean" ? c.starred : false,
  };
}

function normalizeMessage(m: Partial<Message> | null | undefined): Message {
  const id =
    m?.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    contactId: m?.contactId ?? "",
    type: m?.type === "email" || m?.type === "call" ? m.type : "sms",
    content: m?.content ?? "",
    subject: m?.subject,
    status:
      m?.status === "sent" ||
      m?.status === "delivered" ||
      m?.status === "failed" ||
      m?.status === "pending"
        ? m.status
        : "pending",
    timestamp: m?.timestamp ?? "",
    sentBy: m?.sentBy ?? "",
  };
}

function normalizeTemplate(
  t: Partial<MessageTemplate> | null | undefined,
): MessageTemplate {
  const id =
    t?.id || `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: t?.name ?? "",
    type: t?.type === "email" ? t.type : "sms",
    subject: t?.subject,
    content: t?.content ?? "",
    category: t?.category ?? "general",
  };
}

function normalizeContacts(arr: unknown): Contact[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((c) => normalizeContact(c as Partial<Contact>));
}

function normalizeMessages(arr: unknown): Message[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((m) => normalizeMessage(m as Partial<Message>));
}

function normalizeTemplates(arr: unknown): MessageTemplate[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((t) => normalizeTemplate(t as Partial<MessageTemplate>));
}

export default function Communication() {
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { state } = useFuel();
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );

  // State management — initialize from the synchronous cache so the FIRST
  // render shows data instantly (no blank flash while the async cloud get
  // resolves).
  const [activeTab, setActiveTab] = useState<
    "contacts" | "messages" | "templates" | "settings" | "complaints"
  >("contacts");
  // Open complaints from CustomerLoyalty so the comms team can act on them
  // immediately (send an SMS/email or route to the right person).
  const { data: openComplaints } = useCloudKV<
    {
      id: string;
      date: string;
      customer: string;
      subject: string;
      severity: "low" | "medium" | "high";
      resolved: boolean;
    }[]
  >("customer_complaints", stationId, []);
  const [contacts, setContacts] = useState<Contact[]>(() => {
    const cached = cloudStorageService.getCached<unknown[]>(
      "comm_contacts",
      stationId,
    );
    return Array.isArray(cached) ? normalizeContacts(cached) : [];
  });
  const [messages, setMessages] = useState<Message[]>(() => {
    const cached = cloudStorageService.getCached<unknown[]>(
      "comm_messages",
      stationId,
    );
    return Array.isArray(cached) ? normalizeMessages(cached) : [];
  });
  const [templates, setTemplates] = useState<MessageTemplate[]>(() => {
    const cached = cloudStorageService.getCached<unknown[]>(
      "comm_templates",
      stationId,
    );
    return Array.isArray(cached) ? normalizeTemplates(cached) : [];
  });

  // UI state
  const [searchTerm, setSearchTerm] = useState("");
  const [filterTag, setFilterTag] = useState<string>("all");
  const [showContactModal, setShowContactModal] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);

  // Form state
  const [contactForm, setContactForm] = useState({
    name: "",
    phone: "",
    email: "",
    company: "",
    tags: "",
    balance: 0,
    notes: "",
  });

  const [messageForm, setMessageForm] = useState({
    type: "sms" as "sms" | "email",
    subject: "",
    content: "",
    recipients: [] as string[],
  });

  const [templateForm, setTemplateForm] = useState({
    name: "",
    type: "sms" as "sms" | "email",
    subject: "",
    content: "",
    category: "general",
  });

  // CRITICAL: cloud-load race guard. Without this, a save/delete fired
  // BEFORE the initial cloud load completes reads an empty/default state
  // and writes it back to cloud, wiping ALL the user's data on a fresh
  // device. Same class of bug fixed in FuelContext + PayrollSystem.
  const cloudLoadCompleteRef = useRef(false);
  // Refs to the latest contacts/messages/templates so save/delete functions
  // operate on the CURRENT state (not a stale re-fetch that may return []
  // before load completes).
  const contactsRef = useRef<Contact[]>([]);
  const messagesRef = useRef<Message[]>([]);
  const templatesRef = useRef<MessageTemplate[]>([]);
  contactsRef.current = contacts;
  messagesRef.current = messages;
  templatesRef.current = templates;

  // Reset the load-complete guard on user/station change so a fresh load
  // is required before any save is allowed.
  useEffect(() => {
    cloudLoadCompleteRef.current = false;
  }, [user, stationId]);

  // Load data from backend + real-time cross-device sync
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    // Load all three collections; mark load complete only after ALL resolve
    // so no save can fire against an empty (pre-load) state.
    Promise.all([loadContacts(), loadMessages(), loadTemplates()]).finally(
      () => {
        if (!cancelled) cloudLoadCompleteRef.current = true;
      },
    );

    // Real-time: when another device updates contacts/messages/templates, update instantly
    const unsubs = [
      cloudStorageService.subscribe<Contact[]>(
        "comm_contacts",
        stationId,
        (val) => {
          setContacts(normalizeContacts(val));
        },
      ),
      cloudStorageService.subscribe<Message[]>(
        "comm_messages",
        stationId,
        (val) => {
          setMessages(normalizeMessages(val));
        },
      ),
      cloudStorageService.subscribe<MessageTemplate[]>(
        "comm_templates",
        stationId,
        (val) => {
          setTemplates(normalizeTemplates(val));
        },
      ),
    ];
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [user, stationId]);

  // Auto-refresh messages every 30 seconds for live updates
  useEffect(() => {
    const interval = setInterval(() => {
      if (user && activeTab === "messages") {
        loadMessages();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [user, activeTab]);

  const loadContacts = async () => {
    try {
      const data = await cloudStorageService.get<Contact[]>(
        "comm_contacts",
        stationId,
      );
      setContacts(normalizeContacts(data));
    } catch (error) {
      console.error("Error loading contacts:", error);
    }
  };

  const loadMessages = async () => {
    try {
      const data = await cloudStorageService.get<Message[]>(
        "comm_messages",
        stationId,
      );
      setMessages(normalizeMessages(data));
    } catch (error) {
      console.error("Error loading messages:", error);
    }
  };

  const loadTemplates = async () => {
    try {
      const data = await cloudStorageService.get<MessageTemplate[]>(
        "comm_templates",
        stationId,
      );
      setTemplates(normalizeTemplates(data));
    } catch (error) {
      console.error("Error loading templates:", error);
    }
  };

  const saveContact = async () => {
    // Validation: require at least a name.
    if (!contactForm.name.trim()) {
      toastError("Contact name is required.");
      return;
    }
    // Guard: don't save before the initial cloud load completes (would wipe).
    if (!cloudLoadCompleteRef.current) {
      toastError(
        "Still loading your contacts from cloud. Please try again in a moment.",
      );
      return;
    }
    try {
      const tags = contactForm.tags
        ? typeof contactForm.tags === "string"
          ? contactForm.tags
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t)
          : contactForm.tags
        : [];

      const newContact: Contact = {
        // Add random suffix to avoid ID collision on rapid double-save.
        id:
          selectedContact?.id ||
          `ct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: contactForm.name.trim(),
        phone: contactForm.phone.trim(),
        email: contactForm.email.trim(),
        company: contactForm.company.trim(),
        tags: tags as string[],
        balance:
          typeof (contactForm as any).balance === "number"
            ? (contactForm as any).balance
            : 0,
        lastContact: selectedContact?.lastContact || new Date().toISOString(),
        notes: contactForm.notes || "",
        starred: selectedContact?.starred || false,
      };

      // Operate on the LATEST state (ref), not a stale re-fetch.
      const existing = contactsRef.current;
      let updated: Contact[];
      if (selectedContact) {
        updated = existing.map((c) =>
          c.id === selectedContact.id ? { ...c, ...newContact } : c,
        );
      } else {
        updated = [...existing, newContact];
      }
      await cloudStorageService.set("comm_contacts", updated, stationId);
      setContacts(updated);
      setShowContactModal(false);
      setSelectedContact(null);
      resetContactForm();
      import("@/react-app/lib/toast").then(({ toastSuccess }) =>
        toastSuccess("Contact saved"),
      );
    } catch (error) {
      console.error("Error saving contact:", error);
      toastError("Failed to save contact: " + (error as Error).message);
    }
  };

  const deleteContact = async (id: string) => {
    if (!confirm("Delete this contact? Related messages will also be deleted."))
      return;
    if (!cloudLoadCompleteRef.current) {
      toastError("Still loading from cloud. Please try again in a moment.");
      return;
    }

    try {
      // Delete the contact + orphaned messages (cascade).
      const updatedContacts = contactsRef.current.filter((c) => c.id !== id);
      const updatedMessages = messagesRef.current.filter(
        (m) => m.contactId !== id,
      );
      await cloudStorageService.set(
        "comm_contacts",
        updatedContacts,
        stationId,
      );
      await cloudStorageService.set(
        "comm_messages",
        updatedMessages,
        stationId,
      );
      setContacts(updatedContacts);
      setMessages(updatedMessages);
      import("@/react-app/lib/toast").then(({ toastSuccess }) =>
        toastSuccess("Contact deleted"),
      );
    } catch (error) {
      console.error("Error deleting contact:", error);
      toastError("Failed to delete contact: " + (error as Error).message);
    }
  };

  const sendMessage = async () => {
    // Validation: require content + at least one recipient.
    if (!messageForm.content.trim()) {
      toastError("Message content is required.");
      return;
    }
    const recipients =
      selectedContacts.length > 0 ? selectedContacts : messageForm.recipients;
    if (!recipients || recipients.length === 0) {
      toastError("Please select at least one recipient.");
      return;
    }
    if (!cloudLoadCompleteRef.current) {
      toastError("Still loading from cloud. Please try again in a moment.");
      return;
    }
    try {
      // Create one message per recipient (bulk send was ignoring all but the first).
      const now = new Date().toISOString();
      const sentBy = user?.email || user?.id || "user";
      const newMessages: Message[] = recipients.map((rid, idx) => ({
        id: `msg_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 8)}`,
        contactId: rid,
        type: messageForm.type || "sms",
        content: messageForm.content || "",
        subject: messageForm.subject || "",
        // Status starts "pending" — it is upgraded to "sent"/"failed" below
        // when a real gateway is configured and the institution responds.
        status: "pending",
        timestamp: now,
        sentBy,
      }));

      // REAL gateway sending. If the station configured an SMS/email/WhatsApp
      // gateway in Communication → Settings, actually send each message via
      // the real institution and record the true delivery status. Without a
      // configured gateway the messages stay "pending" (honest) and the toast
      // says exactly what to configure.
      const commCfg =
        (await cloudStorageService
          .get<CommIntegrationConfig>("comm_integration_config", stationId)
          .catch(() => null)) || null;
      let sentCount = 0;
      let failedCount = 0;
      const wantSms = (messageForm.type || "sms") === "sms";
      const smsReady = !!(
        commCfg?.smsEnabled &&
        (commCfg.smsProvider === "custom"
          ? commCfg.smsCustomUrl
          : commCfg.smsProvider === "twilio"
            ? commCfg.smsAccountSid &&
              commCfg.smsAuthToken &&
              commCfg.smsFromNumber
            : commCfg.smsApiKey && commCfg.smsUsername)
      );
      const emailReady = !!(
        commCfg?.emailEnabled &&
        commCfg?.emailApiKey &&
        commCfg?.emailProvider !== "smtp"
      );

      if ((wantSms && smsReady) || (!wantSms && emailReady)) {
        const { callIntegration } =
          await import("@/react-app/lib/integrations-client");
        for (const msg of newMessages) {
          const contact = contactsRef.current.find(
            (c) => c.id === msg.contactId,
          );
          try {
            let result: { success: boolean; error?: string };
            if (wantSms) {
              const to = contact?.phone || "";
              result = await callIntegration("sms-send", {
                provider: commCfg!.smsProvider,
                to,
                message: msg.content,
                accountSid: commCfg!.smsAccountSid,
                authToken: commCfg!.smsAuthToken,
                fromNumber: commCfg!.smsFromNumber,
                apiKey: commCfg!.smsApiKey,
                username: commCfg!.smsUsername,
                senderId: commCfg!.smsSender,
                customUrl: commCfg!.smsCustomUrl,
              });
            } else {
              const to = contact?.email || "";
              result = await callIntegration("email-send", {
                provider: commCfg!.emailProvider,
                to,
                subject:
                  msg.subject ||
                  `Message from ${commCfg!.stationName || "Fuel Station"}`,
                text: msg.content,
                fromEmail: commCfg!.senderEmail || commCfg!.smtpUser,
                fromName: commCfg!.stationName,
                apiKey: commCfg!.emailApiKey,
                domain: commCfg!.emailDomain,
              });
            }
            msg.status = result.success ? "sent" : "failed";
            if (result.success) sentCount++;
            else {
              failedCount++;
              console.warn(
                `[comm] real send failed for ${msg.contactId}:`,
                result.error,
              );
            }
          } catch (e) {
            msg.status = "failed";
            failedCount++;
            console.warn(`[comm] real send error for ${msg.contactId}:`, e);
          }
        }
      }

      const updated = [...newMessages, ...messagesRef.current];
      await cloudStorageService.set("comm_messages", updated, stationId);
      setMessages(updated);
      setShowMessageModal(false);
      setSelectedContacts([]);
      resetMessageForm();
      import("@/react-app/lib/toast").then(({ toastSuccess, toastWarning }) => {
        if (sentCount > 0 && failedCount === 0) {
          toastSuccess(
            `Sent ${sentCount} message(s) via the configured gateway.`,
          );
        } else if (sentCount > 0 && failedCount > 0) {
          toastWarning(
            `Sent ${sentCount}, failed ${failedCount}. Check the gateway config.`,
          );
        } else if (failedCount > 0) {
          toastWarning(
            `All ${failedCount} message(s) failed to send. Check the gateway config in Communication → Settings.`,
          );
        } else {
          toastSuccess(
            `Message queued for ${recipients.length} recipient(s). Configure an SMS/email gateway in Communication → Settings to actually send.`,
          );
        }
      });
    } catch (error) {
      console.error("Error sending message:", error);
      import("@/react-app/lib/toast").then(({ toastError }) =>
        toastError("Error sending message: " + (error as Error).message),
      );
    }
  };

  const deleteMessage = async (id: string) => {
    if (!confirm("Delete this message?")) return;
    if (!cloudLoadCompleteRef.current) {
      toastError("Still loading from cloud. Please try again in a moment.");
      return;
    }
    try {
      const updated = messagesRef.current.filter((m) => m.id !== id);
      await cloudStorageService.set("comm_messages", updated, stationId);
      setMessages(updated);
      import("@/react-app/lib/toast").then(({ toastSuccess }) =>
        toastSuccess("Message deleted"),
      );
    } catch (error) {
      console.error("Error deleting message:", error);
      toastError("Failed to delete message: " + (error as Error).message);
    }
  };

  const saveTemplate = async () => {
    if (!templateForm.name.trim()) {
      toastError("Template name is required.");
      return;
    }
    if (!templateForm.content.trim()) {
      toastError("Template content is required.");
      return;
    }
    if (!cloudLoadCompleteRef.current) {
      toastError("Still loading from cloud. Please try again in a moment.");
      return;
    }
    try {
      const existing = templatesRef.current;
      // If editing (a template with a matching id was selected), update; else add.
      const editingId = (templateForm as any)._editingId;
      const newTemplate: MessageTemplate = {
        id:
          editingId ||
          `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: templateForm.name.trim(),
        type: templateForm.type || "sms",
        subject: templateForm.subject || "",
        content: templateForm.content.trim(),
        category: templateForm.category || "general",
      };
      let updated: MessageTemplate[];
      if (editingId) {
        updated = existing.map((t) =>
          t.id === editingId ? { ...t, ...newTemplate } : t,
        );
      } else {
        updated = [...existing, newTemplate];
      }
      await cloudStorageService.set("comm_templates", updated, stationId);
      setTemplates(updated);
      setShowTemplateModal(false);
      resetTemplateForm();
      import("@/react-app/lib/toast").then(({ toastSuccess }) =>
        toastSuccess("Template saved"),
      );
    } catch (error) {
      console.error("Error saving template:", error);
      toastError("Failed to save template: " + (error as Error).message);
    }
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    if (!cloudLoadCompleteRef.current) {
      toastError("Still loading from cloud. Please try again in a moment.");
      return;
    }

    try {
      const updated = templatesRef.current.filter((t) => t.id !== id);
      await cloudStorageService.set("comm_templates", updated, stationId);
      setTemplates(updated);
      import("@/react-app/lib/toast").then(({ toastSuccess }) =>
        toastSuccess("Template deleted"),
      );
    } catch (error) {
      console.error("Error deleting template:", error);
      toastError("Failed to delete template: " + (error as Error).message);
    }
  };

  const toggleStarContact = async (contact: Contact) => {
    if (!cloudLoadCompleteRef.current) return;
    try {
      const existing = contactsRef.current;
      const updated = existing.map((c) =>
        c.id === contact.id ? { ...c, starred: !c.starred } : c,
      );
      await cloudStorageService.set("comm_contacts", updated, stationId);
      setContacts(updated);
    } catch (error) {
      console.error("Error updating contact:", error);
    }
  };

  const exportContactsCSV = () => {
    if (contacts.length === 0) {
      toastError("No contacts to export.");
      return;
    }
    const escape = (val: string) => `"${String(val).replace(/"/g, '""')}"`;
    const headers = [
      "Name",
      "Phone",
      "Email",
      "Company",
      "Tags",
      "Balance",
      "Notes",
      "Starred",
    ];
    const rows = contacts.map((c) => [
      c.name,
      c.phone,
      c.email,
      c.company,
      (c.tags || []).join("; "),
      String(c.balance || 0),
      c.notes || "",
      c.starred ? "Yes" : "No",
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map(escape).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const applyTemplate = (template: MessageTemplate) => {
    setMessageForm({
      type: template.type,
      subject: template.subject || "",
      content: template.content,
      recipients: selectedContacts,
    });
    setShowTemplateModal(false);
    setShowMessageModal(true);
  };

  const resetContactForm = () => {
    setContactForm({
      name: "",
      phone: "",
      email: "",
      company: "",
      tags: "",
      balance: 0,
      notes: "",
    });
  };

  const resetMessageForm = () => {
    setMessageForm({
      type: "sms",
      subject: "",
      content: "",
      recipients: [],
    });
  };

  const resetTemplateForm = () => {
    setTemplateForm({
      name: "",
      type: "sms",
      subject: "",
      content: "",
      category: "general",
    });
    // Clear the hidden editing-id flag.
    (templateForm as any)._editingId = undefined;
  };

  const openEditTemplate = (template: MessageTemplate) => {
    setTemplateForm({
      name: template.name,
      type: template.type,
      subject: template.subject || "",
      content: template.content,
      category: template.category,
    } as any);
    // Stash the id so saveTemplate knows to update instead of insert.
    (templateForm as any)._editingId = template.id;
    setShowTemplateModal(true);
  };

  const openEditContact = (contact: Contact) => {
    setSelectedContact(contact);
    setContactForm({
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      company: contact.company,
      tags: (contact.tags || []).join(", "),
      balance: contact.balance,
      notes: contact.notes,
    });
    setShowContactModal(true);
  };

  const openNewMessage = (contactIds?: string[]) => {
    if (contactIds && contactIds.length > 0) {
      setSelectedContacts(contactIds);
      setMessageForm((prev) => ({ ...prev, recipients: contactIds }));
    }
    setShowMessageModal(true);
  };

  // Filter contacts
  const filteredContacts = contacts.filter((contact) => {
    const matchesSearch =
      (contact.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (contact.phone || "").includes(searchTerm) ||
      (contact.email || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (contact.company || "").toLowerCase().includes(searchTerm.toLowerCase());

    const matchesTag =
      filterTag === "all" ||
      (filterTag === "starred" && contact.starred) ||
      (contact.tags || []).includes(filterTag);

    return matchesSearch && matchesTag;
  });

  // Get all unique tags
  const allTags = Array.from(new Set(contacts.flatMap((c) => c.tags || [])));

  // Get status icon
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "sent":
      case "delivered":
        return <CheckCircle size={16} className="text-green-500" />;
      case "failed":
        return <XCircle size={16} className="text-red-500" />;
      case "pending":
        return <Clock size={16} className="text-yellow-500" />;
      default:
        return null;
    }
  };

  // Render contacts tab
  const renderContactsTab = () => (
    <div className="space-y-4">
      {/* Header with search and actions */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div className="flex-1 w-full md:w-auto">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400"
              size={20}
            />
            <input
              type="text"
              placeholder="Search contacts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
            />
          </div>
        </div>

        <div className="flex gap-2 w-full md:w-auto">
          <select
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
          >
            <option value="all">All Tags</option>
            <option value="starred">Starred</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              resetContactForm();
              setSelectedContact(null);
              setShowContactModal(true);
            }}
            className="btn btn-primary px-4 py-2 flex items-center gap-2"
          >
            <Plus size={20} />
            Add Contact
          </button>
          <button
            onClick={exportContactsCSV}
            disabled={contacts.length === 0}
            className="btn px-4 py-2 flex items-center gap-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50"
            title="Export contacts as CSV"
            aria-label="Export contacts as CSV"
          >
            <Download size={18} />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Bulk actions */}
      {selectedContacts.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg flex justify-between items-center">
          <span className="font-medium">
            {selectedContacts.length} contact
            {selectedContacts.length > 1 ? "s" : ""} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => openNewMessage(selectedContacts)}
              className="btn btn-primary px-4 py-2 flex items-center gap-2"
            >
              <Send size={16} />
              Send Message
            </button>
            <button
              onClick={() => setSelectedContacts([])}
              className="btn btn-outline px-4 py-2"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Contacts grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredContacts.map((contact) => (
          <div
            key={contact.id}
            className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow border border-gray-200 dark:border-gray-700 hover:shadow-lg transition-shadow"
          >
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedContacts.includes(contact.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedContacts([...selectedContacts, contact.id]);
                    } else {
                      setSelectedContacts(
                        selectedContacts.filter((id) => id !== contact.id),
                      );
                    }
                  }}
                  className="w-4 h-4"
                />
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                  <User
                    size={20}
                    className="text-blue-600 dark:text-blue-400"
                  />
                </div>
              </div>
              <button
                onClick={() => toggleStarContact(contact)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <Star
                  size={18}
                  className={
                    contact.starred
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-gray-500 dark:text-gray-400"
                  }
                />
              </button>
            </div>

            <h3 className="font-semibold text-lg mb-1">{contact.name}</h3>
            {contact.company && (
              <p className="text-sm text-gray-600 dark:text-gray-500 dark:text-gray-400 mb-2">
                {contact.company}
              </p>
            )}

            <div className="space-y-1 mb-3 text-sm">
              {contact.phone && (
                <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                  <Phone size={14} />
                  {contact.phone}
                </div>
              )}
              {contact.email && (
                <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                  <Mail size={14} />
                  {contact.email}
                </div>
              )}
            </div>

            {(contact.tags || []).length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {(contact.tags || []).map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {contact.balance !== 0 && (
              <div
                className={`text-sm font-medium mb-3 ${contact.balance > 0 ? "text-red-600" : "text-green-600"}`}
              >
                Balance: {currencySymbol}{" "}
                {Math.abs(contact.balance || 0).toLocaleString()}
                {contact.balance > 0 ? " (Owed)" : " (Credit)"}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => openNewMessage([contact.id])}
                className="flex-1 btn btn-primary py-2 flex items-center justify-center gap-2 text-sm"
              >
                <Send size={16} />
                Message
              </button>
              <button
                onClick={() => openEditContact(contact)}
                className="btn btn-outline p-2"
              >
                <Edit size={16} />
              </button>
              <button
                onClick={() => deleteContact(contact.id)}
                className="btn btn-outline p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredContacts.length === 0 && (
        <div className="text-center py-12">
          <Users
            size={48}
            className="mx-auto text-gray-500 dark:text-gray-400 mb-4"
          />
          <p className="text-gray-500">No contacts found</p>
        </div>
      )}
    </div>
  );

  // Render messages tab
  const renderMessagesTab = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-bold">Communication History</h3>
        <button
          onClick={() => openNewMessage()}
          className="btn btn-primary px-4 py-2 flex items-center gap-2"
        >
          <Plus size={20} />
          New Message
        </button>
      </div>

      <div className="space-y-2">
        {messages.map((message) => {
          const contact = contacts.find((c) => c.id === message.contactId);
          return (
            <div
              key={message.id}
              className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow border border-gray-200 dark:border-gray-700"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-3">
                  {message.type === "sms" && (
                    <MessageSquare size={20} className="text-blue-500" />
                  )}
                  {message.type === "email" && (
                    <Mail size={20} className="text-green-500" />
                  )}
                  {message.type === "call" && (
                    <Phone size={20} className="text-purple-500" />
                  )}
                  <div>
                    <h4 className="font-semibold">
                      {contact?.name || "Unknown"}
                    </h4>
                    {message.subject && (
                      <p className="text-sm text-gray-600 dark:text-gray-500 dark:text-gray-400">
                        {message.subject}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusIcon(message.status)}
                  <span className="text-xs text-gray-500">
                    {new Date(message.timestamp || "").toLocaleString()}
                  </span>
                  <button
                    onClick={() => deleteMessage(message.id)}
                    className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 p-1 rounded ml-1"
                    title="Delete message"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                {message.content}
              </p>
              <div className="flex justify-between items-center text-xs text-gray-500">
                <span>Sent by: {message.sentBy}</span>
                <span className="capitalize">{message.status}</span>
              </div>
            </div>
          );
        })}
      </div>

      {messages.length === 0 && (
        <div className="text-center py-12">
          <MessageCircleMore
            size={48}
            className="mx-auto text-gray-500 dark:text-gray-400 mb-4"
          />
          <p className="text-gray-500">No messages yet</p>
          <button
            onClick={() => openNewMessage()}
            className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-gray-900 dark:text-white text-sm font-medium hover:bg-blue-700"
          >
            <Plus size={16} /> New Message
          </button>
        </div>
      )}
    </div>
  );

  // Render templates tab
  const renderTemplatesTab = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-bold">Message Templates</h3>
        <button
          onClick={() => {
            resetTemplateForm();
            setShowTemplateModal(true);
          }}
          className="btn btn-primary px-4 py-2 flex items-center gap-2"
        >
          <Plus size={20} />
          Create Template
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.map((template) => (
          <div
            key={template.id}
            className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow border border-gray-200 dark:border-gray-700"
          >
            <div className="flex justify-between items-start mb-2">
              <div>
                <h4 className="font-semibold">{template.name}</h4>
                <span className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">
                  {(template.type || "").toUpperCase()}
                </span>
                <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 rounded ml-2">
                  {template.category}
                </span>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => openEditTemplate(template)}
                  className="text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 p-1 rounded"
                  title="Edit template"
                >
                  <Edit size={16} />
                </button>
                <button
                  onClick={() => deleteTemplate(template.id)}
                  className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 p-1 rounded"
                  title="Delete template"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {template.subject && (
              <p className="text-sm font-medium mb-1">
                Subject: {template.subject}
              </p>
            )}
            <p className="text-sm text-gray-600 dark:text-gray-500 dark:text-gray-400 mb-3 line-clamp-2">
              {template.content}
            </p>

            <button
              onClick={() => applyTemplate(template)}
              className="w-full btn btn-primary py-2 flex items-center justify-center gap-2"
            >
              <Send size={16} />
              Use Template
            </button>
          </div>
        ))}
      </div>

      {templates.length === 0 && (
        <div className="text-center py-12">
          <Archive
            size={48}
            className="mx-auto text-gray-500 dark:text-gray-400 mb-4"
          />
          <p className="text-gray-500">No templates created yet</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      {/* Tab Navigation */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveTab("contacts")}
          className={`px-6 py-3 font-medium ${
            activeTab === "contacts"
              ? "border-b-2 border-blue-600 text-blue-600"
              : "text-gray-600 dark:text-gray-500 dark:text-gray-400"
          }`}
        >
          <Users size={20} className="inline mr-2" />
          Contacts ({contacts.length})
        </button>
        <button
          onClick={() => setActiveTab("messages")}
          className={`px-6 py-3 font-medium ${
            activeTab === "messages"
              ? "border-b-2 border-blue-600 text-blue-600"
              : "text-gray-600 dark:text-gray-500 dark:text-gray-400"
          }`}
        >
          <MessageSquare size={20} className="inline mr-2" />
          Messages ({messages.length})
        </button>
        <button
          onClick={() => setActiveTab("templates")}
          className={`px-6 py-3 font-medium ${
            activeTab === "templates"
              ? "border-b-2 border-blue-600 text-blue-600"
              : "text-gray-600 dark:text-gray-500 dark:text-gray-400"
          }`}
        >
          <Archive size={20} className="inline mr-2" />
          Templates ({templates.length})
        </button>
        <button
          onClick={() => setActiveTab("complaints")}
          className={`px-6 py-3 font-medium ${
            activeTab === "complaints"
              ? "border-b-2 border-blue-600 text-blue-600"
              : "text-gray-600 dark:text-gray-500 dark:text-gray-400"
          }`}
        >
          <MessageSquareWarning size={20} className="inline mr-2" />
          Complaints ({openComplaints.filter((c) => !c.resolved).length})
        </button>
        <button
          onClick={() => setActiveTab("settings")}
          className={`px-6 py-3 font-medium ${
            activeTab === "settings"
              ? "border-b-2 border-blue-600 text-blue-600"
              : "text-gray-600 dark:text-gray-500 dark:text-gray-400"
          }`}
        >
          <SettingsIcon size={20} className="inline mr-2" />
          Settings
        </button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-gray-700">
          <p className="text-[10px] text-gray-500">Total Contacts</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">
            {contacts.length}
          </p>
        </div>
        <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl p-3">
          <p className="text-[10px] text-gray-500">Starred</p>
          <p className="text-lg font-bold text-amber-600 dark:text-amber-400">
            {contacts.filter((c) => c.starred).length}
          </p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-500/10 rounded-xl p-3">
          <p className="text-[10px] text-gray-500">Messages</p>
          <p className="text-lg font-bold text-blue-600 dark:text-blue-400">
            {messages.length}
          </p>
        </div>
        <div className="bg-violet-50 dark:bg-violet-500/10 rounded-xl p-3">
          <p className="text-[10px] text-gray-500">Templates</p>
          <p className="text-lg font-bold text-violet-600 dark:text-violet-400">
            {templates.length}
          </p>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "contacts" && renderContactsTab()}
      {activeTab === "messages" && renderMessagesTab()}
      {activeTab === "templates" && renderTemplatesTab()}
      {activeTab === "settings" && <CommSettingsTab stationId={stationId} />}
      {activeTab === "complaints" && (
        <ComplaintsPanel complaints={openComplaints} stationId={stationId} />
      )}

      {/* Contact Modal */}
      {showContactModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">
              {selectedContact ? "Edit Contact" : "Add New Contact"}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  value={contactForm.name}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, name: e.target.value })
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label>Phone *</label>
                <input
                  type="tel"
                  value={contactForm.phone}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, phone: e.target.value })
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={contactForm.email}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, email: e.target.value })
                  }
                />
              </div>

              <div className="form-group">
                <label>Company</label>
                <input
                  type="text"
                  value={contactForm.company}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, company: e.target.value })
                  }
                />
              </div>

              <div className="form-group">
                <label>Tags (comma-separated)</label>
                <input
                  type="text"
                  value={contactForm.tags}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, tags: e.target.value })
                  }
                  placeholder="customer, vip, dealer"
                />
              </div>

              <div className="form-group">
                <label>Balance</label>
                <input
                  type="number"
                  value={contactForm.balance}
                  onChange={(e) =>
                    setContactForm({
                      ...contactForm,
                      balance: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>

            <div className="form-group mt-4">
              <label>Notes</label>
              <textarea
                value={contactForm.notes}
                onChange={(e) =>
                  setContactForm({ ...contactForm, notes: e.target.value })
                }
                rows={3}
              />
            </div>

            <div className="flex gap-4 mt-6">
              <button
                onClick={() => {
                  setShowContactModal(false);
                  setSelectedContact(null);
                }}
                className="btn btn-outline"
              >
                Cancel
              </button>
              <button onClick={saveContact} className="btn btn-primary">
                Save Contact
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Message Modal */}
      {showMessageModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">Send Message</h3>

            <div className="space-y-4">
              <div className="form-group">
                <label>Message Type</label>
                <select
                  value={messageForm.type}
                  onChange={(e) =>
                    setMessageForm({
                      ...messageForm,
                      type: e.target.value as "sms" | "email",
                    })
                  }
                >
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                </select>
              </div>

              {messageForm.type === "email" && (
                <div className="form-group">
                  <label>Subject</label>
                  <input
                    type="text"
                    value={messageForm.subject}
                    onChange={(e) =>
                      setMessageForm({
                        ...messageForm,
                        subject: e.target.value,
                      })
                    }
                  />
                </div>
              )}

              <div className="form-group">
                <label>Message Content</label>
                <textarea
                  value={messageForm.content}
                  onChange={(e) =>
                    setMessageForm({ ...messageForm, content: e.target.value })
                  }
                  rows={6}
                  placeholder="Type your message here..."
                />
                {messageForm.type === "sms" && (
                  <p className="text-xs text-gray-500 mt-1">
                    {messageForm.content.length} characters
                  </p>
                )}
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded">
                <p className="text-sm">
                  Recipients:{" "}
                  {selectedContacts.length > 0
                    ? `${selectedContacts.length} contact(s) selected`
                    : "No recipients selected"}
                </p>
              </div>
            </div>

            <div className="flex gap-4 mt-6">
              <button
                onClick={() => {
                  setShowMessageModal(false);
                  setSelectedContacts([]);
                }}
                className="btn btn-outline"
              >
                Cancel
              </button>
              <button
                onClick={sendMessage}
                disabled={!messageForm.content || selectedContacts.length === 0}
                className="btn btn-primary flex items-center gap-2"
              >
                <Send size={20} />
                Send Message
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">Create Message Template</h3>

            <div className="space-y-4">
              <div className="form-group">
                <label>Template Name</label>
                <input
                  type="text"
                  value={templateForm.name}
                  onChange={(e) =>
                    setTemplateForm({ ...templateForm, name: e.target.value })
                  }
                  placeholder="e.g., Payment Reminder"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label>Type</label>
                  <select
                    value={templateForm.type}
                    onChange={(e) =>
                      setTemplateForm({
                        ...templateForm,
                        type: e.target.value as "sms" | "email",
                      })
                    }
                  >
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Category</label>
                  <select
                    value={templateForm.category}
                    onChange={(e) =>
                      setTemplateForm({
                        ...templateForm,
                        category: e.target.value,
                      })
                    }
                  >
                    <option value="general">General</option>
                    <option value="payment">Payment</option>
                    <option value="reminder">Reminder</option>
                    <option value="promotional">Promotional</option>
                  </select>
                </div>
              </div>

              {templateForm.type === "email" && (
                <div className="form-group">
                  <label>Subject</label>
                  <input
                    type="text"
                    value={templateForm.subject}
                    onChange={(e) =>
                      setTemplateForm({
                        ...templateForm,
                        subject: e.target.value,
                      })
                    }
                  />
                </div>
              )}

              <div className="form-group">
                <label>Template Content</label>
                <textarea
                  value={templateForm.content}
                  onChange={(e) =>
                    setTemplateForm({
                      ...templateForm,
                      content: e.target.value,
                    })
                  }
                  rows={6}
                  placeholder="Dear [Name], ..."
                />
                <p className="text-xs text-gray-500 mt-1">
                  Use [Name], [Company], [Balance] as placeholders
                </p>
              </div>
            </div>

            <div className="flex gap-4 mt-6">
              <button
                onClick={() => setShowTemplateModal(false)}
                className="btn btn-outline"
              >
                Cancel
              </button>
              <button onClick={saveTemplate} className="btn btn-primary">
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// CommSettingsTab — per-station communication integration settings.
// Lets each station configure their own SMS gateway, email, WhatsApp
// Business API, and default sender info so the Communication tab uses
// the station's own channels (not a global default).
// ============================================================
interface CommIntegrationConfig {
  stationName: string;
  senderPhone: string;
  senderEmail: string;
  // SMS gateway
  smsEnabled: boolean;
  smsProvider: string; // "twilio" | "africa-talking" | "custom"
  smsApiKey: string;
  smsSender: string; // sender ID / shortcode
  // Real-gateway extra fields
  smsAccountSid: string; // twilio Account SID
  smsAuthToken: string; // twilio Auth Token
  smsFromNumber: string; // twilio From number
  smsUsername: string; // africa's talking username
  smsCustomUrl: string; // custom HTTP gateway URL
  // Email
  emailEnabled: boolean;
  emailProvider: string; // "sendgrid" | "mailgun" | "resend" | "smtp"
  emailApiKey: string;
  emailDomain: string; // mailgun domain
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  // WhatsApp Business
  whatsappEnabled: boolean;
  whatsappPhone: string; // WhatsApp Business phone_number_id
  whatsappApiUrl: string;
  whatsappToken: string;
}

const DEFAULT_COMM_CONFIG: CommIntegrationConfig = {
  stationName: "",
  senderPhone: "",
  senderEmail: "",
  smsEnabled: false,
  smsProvider: "africa-talking",
  smsApiKey: "",
  smsSender: "",
  smsAccountSid: "",
  smsAuthToken: "",
  smsFromNumber: "",
  smsUsername: "",
  smsCustomUrl: "",
  emailEnabled: false,
  emailProvider: "sendgrid",
  emailApiKey: "",
  emailDomain: "",
  smtpHost: "",
  smtpPort: "587",
  smtpUser: "",
  smtpPassword: "",
  whatsappEnabled: false,
  whatsappPhone: "",
  whatsappApiUrl: "",
  whatsappToken: "",
};

function CommSettingsTab({ stationId }: { stationId?: string }) {
  const [config, setConfig] = useState<CommIntegrationConfig>(
    () =>
      cloudStorageService.getCached<CommIntegrationConfig>(
        "comm_integration_config",
        stationId,
      ) || DEFAULT_COMM_CONFIG,
  );
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    cloudStorageService
      .get<CommIntegrationConfig>("comm_integration_config", stationId)
      .then((data) => {
        if (data) setConfig({ ...DEFAULT_COMM_CONFIG, ...data });
      })
      .catch((err) => console.error("Failed to load comm config:", err));
  }, [stationId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await cloudStorageService.set(
        "comm_integration_config",
        config,
        stationId,
      );
      setToast("Communication settings saved (synced to cloud)");
      setTimeout(() => setToast(""), 3000);
    } catch (err) {
      console.error("Failed to save comm config:", err);
      setToast("Failed to save settings");
      setTimeout(() => setToast(""), 3000);
    } finally {
      setSaving(false);
    }
  };

  const update = (
    field: keyof CommIntegrationConfig,
    value: string | boolean,
  ) => setConfig((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-4">
        <h3 className="font-bold text-blue-900 dark:text-blue-200 mb-1">
          Station Communication Settings
        </h3>
        <p className="text-sm text-blue-700 dark:text-blue-300">
          Configure your station's own communication channels. These settings
          are used by the Contacts, Messages, and Templates tabs to send via
          your gateway (SMS, email, WhatsApp Business). Saved to the cloud so
          all devices at this station share the same config.
        </p>
      </div>

      {/* Default Sender Info */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h4 className="font-semibold dark:text-gray-900 dark:text-white mb-3">
          Default Sender Info
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-500">Station Name</label>
            <input
              type="text"
              value={config.stationName}
              onChange={(e) => update("stationName", e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
              placeholder="e.g. Acme Fuel Station"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Sender Phone</label>
            <input
              type="text"
              value={config.senderPhone}
              onChange={(e) => update("senderPhone", e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
              placeholder="e.g. +1 555 000 1234"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Sender Email</label>
            <input
              type="email"
              value={config.senderEmail}
              onChange={(e) => update("senderEmail", e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
              placeholder="e.g. info@acme.com"
            />
          </div>
        </div>
      </div>

      {/* SMS Gateway */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold dark:text-gray-900 dark:text-white flex items-center gap-2">
            <Phone size={16} /> SMS Gateway
          </h4>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={config.smsEnabled}
              onChange={(e) => update("smsEnabled", e.target.checked)}
              className="rounded"
            />
            Enabled
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-500">Provider</label>
            <select
              value={config.smsProvider}
              onChange={(e) => update("smsProvider", e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
            >
              <option value="africa-talking">Africa's Talking</option>
              <option value="twilio">Twilio</option>
              <option value="custom">Custom HTTP API</option>
            </select>
          </div>
          {config.smsProvider === "twilio" && (
            <>
              <div>
                <label className="text-xs text-gray-500">Account SID</label>
                <input
                  type="text"
                  value={config.smsAccountSid}
                  onChange={(e) => update("smsAccountSid", e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  placeholder="ACxxxxxxxxxxxxxxxx"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Auth Token</label>
                <input
                  type="password"
                  value={config.smsAuthToken}
                  onChange={(e) => update("smsAuthToken", e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  placeholder="Twilio auth token"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">From Number</label>
                <input
                  type="text"
                  value={config.smsFromNumber}
                  onChange={(e) => update("smsFromNumber", e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  placeholder="+15550001234"
                />
              </div>
            </>
          )}
          {config.smsProvider === "africa-talking" && (
            <>
              <div>
                <label className="text-xs text-gray-500">API Key</label>
                <input
                  type="password"
                  value={config.smsApiKey}
                  onChange={(e) => update("smsApiKey", e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  placeholder="Your Africa's Talking API key"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Username</label>
                <input
                  type="text"
                  value={config.smsUsername}
                  onChange={(e) => update("smsUsername", e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  placeholder="e.g. sandbox or your app username"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">
                  Sender ID (optional)
                </label>
                <input
                  type="text"
                  value={config.smsSender}
                  onChange={(e) => update("smsSender", e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  placeholder="e.g. ACME"
                />
              </div>
            </>
          )}
          {config.smsProvider === "custom" && (
            <>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-500">Gateway URL</label>
                <input
                  type="text"
                  value={config.smsCustomUrl}
                  onChange={(e) => update("smsCustomUrl", e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  placeholder="https://your-sms-gateway.com/api/send"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">
                  API Key (Bearer, optional)
                </label>
                <input
                  type="password"
                  value={config.smsApiKey}
                  onChange={(e) => update("smsApiKey", e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  placeholder="Bearer token"
                />
              </div>
            </>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          When enabled, messages are ACTUALLY sent via this gateway (real
          delivery status is recorded on each message).
        </p>
      </div>

      {/* Email */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold dark:text-gray-900 dark:text-white flex items-center gap-2">
            <Mail size={16} /> Email
          </h4>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={config.emailEnabled}
              onChange={(e) => update("emailEnabled", e.target.checked)}
              className="rounded"
            />
            Enabled
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500">Provider</label>
            <select
              value={config.emailProvider}
              onChange={(e) => update("emailProvider", e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
            >
              <option value="sendgrid">SendGrid</option>
              <option value="mailgun">Mailgun</option>
              <option value="resend">Resend</option>
              <option value="smtp">
                SMTP (not supported — use an HTTP API)
              </option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">API Key</label>
            <input
              type="password"
              value={config.emailApiKey}
              onChange={(e) => update("emailApiKey", e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
              placeholder="Your email provider API key"
            />
          </div>
          {config.emailProvider === "mailgun" && (
            <div>
              <label className="text-xs text-gray-500">Mailgun Domain</label>
              <input
                type="text"
                value={config.emailDomain}
                onChange={(e) => update("emailDomain", e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                placeholder="mg.yourdomain.com"
              />
            </div>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          When enabled, emails are ACTUALLY sent via this provider's real HTTP
          API. SMTP (raw TCP) is not reachable from a serverless backend — use
          SendGrid, Mailgun, or Resend.
        </p>
      </div>

      {/* WhatsApp Business */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold dark:text-gray-900 dark:text-white flex items-center gap-2">
            <MessageSquare size={16} /> WhatsApp Business
          </h4>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={config.whatsappEnabled}
              onChange={(e) => update("whatsappEnabled", e.target.checked)}
              className="rounded"
            />
            Enabled
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-gray-500">Business Number</label>
            <input
              type="text"
              value={config.whatsappPhone}
              onChange={(e) => update("whatsappPhone", e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
              placeholder="e.g. 15550001234"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">API URL</label>
            <input
              type="text"
              value={config.whatsappApiUrl}
              onChange={(e) => update("whatsappApiUrl", e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
              placeholder="https://graph.facebook.com/v17.0/..."
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Access Token</label>
            <input
              type="password"
              value={config.whatsappToken}
              onChange={(e) => update("whatsappToken", e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
              placeholder="WhatsApp Cloud API token"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-gray-900 dark:text-white rounded-xl font-medium flex items-center gap-2 disabled:opacity-50 fp-icon-only"
          title="Download"
          aria-label="Download"
        >
          <Download size={16} />
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-3 rounded-xl shadow-2xl text-sm font-medium z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
