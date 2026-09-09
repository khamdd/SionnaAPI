# Impact Study notifications

The backend creates one in-app notification for the creator of an Impact Study
when the parent study reaches a meaningful terminal outcome. Child simulation
jobs do not create notifications.

Notification outcomes are:

- `impact_study_completed` when the study completed, all configured objectives
  passed, and no local spatial regression was detected;
- `impact_study_needs_review` when the study completed but objectives, missing
  objectives, or spatial results still require engineering review;
- `impact_study_completed_with_failures` when only partial results are available;
- `impact_study_failed` when the parent study failed.

Cancelled studies do not create an alert. The database enforces at most one
notification per user and Impact Study, so worker retries and repeated study
reads cannot create duplicates.

## API

All endpoints require authentication and expose only the current user's rows.

```text
GET  /api/v1/notifications?unread_only=false&limit=100
GET  /api/v1/notifications/unread-count
POST /api/v1/notifications/{id}/read
POST /api/v1/notifications/read-all
```

Each notification includes a stable event type, display title and message,
read state, timestamps, and a payload containing its Impact Study ID, scene,
study status, conservative decision, study API URL, and report API URL.

This milestone provides backend persistence and APIs only. A later frontend
workflow will display the unread badge and notification list.
