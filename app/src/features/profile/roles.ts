export type EnterpriseRole = {
  id: string;
  label: string;
  canBroadcast: boolean;
  category: "staff" | "managerial";
};

export const ENTERPRISE_ROLES: EnterpriseRole[] = [
  // ── Staff & Engineering Cadre (Subscribers / Read-only) ──
  { id: "vendor", label: "Vendor", canBroadcast: false, category: "staff" },
  { id: "gapp_trainee", label: "GAPP Trainee", canBroadcast: false, category: "staff" },
  { id: "trainee_engineer", label: "Trainee Engineer", canBroadcast: false, category: "staff" },
  { id: "project_engineer", label: "Project Engineer", canBroadcast: false, category: "staff" },
  { id: "probationary_engineer", label: "Probationary Engineer", canBroadcast: false, category: "staff" },
  { id: "fte", label: "FTE", canBroadcast: false, category: "staff" },
  { id: "deputy_engineer", label: "Deputy Engineer", canBroadcast: false, category: "staff" },
  { id: "senior_sf_engineer", label: "Senior Sf Engineer", canBroadcast: false, category: "staff" },

  // ── Management Cadre (Deputy Manager and above: Can Broadcast) ──
  { id: "deputy_manager", label: "Deputy Manager", canBroadcast: true, category: "managerial" },
  { id: "manager", label: "Manager", canBroadcast: true, category: "managerial" },
  { id: "dgm", label: "DGM", canBroadcast: true, category: "managerial" },
  { id: "snr_dgm", label: "Snr DGM", canBroadcast: true, category: "managerial" },
  { id: "agm", label: "AGM", canBroadcast: true, category: "managerial" },
];

/**
 * Checks whether a given role / designation has authority to broadcast in Org and Team announcement channels.
 * Rule: Deputy Manager and above can broadcast.
 */
export function canBroadcastRole(designation?: string | null): boolean {
  if (!designation) return false;
  const d = designation.trim().toLowerCase();
  if (!d) return false;

  // Explicit non-broadcasters (even if custom text contains keywords)
  if (
    d.includes("senior sf engineer") ||
    d.includes("deputy engineer") ||
    d.includes("project engineer") ||
    d.includes("trainee engineer") ||
    d.includes("probationary engineer") ||
    d.includes("gapp trainee") ||
    d.includes("vendor") ||
    d === "fte" ||
    d.endsWith(" trainee") ||
    d.endsWith(" intern")
  ) {
    return false;
  }

  // Exact matching for standard managerial roles
  if (
    d === "deputy manager" ||
    d === "manager" ||
    d === "dgm" ||
    d === "snr dgm" ||
    d === "senior dgm" ||
    d === "agm"
  ) {
    return true;
  }

  // Broad managerial and executive keywords for custom roles
  const managerialPatterns = [
    /\bdeputy manager\b/,
    /\bmanager\b/,
    /\bdgm\b/,
    /\bagm\b/,
    /\bgeneral manager\b/,
    /\bgm\b/,
    /\bdirector\b/,
    /\bvice president\b/,
    /\bvp\b/,
    /\bhead of\b/,
    /\bchief\b/,
    /\badmin\b/,
    /\badministrator\b/,
  ];

  return managerialPatterns.some((pattern) => pattern.test(d));
}

/**
 * Returns a human-friendly role badge label.
 */
export function getRoleBadge(designation?: string | null): {
  label: string;
  isManagerial: boolean;
} {
  const label = designation?.trim() || "Member";
  return {
    label,
    isManagerial: canBroadcastRole(designation),
  };
}
