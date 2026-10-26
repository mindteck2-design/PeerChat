import test from "node:test";
import assert from "node:assert";
import {
  ENTERPRISE_ROLES,
  canBroadcastRole,
  getRoleBadge,
} from "../src/features/profile/roles.ts";

test("predefined enterprise roles are properly configured with 13 standard levels", () => {
  assert.strictEqual(ENTERPRISE_ROLES.length, 13);
  
  // First 8 roles are staff/engineering (subscribers)
  const staff = ENTERPRISE_ROLES.slice(0, 8);
  for (const s of staff) {
    assert.strictEqual(s.canBroadcast, false, `${s.label} should not have broadcast authority`);
    assert.strictEqual(s.category, "staff");
  }

  // Last 5 roles are managerial (Deputy Manager and above: can broadcast)
  const managers = ENTERPRISE_ROLES.slice(8);
  for (const m of managers) {
    assert.strictEqual(m.canBroadcast, true, `${m.label} should have broadcast authority`);
    assert.strictEqual(m.category, "managerial");
  }
});

test("canBroadcastRole enforces Deputy Manager and above rule", () => {
  // Disallowed:
  assert.strictEqual(canBroadcastRole("Vendor"), false);
  assert.strictEqual(canBroadcastRole("GAPP Trainee"), false);
  assert.strictEqual(canBroadcastRole("Trainee Engineer"), false);
  assert.strictEqual(canBroadcastRole("Project Engineer"), false);
  assert.strictEqual(canBroadcastRole("Probationary Engineer"), false);
  assert.strictEqual(canBroadcastRole("FTE"), false);
  assert.strictEqual(canBroadcastRole("Deputy Engineer"), false);
  assert.strictEqual(canBroadcastRole("Senior Sf Engineer"), false);
  assert.strictEqual(canBroadcastRole(""), false);
  assert.strictEqual(canBroadcastRole(null), false);
  assert.strictEqual(canBroadcastRole(undefined), false);

  // Allowed:
  assert.strictEqual(canBroadcastRole("Deputy Manager"), true);
  assert.strictEqual(canBroadcastRole("Manager"), true);
  assert.strictEqual(canBroadcastRole("DGM"), true);
  assert.strictEqual(canBroadcastRole("Snr DGM"), true);
  assert.strictEqual(canBroadcastRole("AGM"), true);

  // Case insensitivity & trimming:
  assert.strictEqual(canBroadcastRole("  deputy manager  "), true);
  assert.strictEqual(canBroadcastRole("dgm"), true);
  assert.strictEqual(canBroadcastRole("SENIOR SF ENGINEER"), false);
});

test("custom roles default to read-only unless matching managerial/executive titles", () => {
  assert.strictEqual(canBroadcastRole("External Consultant"), false);
  assert.strictEqual(canBroadcastRole("QA Specialist"), false);
  assert.strictEqual(canBroadcastRole("Frontend Intern"), false);

  // Executive/Managerial custom titles:
  assert.strictEqual(canBroadcastRole("General Manager"), true);
  assert.strictEqual(canBroadcastRole("Engineering Director"), true);
  assert.strictEqual(canBroadcastRole("Vice President"), true);
});

test("getRoleBadge produces friendly labels and indicates managerial cadre", () => {
  const staffBadge = getRoleBadge("Senior Sf Engineer");
  assert.strictEqual(staffBadge.label, "Senior Sf Engineer");
  assert.strictEqual(staffBadge.isManagerial, false);

  const mgrBadge = getRoleBadge("Deputy Manager");
  assert.strictEqual(mgrBadge.label, "Deputy Manager");
  assert.strictEqual(mgrBadge.isManagerial, true);
});
