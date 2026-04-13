# Slack Message Templates

## Approval Request (Scenario 1 Output)

Sent as a DM to Alex when a new draft passes QC:

```
*New LinkedIn Draft Ready* — Row {{row_number}}

*Bucket:* {{bucket}} | *QC Score:* {{qc_score}}/10 | *Urgency:* {{urgency}}/10

---
{{draft_text}}
---

*QC Feedback:* {{qc_feedback}}

*Source:* {{source_url}}

React with:
:white_check_mark: — Approve and schedule
:pencil: — Request edit (reply with your instruction)
:x: — Reject

_Row ID: {{row_number}} | Bucket: {{bucket}}_
```

## Approval Confirmation (Scenario 2, Route A)

```
:white_check_mark: Scheduled for {{scheduled_datetime_human}}. GHL Post ID: {{ghl_post_id}}
```

## Revised Draft (Scenario 2, Route B)

```
*Revised LinkedIn Draft* — Row {{row_number}}

*Bucket:* {{bucket}}

---
{{revised_draft_text}}
---

React with:
:white_check_mark: — Approve and schedule
:pencil: — Request another edit
:x: — Reject

_Row ID: {{row_number}} | Bucket: {{bucket}}_
```

## Rejection Confirmation (Scenario 2, Route C)

```
:x: Post rejected and archived. (Row {{row_number}})
```

## Notes

- The `_Row ID: {{row_number}}_` footer is critical. Scenario 2 uses regex to extract the row number from this line.
- All messages are sent as DMs to Alex's Slack user ID (stored in `SLACK_APPROVAL_CHANNEL`).
- Emoji reactions trigger Scenario 2 via the Slack `reaction_added` event.
