# Security Specification for Arkoo Prebuild Meeting Intelligence

## Data Invariants
- A task must have a title, status, and priority.
- A meeting must have a creator and a status.
- Users cannot upgrade their own roles.
- Employees can only update the status and remarks of tasks assigned to them.
- Only Admins and Managers can create meetings and task assessments from them.

## The Dirty Dozen Payloads (Rejection Targets)
1. **Identity Spoofing**: User A attempts to create a profile as User B.
2. **Privilege Escalation**: Employee attempts to update their role to 'admin'.
3. **Ghost Field Injection**: User attempts to add `isVerified: true` to a system-controlled collection.
4. **ID Poisoning**: User attempts to create a meeting with a 1MB string as the ID.
5. **Orphaned Writes**: Task creation without a valid priority or status.
6. **Self-Assignment**: User attempts to change task ownerId to themselves on a task they don't own.
7. **Resource Exhaustion**: Sending a 50,000 character string in a department name.
8. **PII Breach**: Regular employee attempting to 'list' all user profiles.
9. **State Shortcutting**: Skipping 'processing' and moving a meeting straight to 'completed' without the master gate.
10. **Timestamp Forgery**: Client sending a `createdAt` date from 2001.
11. **Revocation Bypass**: A deactivated user attempting to read recent meetings.
12. **Query Scraping**: Using `allow list: if isSignedIn()` to download all tasks in the system.

## Test Runner Logic
The `firestore.rules` are designed to catch these by:
- Explicit checks for `request.auth.uid`.
- `affectedKeys().hasOnly()` gates for specific state transitions.
- Type and size checks on all input fields.
- Role-based gatekeeping (isAdmin, isManager).
