import type { LucideIcon } from "lucide-react";
import { ShieldCheck, UserCheck, User, Eye, Lock, Crown } from "lucide-react";
import {
  usePermissions,
  type UserRole,
} from "@/react-app/context/PermissionContext";

const ROLES: {
  id: UserRole;
  label: string;
  desc: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
}[] = [
  {
    id: "owner",
    label: "Owner",
    desc: "Full control, cannot be revoked",
    icon: Crown,
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
  },
  {
    id: "manager",
    label: "Manager",
    desc: "Operational control, invites Staff/Auditor",
    icon: UserCheck,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
  },
  {
    id: "staff",
    label: "Staff",
    desc: "Daily tasks, assigned pumps/shifts",
    icon: User,
    color: "text-green-400",
    bgColor: "bg-green-500/10",
  },
  {
    id: "auditor",
    label: "Auditor",
    desc: "Read-only audit and reports",
    icon: Eye,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
  },
];

export default function RoleSelector() {
  const { role, isOwner } = usePermissions();

  const current = ROLES.find((r) => r.id === role) || ROLES[0];
  const Icon = current.icon;

  // ── OWNER ROLE DISPLAY (locked, no switching) ──
  if (isOwner) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
        <Crown size={14} className="text-purple-400" />
        <span className="text-xs text-white font-medium hidden sm:inline">
          Owner
        </span>
        <span className="text-[9px] text-purple-400 hidden md:inline flex items-center gap-1">
          <Lock size={8} /> Locked
        </span>
      </div>
    );
  }

  // ── ASSIGNED ROLE DISPLAY (non-owners show their role read-only) ──
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-500/10 border border-white/10">
      <Icon size={14} className={current.color} />
      <span className="text-xs text-white font-medium hidden sm:inline">
        {current.label}
      </span>
      <span className="text-[9px] text-gray-400 hidden md:inline flex items-center gap-1">
        <ShieldCheck size={8} /> Assigned
      </span>
    </div>
  );
}
