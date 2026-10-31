'use client';
import { useStaffAccess } from './StaffAccess';
import GuestWorkspace from './GuestWorkspace';
import OperationsWorkspace from './OperationsWorkspace';
import OfflineEntries from './finance/OfflineEntries';
// Capabilities come from the authenticated backend session, not browser flags.
// Existing automation-only deployments retain their original workspace.
export default function Page() {
  const { identity } = useStaffAccess();
  return identity?.modules?.salesExpenses ? <OfflineEntries key={identity.id}><OperationsWorkspace /></OfflineEntries> : <GuestWorkspace />;
}
